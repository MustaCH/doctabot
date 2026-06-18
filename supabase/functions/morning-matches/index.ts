import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { reportEdgeErrorBg } from "../_shared/observability.ts";

// ---- Matching helpers ----
// Lógica pura de matching extraída a ./matching.ts para poder unit-testearla
// (ver matching.test.ts) y mantenerla en sync con src/lib/property-matching.ts.
import {
  extractTypeFromTitle,
  extractClientZonesFromNotes,
  findMatchReasons,
  findSellerBuyerMatchReasons,
  minReasonsFor,
  type PropertyRow,
  type ClientRow,
} from "./matching.ts";
import { buildClientSearchSummary, formatPropertyLine } from "./format.ts";
// Batching + observabilidad (lógica pura testeable). Ver ticket 86aj1pgvb.
import { sliceSize, nextCursor, isOrchestratorCall, computeRunStatus, type Phase } from "./batching.ts";

const PROPERTY_SELECT =
  "id, zone, price, currency, property_type, title, locality, operation, address, m2_total, habitaciones, photo, url";

function buildSellerSummary(seller: ClientRow): string {
  const parts: string[] = [];

  const types = seller.property_type_interest
    ?.split(",").map((t) => t.trim()).filter(Boolean) || [];
  if (types.length === 0 && seller.notes) {
    const noteTypes = extractTypeFromTitle(seller.notes);
    if (noteTypes.length) types.push(...noteTypes);
  }

  const zones = seller.preferred_zones
    ?.split(",").map((z) => z.trim()).filter(Boolean) || [];
  if (seller.notes) {
    const noteZones = extractClientZonesFromNotes(seller.notes);
    for (const z of noteZones) {
      if (!zones.some((ez) => ez.toLowerCase() === z)) zones.push(z);
    }
  }

  const typeStr = types.length
    ? types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join("/")
    : null;
  const zoneStr = zones.length ? zones.join(", ") : null;
  if (typeStr && zoneStr) parts.push(`${typeStr} en ${zoneStr}`);
  else if (typeStr) parts.push(typeStr);
  else if (zoneStr) parts.push(`en ${zoneStr}`);

  if (seller.budget_min) {
    const curr = seller.budget_currency || "USD";
    parts.push(`${curr} ${seller.budget_min.toLocaleString("es-AR")}`);
  }

  if (parts.length === 0 && seller.notes) {
    return `🏷️ **Vende:** ${seller.notes.substring(0, 100)}`;
  }

  return parts.length ? `🏷️ **Vende:** ${parts.join(" · ")}` : "";
}

function formatBuyerLine(buyer: ClientRow): string {
  const lines: string[] = [];
  lines.push(`👤 **${buyer.full_name}**`);
  const summary = buildClientSearchSummary(buyer);
  if (summary) lines.push(summary);
  if ((buyer as any).phone) lines.push(`📞 ${(buyer as any).phone}`);
  return lines.join("\n");
}

/** Prioridad por temperatura: hot > warm > cold. Ordena los nombres del push. Ver ticket 86aj1f13j. */
function tempRank(status: string | null | undefined): number {
  return status === "hot" ? 0 : status === "warm" ? 1 : 2;
}

/** Fire-and-forget: invocar a la propia función con el siguiente slice del cursor.
 *  Cada worker procesa un slice acotado (WORK_BUDGET pares) y se auto-encadena, así ninguna
 *  invocación se acerca al worker limit (546) por más clientes que tenga un usuario. Ver 86aj1pgvb.
 *  Service key como Bearer: morning-matches queda con verify_jwt=true (endpoint gateado). */
function selfInvoke(supabaseUrl: string, serviceKey: string, body: Record<string, any>) {
  fetch(`${supabaseUrl}/functions/v1/morning-matches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify(body),
  }).catch((err) => console.error("Self-invoke error:", err));
}

const SELECT_CLIENT = "id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, status, notes";
const SELECT_BUYER_XMATCH = "id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes, phone, email, status";

/** Distinct user_ids con clientes (cualquier tipo), ordenados. Columna única → query barata.
 *  Dedup/orden en JS para paginar por índice de forma estable entre invocaciones. */
async function fetchUserIds(admin: any): Promise<string[]> {
  const { data } = await admin.from("clients").select("user_id").eq("is_client", true);
  return [...new Set((data || []).map((r: any) => r.user_id as string))].sort() as string[];
}

/**
 * BUYER → PROPERTY: cruza las `props` nuevas contra un SLICE de clientes compradores y crea los
 * matches (conversación + mensaje + notified_matches + client_properties). NO manda push (eso se
 * hace al final, ver sendRunPushes). Devuelve cuántos grupos de match (clientes) se crearon.
 */
async function processBuyerSlice(
  admin: any,
  userId: string,
  props: PropertyRow[],
  buyerSlice: ClientRow[],
): Promise<number> {
  if (buyerSlice.length === 0 || props.length === 0) return 0;

  const { data: alreadyNotified } = await admin
    .from("notified_matches").select("client_id, property_id").eq("user_id", userId);
  const notifiedSet = new Set((alreadyNotified || []).map((r: any) => `${r.client_id}:${r.property_id}`));

  const clientMatches = new Map<string, { client: ClientRow; properties: { prop: PropertyRow; reasons: string[] }[] }>();
  for (const prop of props) {
    for (const client of buyerSlice) {
      if (notifiedSet.has(`${client.id}:${prop.id}`)) continue;
      const reasons = findMatchReasons(prop, client);
      if (reasons.length >= minReasonsFor(client)) {
        if (!clientMatches.has(client.id)) clientMatches.set(client.id, { client, properties: [] });
        clientMatches.get(client.id)!.properties.push({ prop, reasons });
      }
    }
  }

  let groups = 0;
  for (const [clientId, { client, properties: matchedProps }] of clientMatches) {
    const { data: existingConv } = await admin
      .from("conversations").select("id")
      .eq("user_id", userId).eq("client_id", clientId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();

    let convId: string;
    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await admin
        .from("conversations")
        .insert({ user_id: userId, title: `🔔 Matches para ${client.full_name}`, client_id: clientId, conversation_type: "proactive_match" })
        .select("id").single();
      if (convErr) { console.error(`Failed to create conv for client ${clientId}:`, convErr); continue; }
      convId = newConv.id;
    }

    const lines: string[] = [`🔔 **Nuevas propiedades para ${client.full_name}**\n`];
    const summary = buildClientSearchSummary(client);
    if (summary) lines.push(`${summary}\n`);
    lines.push(`Encontré ${matchedProps.length} propiedad${matchedProps.length > 1 ? "es" : ""} que coincide${matchedProps.length > 1 ? "n" : ""}:\n`);
    for (const { prop, reasons } of matchedProps.slice(0, 5)) {
      lines.push(formatPropertyLine(prop));
      lines.push(`_Coincide por: ${reasons.join(", ")}_\n`);
    }
    if (matchedProps.length > 5) {
      lines.push(`\n_...y ${matchedProps.length - 5} propiedad${matchedProps.length - 5 > 1 ? "es" : ""} más._`);
    }
    lines.push("\n¿Querés que le envíe alguna de estas propiedades al cliente?");

    await admin.from("messages").insert({ conversation_id: convId, role: "assistant", content: lines.join("\n") });
    await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

    let shown = matchedProps.slice(0, 5);

    // Validar que las propiedades sigan existiendo: scrape-properties puede borrar
    // propiedades obsoletas entre el SELECT del worker y este insert; si una ya no
    // existe, el FK property_id (notified_matches / client_properties) tira PG 23503
    // y se perdería el registro del resto del grupo. Filtramos las inexistentes.
    const shownIds = shown.map(({ prop }) => prop.id);
    const { data: liveProps } = await admin
      .from("properties").select("id").in("id", shownIds);
    const liveIds = new Set((liveProps || []).map((p: any) => p.id));
    if (liveIds.size < shownIds.length) {
      console.warn(`Match buyer ${clientId}: ${shownIds.length - liveIds.size} propiedad(es) ya no existen, se omiten del registro`);
      shown = shown.filter(({ prop }) => liveIds.has(prop.id));
    }
    if (shown.length === 0) { groups++; continue; }

    await Promise.all([
      admin.from("notified_matches").upsert(
        shown.map(({ prop }) => ({ user_id: userId, client_id: clientId, property_id: prop.id })),
        { onConflict: "user_id,client_id,property_id", ignoreDuplicates: true },
      ),
      admin.from("client_properties").upsert(
        shown.map(({ prop, reasons }) => ({
          user_id: userId, client_id: clientId, property_id: prop.id, status: "sugerida",
          notes: `Match automático (${new Date().toISOString().slice(0, 10)}): ${reasons.join(", ")}`,
        })),
        { onConflict: "client_id,property_id", ignoreDuplicates: true },
      ),
    ]);
    groups++;
  }
  return groups;
}

/**
 * SELLER → BUYER: cruza un SLICE de vendedores contra TODOS los compradores del usuario y crea los
 * matches (conversación + mensaje + notified_matches, pares guardados como client_id=seller,
 * property_id=buyer). NO manda push. Devuelve cuántos grupos (vendedores con match) se crearon.
 */
async function processSellerSlice(
  admin: any,
  userId: string,
  sellerSlice: ClientRow[],
  buyers: (ClientRow & { phone?: string; email?: string })[],
): Promise<number> {
  if (sellerSlice.length === 0 || buyers.length === 0) return 0;

  // Dedup de pares seller→buyer. Viven en notified_seller_matches (FK a clients),
  // NO en notified_matches (cuyo property_id tiene FK a properties). Ver migración
  // 20260618130000 y docs/adrs/0003.
  const { data: sellerNotified } = await admin
    .from("notified_seller_matches").select("seller_client_id, buyer_client_id").eq("user_id", userId);
  const sellerNotifiedSet = new Set((sellerNotified || []).map((r: any) => `${r.seller_client_id}:${r.buyer_client_id}`));

  let groups = 0;
  for (const seller of sellerSlice) {
    const matchedBuyers: { buyer: ClientRow & { phone?: string; email?: string }; reasons: string[] }[] = [];
    for (const buyer of buyers) {
      if (sellerNotifiedSet.has(`${seller.id}:${buyer.id}`)) continue;
      const reasons = findSellerBuyerMatchReasons(seller, buyer);
      if (reasons.length >= minReasonsFor(seller)) matchedBuyers.push({ buyer, reasons });
    }
    if (matchedBuyers.length === 0) continue;

    const { data: existingConv } = await admin
      .from("conversations").select("id")
      .eq("user_id", userId).eq("client_id", seller.id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();

    let convId: string;
    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await admin
        .from("conversations")
        .insert({ user_id: userId, title: `🔔 Compradores para ${seller.full_name}`, client_id: seller.id, conversation_type: "proactive_match" })
        .select("id").single();
      if (convErr) { console.error(`Failed to create conv for seller ${seller.id}:`, convErr); continue; }
      convId = newConv.id;
    }

    const lines: string[] = [`🔔 **Posibles compradores para el inmueble de ${seller.full_name}**\n`];
    const sellerSummary = buildSellerSummary(seller);
    if (sellerSummary) lines.push(`${sellerSummary}\n`);
    lines.push(`Encontré ${matchedBuyers.length} comprador${matchedBuyers.length > 1 ? "es" : ""} que podría${matchedBuyers.length > 1 ? "n" : ""} estar interesado${matchedBuyers.length > 1 ? "s" : ""}:\n`);
    for (const { buyer, reasons } of matchedBuyers.slice(0, 5)) {
      lines.push(formatBuyerLine(buyer));
      lines.push(`_Coincide por: ${reasons.join(", ")}_\n`);
    }
    if (matchedBuyers.length > 5) {
      lines.push(`\n_...y ${matchedBuyers.length - 5} comprador${matchedBuyers.length - 5 > 1 ? "es" : ""} más._`);
    }
    lines.push("\n¿Querés que te prepare un mensaje para contactar a alguno?");

    await admin.from("messages").insert({ conversation_id: convId, role: "assistant", content: lines.join("\n") });
    await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    await admin.from("notified_seller_matches").upsert(
      matchedBuyers.slice(0, 5).map(({ buyer }) => ({ user_id: userId, seller_client_id: seller.id, buyer_client_id: buyer.id })),
      { onConflict: "user_id,seller_client_id,buyer_client_id", ignoreDuplicates: true },
    );
    groups++;
  }
  return groups;
}

/**
 * FASE DE PUSH (corre una vez, al cerrar la corrida): manda UN push por usuario con matches nuevos
 * de ESTA corrida. Los matches buyer→propiedad viven en notified_matches (push "Nuevos matches") y
 * los seller→buyer en notified_seller_matches (push "Compradores encontrados"), ambos filtrados por
 * la ventana de la corrida. Desacoplar el push de los workers permite acotar el CPU de cada worker.
 * Ver 86aj1pgvb y docs/adrs/0003.
 */
async function sendRunPushes(
  admin: any,
  startedAtISO: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<void> {
  // Agrupar por (user, tipo de push) → lista de {client_id, full_name, status}
  type Match = { client_id: string; full_name: string; status: string | null };
  const buyerByUser = new Map<string, Match[]>();
  const sellerByUser = new Map<string, Match[]>();

  // Buyer matches: notified_matches (client_id = comprador notificado).
  const { data: buyerRows } = await admin
    .from("notified_matches")
    .select("user_id, client_id, clients!inner(full_name, status)")
    .gte("created_at", startedAtISO);
  for (const r of (buyerRows as any[]) ?? []) {
    const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    if (!c) continue;
    const arr = buyerByUser.get(r.user_id) ?? [];
    if (!arr.some((m) => m.client_id === r.client_id)) {
      arr.push({ client_id: r.client_id, full_name: c.full_name, status: c.status });
    }
    buyerByUser.set(r.user_id, arr);
  }

  // Seller matches: notified_seller_matches (seller_client_id = vendedor notificado).
  // Dos pasos (en vez de embed) porque la tabla tiene dos FKs a clients y el join
  // embebido sería ambiguo.
  const { data: sellerRows } = await admin
    .from("notified_seller_matches")
    .select("user_id, seller_client_id")
    .gte("created_at", startedAtISO);
  const sellerIds = [...new Set(((sellerRows as any[]) ?? []).map((r) => r.seller_client_id))];
  const sellerClientById = new Map<string, any>();
  if (sellerIds.length) {
    const { data: sc } = await admin.from("clients").select("id, full_name, status").in("id", sellerIds);
    for (const c of (sc as any[]) ?? []) sellerClientById.set(c.id, c);
  }
  for (const r of (sellerRows as any[]) ?? []) {
    const c = sellerClientById.get(r.seller_client_id);
    if (!c) continue;
    const arr = sellerByUser.get(r.user_id) ?? [];
    if (!arr.some((m) => m.client_id === r.seller_client_id)) {
      arr.push({ client_id: r.seller_client_id, full_name: c.full_name, status: c.status });
    }
    sellerByUser.set(r.user_id, arr);
  }

  if (buyerByUser.size === 0 && sellerByUser.size === 0) return;

  const deepLink = async (userId: string, clientId: string): Promise<string> => {
    const { data: conv } = await admin
      .from("conversations").select("id")
      .eq("user_id", userId).eq("client_id", clientId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    return conv ? `/?c=${conv.id}` : "/";
  };

  const sendPush = async (userId: string, title: string, body: string, url: string) => {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, title, body, url }),
      });
    } catch (pushErr) {
      console.error(`Push failed for user ${userId}:`, pushErr);
    }
  };

  for (const [userId, matches] of buyerByUser) {
    const sorted = [...matches].sort((a, b) => tempRank(a.status) - tempRank(b.status));
    const names = sorted.map((m) => m.full_name).slice(0, 3);
    const extra = matches.length > 3 ? ` y ${matches.length - 3} más` : "";
    const url = await deepLink(userId, sorted[0].client_id);
    await sendPush(userId, "🔔 Nuevos matches de propiedades", `Encontré propiedades para ${names.join(", ")}${extra}`, url);
  }
  for (const [userId, matches] of sellerByUser) {
    const sorted = [...matches].sort((a, b) => tempRank(a.status) - tempRank(b.status));
    const names = sorted.map((m) => m.full_name).slice(0, 3);
    const extra = matches.length > 3 ? ` y ${matches.length - 3} más` : "";
    const url = await deepLink(userId, sorted[0].client_id);
    await sendPush(userId, "🔔 Compradores encontrados", `Encontré compradores para ${names.join(", ")}${extra}`, url);
  }
}

// ---- Main handler ----

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    let body: any = undefined;
    try { body = await req.json(); } catch { /* sin body: arranque (orchestrator) */ }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ─── ORCHESTRATOR MODE ───
    if (isOrchestratorCall(body)) {
      const batchTimestamp = new Date().toISOString();
      const { count: propCount } = await admin
        .from("properties").select("id", { count: "exact", head: true })
        .or(`created_at.gte.${since},last_seen_at.gte.${since}`);
      const userIds = await fetchUserIds(admin);
      const usersTotal = userIds.length;
      const propertiesScanned = propCount ?? 0;

      if (propertiesScanned === 0 || usersTotal === 0) {
        await admin.from("match_runs").insert({
          batch_id: batchTimestamp, started_at: batchTimestamp, finished_at: new Date().toISOString(),
          users_total: usersTotal, properties_scanned: propertiesScanned, status: "success",
        });
        console.log(`Morning matches: nada para procesar (props=${propertiesScanned}, users=${usersTotal})`);
        return new Response(JSON.stringify({ mode: "orchestrator", matches: 0, reason: "nada para procesar" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await admin.from("match_runs").insert({
        batch_id: batchTimestamp, started_at: batchTimestamp,
        users_total: usersTotal, properties_scanned: propertiesScanned, status: "running",
      });
      selfInvoke(supabaseUrl, serviceKey, { batchTimestamp, userIdx: 0, phase: "buyer", offset: 0 });

      console.log(`Morning matches iniciado: ${usersTotal} usuarios, ${propertiesScanned} props (batch ${batchTimestamp})`);
      return new Response(JSON.stringify({ mode: "orchestrator", batch_timestamp: batchTimestamp, users_total: usersTotal }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── WORKER MODE: procesa un slice acotado y se auto-encadena ───
    const batchTimestamp = body.batchTimestamp as string;
    const userIdx: number = Number.isInteger(body.userIdx) ? body.userIdx : 0;
    const phase: Phase = body.phase === "seller" ? "seller" : "buyer";
    const offset: number = Number.isInteger(body.offset) ? body.offset : 0;

    const { data: runRow } = await admin
      .from("match_runs").select("*").eq("batch_id", batchTimestamp)
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    const startedAtISO: string = runRow?.started_at ?? batchTimestamp;

    const userIds = await fetchUserIds(admin);

    // Fin de la corrida → fase de push (una sola vez) + finalizar.
    if (userIdx >= userIds.length) {
      try {
        await sendRunPushes(admin, startedAtISO, supabaseUrl, serviceKey);
      } catch (pushErr) {
        console.error("sendRunPushes falló:", pushErr);
      }
      const status = computeRunStatus(runRow?.users_processed ?? 0, runRow?.user_errors ?? 0, runRow?.users_total ?? 0);
      await admin.from("match_runs").update({
        status, finished_at: new Date().toISOString(), error_detail: runRow?.error_detail ?? null,
      }).eq("batch_id", batchTimestamp);
      console.log(`Morning matches finalizado (${status}): ${runRow?.users_processed ?? 0} users, ${runRow?.buyer_match_groups ?? 0} buyer / ${runRow?.seller_match_groups ?? 0} seller groups (batch ${batchTimestamp})`);
      return new Response(JSON.stringify({ mode: "worker", phase: "finalize", status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userIds[userIdx];
    const { data: newProperties } = await admin
      .from("properties").select(PROPERTY_SELECT)
      .or(`created_at.gte.${since},last_seen_at.gte.${since}`).limit(500);
    const props = (newProperties ?? []) as PropertyRow[];

    let buyerGroups = 0, sellerGroups = 0, hadError = false;
    let outerTotal = 0, processed = 0;

    try {
      if (phase === "buyer") {
        const { data: buyers } = await admin
          .from("clients").select(SELECT_CLIENT)
          .eq("user_id", userId).eq("is_client", true).neq("client_type", "seller")
          .order("id", { ascending: true });
        const all = (buyers ?? []) as ClientRow[];
        outerTotal = all.length;
        const slice = all.slice(offset, offset + sliceSize(props.length));
        processed = slice.length;
        buyerGroups = await processBuyerSlice(admin, userId, props, slice);
      } else {
        const [{ data: sellers }, { data: buyersData }] = await Promise.all([
          admin.from("clients").select(SELECT_CLIENT)
            .eq("user_id", userId).eq("is_client", true).eq("client_type", "seller")
            .order("id", { ascending: true }),
          admin.from("clients").select(SELECT_BUYER_XMATCH)
            .eq("user_id", userId).eq("is_client", true).neq("client_type", "seller"),
        ]);
        const allSellers = (sellers ?? []) as ClientRow[];
        const buyers = (buyersData ?? []) as (ClientRow & { phone?: string; email?: string })[];
        outerTotal = allSellers.length;
        const slice = allSellers.slice(offset, offset + sliceSize(buyers.length));
        processed = slice.length;
        sellerGroups = await processSellerSlice(admin, userId, slice, buyers);
      }
    } catch (sliceErr) {
      hadError = true;
      const msg = sliceErr instanceof Error ? sliceErr.message : String(sliceErr);
      console.error(`Slice falló (user ${userId}, ${phase}, offset ${offset}):`, msg);
      reportEdgeErrorBg({ context: "morning-matches", error: sliceErr });
      // Avanzar igual: marcamos el loop externo como consumido para no quedar en loop infinito.
      processed = Number.MAX_SAFE_INTEGER;
    }

    const next = nextCursor({ userIdx, phase, offset }, processed, outerTotal, userIds.length);

    // Persistir avance en match_runs (lotes secuenciales → sin race).
    const update: Record<string, any> = {
      buyer_match_groups: (runRow?.buyer_match_groups ?? 0) + buyerGroups,
      seller_match_groups: (runRow?.seller_match_groups ?? 0) + sellerGroups,
    };
    if (next.userDone) update.users_processed = (runRow?.users_processed ?? 0) + 1;
    if (hadError) {
      update.user_errors = (runRow?.user_errors ?? 0) + 1;
      if (!runRow?.error_detail) {
        update.error_detail = `user ${userId} (${phase}): slice falló`;
      }
    }
    await admin.from("match_runs").update(update).eq("batch_id", batchTimestamp);

    // Encadenar el siguiente slice (o el cierre).
    if (next.done) {
      selfInvoke(supabaseUrl, serviceKey, { batchTimestamp, userIdx: userIds.length, phase: "buyer", offset: 0 });
    } else {
      selfInvoke(supabaseUrl, serviceKey, { batchTimestamp, userIdx: next.userIdx, phase: next.phase, offset: next.offset });
    }

    return new Response(JSON.stringify({
      mode: "worker", user_idx: userIdx, phase, offset, processed: processed === Number.MAX_SAFE_INTEGER ? "error" : processed,
      buyer_groups: buyerGroups, seller_groups: sellerGroups, next_done: next.done,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    reportEdgeErrorBg({ context: "morning-matches", error: err });
    return errorResponse(safeError(err, "morning-matches"), 500);
  }
});
