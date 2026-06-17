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
import { USERS_PER_INVOCATION, isOrchestratorCall, computeRunStatus } from "./batching.ts";

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

/** Prioridad por temperatura: mostrar primero los más calientes en los nombres truncados
 *  del push (hot > warm > cold). No suprime ninguno, solo ordena. Ver ticket 86aj1f13j. */
function tempRank(status: string | null | undefined): number {
  return status === "hot" ? 0 : status === "warm" ? 1 : 2;
}

/** Fire-and-forget: invocar a la propia función con el siguiente lote de usuarios.
 *  Mismo patrón que scrape-properties: cada worker procesa pocos usuarios y se auto-encadena,
 *  así ninguna invocación se acerca al worker limit (546). Ver ticket 86aj1pgvb.
 *  Usa la service key como Bearer: morning-matches queda con verify_jwt=true (endpoint gateado),
 *  y la service key es un JWT válido, así el auto-encadenamiento pasa el gate sin abrir el endpoint. */
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

/**
 * Procesa UN usuario: matching comprador→propiedad y vendedor→comprador, con sus mensajes y push.
 * Antes esto vivía como dos bloques sueltos en el handler; el seller-matching había quedado FUERA
 * del loop de usuarios (referenciando un `userId` fuera de scope → ReferenceError en cada corrida,
 * dead code ~2 meses). Extraerlo a esta función lo arregla: `userId` es un parámetro. Ver 86aj1pgvb.
 * Devuelve la cantidad de grupos de match creados (un grupo = un cliente con ≥1 propiedad/comprador).
 */
async function processUser(
  admin: any,
  userId: string,
  newProperties: PropertyRow[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ buyerGroups: number; sellerGroups: number }> {
  let buyerGroups = 0;
  let sellerGroups = 0;

  // ========== BUYER → PROPERTY MATCHING ==========
  // 1. Get this user's buyer/both clients
  const { data: clients } = await admin
    .from("clients")
    .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, status, notes")
    .eq("user_id", userId)
    .eq("is_client", true)
    .neq("client_type", "seller");

  if (clients && clients.length > 0) {
    // 1b. Get already-notified pairs for this user
    const { data: alreadyNotified } = await admin
      .from("notified_matches")
      .select("client_id, property_id")
      .eq("user_id", userId);

    const notifiedSet = new Set(
      (alreadyNotified || []).map((r: any) => `${r.client_id}:${r.property_id}`)
    );

    // 2. Cross each property with each client, skipping already notified
    const clientMatches: Map<string, { client: ClientRow; properties: { prop: PropertyRow; reasons: string[] }[] }> = new Map();
    // convId por cliente, capturado al crear/encontrar la conversación, para deep-linkear
    // el push a la conversación del cliente más caliente. Ver finding push-matches-deeplink-roto.
    const convIdByClient = new Map<string, string>();

    for (const prop of newProperties as PropertyRow[]) {
      for (const client of clients as ClientRow[]) {
        // Skip if already notified
        if (notifiedSet.has(`${client.id}:${prop.id}`)) continue;

        const reasons = findMatchReasons(prop, client);
        // Umbral por cliente: solo-zona entra con 1, el resto exige 2 (ver minReasonsFor).
        if (reasons.length >= minReasonsFor(client)) {
          if (!clientMatches.has(client.id)) {
            clientMatches.set(client.id, { client, properties: [] });
          }
          clientMatches.get(client.id)!.properties.push({ prop, reasons });
        }
      }
    }

    if (clientMatches.size > 0) {
      // 3. For each matched client, create/find conversation and insert message
      for (const [clientId, { client, properties: matchedProps }] of clientMatches) {
        // Find last conversation assigned to this client
        const { data: existingConv } = await admin
          .from("conversations")
          .select("id")
          .eq("user_id", userId)
          .eq("client_id", clientId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let convId: string;

        if (existingConv) {
          convId = existingConv.id;
        } else {
          // Create new conversation for this client
          const { data: newConv, error: convErr } = await admin
            .from("conversations")
            .insert({
              user_id: userId,
              title: `🔔 Matches para ${client.full_name}`,
              client_id: clientId,
              conversation_type: "proactive_match",
            })
            .select("id")
            .single();

          if (convErr) {
            console.error(`Failed to create conv for client ${clientId}:`, convErr);
            continue;
          }
          convId = newConv.id;
        }

        // Capturar la conversación de este cliente para el deep-link del push.
        convIdByClient.set(clientId, convId);

        // Build message content
        const lines: string[] = [
          `🔔 **Nuevas propiedades para ${client.full_name}**\n`,
        ];
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

        const messageContent = lines.join("\n");

        // Insert assistant message
        await admin.from("messages").insert({
          conversation_id: convId,
          role: "assistant",
          content: messageContent,
        });

        // Update conversation timestamp
        await admin
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", convId);

        // Record notified matches to avoid duplicates + crear el vínculo estructurado en
        // client_properties (status 'sugerida') para cerrar el loop "Alan ACTÚA": el match
        // entra a list_client_properties y al pipeline de estados. ignoreDuplicates:true →
        // NO pisa una ficha ya movida a enviada/visitada. Ver ticket 86aj1f13j.
        const shown = matchedProps.slice(0, 5);
        const notifyRecords = shown.map(({ prop }) => ({
          user_id: userId,
          client_id: clientId,
          property_id: prop.id,
        }));
        const clientPropertyRecords = shown.map(({ prop, reasons }) => ({
          user_id: userId,
          client_id: clientId,
          property_id: prop.id,
          status: "sugerida",
          notes: `Match automático (${new Date().toISOString().slice(0, 10)}): ${reasons.join(", ")}`,
        }));
        await Promise.all([
          admin.from("notified_matches").upsert(notifyRecords, {
            onConflict: "user_id,client_id,property_id",
            ignoreDuplicates: true,
          }),
          admin.from("client_properties").upsert(clientPropertyRecords, {
            onConflict: "client_id,property_id",
            ignoreDuplicates: true,
          }),
        ]);

        buyerGroups++;
      }

      // 4. Send push notification to user
      // El push se dispara para clientes de CUALQUIER status (cold incluido: un match nuevo
      // es la excusa para revivir el lead). Solo ordenamos hot>warm>cold para que los 3
      // nombres truncados muestren primero los más calientes. Ver ticket 86aj1f13j.
      const sortedMatches = [...clientMatches.values()]
        .sort((a, b) => tempRank(a.client.status) - tempRank(b.client.status));
      const clientNames = sortedMatches.map((m) => m.client.full_name).slice(0, 3);
      const extra = clientMatches.size > 3 ? ` y ${clientMatches.size - 3} más` : "";
      // Deep-link a la conversación del cliente con match más caliente que tenga conv creada;
      // fallback "/" (NUNCA "/chat": ruta inexistente → NotFound). Que el convId no sea null
      // habilita además la supresión de isViewingConversation en el SW (push-visibility.ts).
      const matchConvId = sortedMatches
        .map((m) => convIdByClient.get(m.client.id))
        .find((id): id is string => Boolean(id));
      const matchUrl = matchConvId ? `/?c=${matchConvId}` : "/";

      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: userId,
            title: "🔔 Nuevos matches de propiedades",
            body: `Encontré propiedades para ${clientNames.join(", ")}${extra}`,
            url: matchUrl,
          }),
        });
      } catch (pushErr) {
        console.error(`Push notification failed for user ${userId}:`, pushErr);
      }
    }
  }

  // ========== SELLER → BUYER MATCHING ==========
  // 5. Get this user's seller clients
  const { data: sellers } = await admin
    .from("clients")
    .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes, status")
    .eq("user_id", userId)
    .eq("is_client", true)
    .eq("client_type", "seller");

  if (sellers && sellers.length > 0) {
    // Get buyers for cross-matching
    const { data: buyers } = await admin
      .from("clients")
      .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes, phone, email, status")
      .eq("user_id", userId)
      .eq("is_client", true)
      .neq("client_type", "seller");

    if (buyers && buyers.length > 0) {
      // Get already-notified seller-buyer pairs (stored as client_id=seller, property_id=buyer)
      const { data: sellerNotified } = await admin
        .from("notified_matches")
        .select("client_id, property_id")
        .eq("user_id", userId);

      const sellerNotifiedSet = new Set(
        (sellerNotified || []).map((r: any) => `${r.client_id}:${r.property_id}`)
      );

      let sellerMatchCount = 0;
      // {seller, convId} de los vendedores con match, para deep-linkear el push.
      const matchedSellers: { seller: ClientRow; convId: string }[] = [];

      for (const seller of sellers as ClientRow[]) {
        const matchedBuyers: { buyer: ClientRow & { phone?: string; email?: string }; reasons: string[] }[] = [];

        for (const buyer of buyers as (ClientRow & { phone?: string; email?: string })[]) {
          // Skip if already notified (seller_id:buyer_id)
          if (sellerNotifiedSet.has(`${seller.id}:${buyer.id}`)) continue;

          const reasons = findSellerBuyerMatchReasons(seller, buyer);
          // Mismo criterio que buyer→propiedad, sobre el seller (la entidad que se notifica):
          // seller solo-zona entra con 1 reason, el resto exige 2.
          if (reasons.length >= minReasonsFor(seller)) {
            matchedBuyers.push({ buyer, reasons });
          }
        }

        if (matchedBuyers.length === 0) continue;

        // Find or create conversation for this seller
        const { data: existingConv } = await admin
          .from("conversations")
          .select("id")
          .eq("user_id", userId)
          .eq("client_id", seller.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let convId: string;
        if (existingConv) {
          convId = existingConv.id;
        } else {
          const { data: newConv, error: convErr } = await admin
            .from("conversations")
            .insert({
              user_id: userId,
              title: `🔔 Compradores para ${seller.full_name}`,
              client_id: seller.id,
              conversation_type: "proactive_match",
            })
            .select("id")
            .single();

          if (convErr) {
            console.error(`Failed to create conv for seller ${seller.id}:`, convErr);
            continue;
          }
          convId = newConv.id;
        }

        // Capturar la conversación de este vendedor para el deep-link del push.
        matchedSellers.push({ seller, convId });

        // Build seller match message
        const lines: string[] = [
          `🔔 **Posibles compradores para el inmueble de ${seller.full_name}**\n`,
        ];
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

        await admin.from("messages").insert({
          conversation_id: convId,
          role: "assistant",
          content: lines.join("\n"),
        });

        await admin
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", convId);

        // Record notified seller-buyer pairs (reuse notified_matches: client_id=seller, property_id=buyer)
        const notifyRecords = matchedBuyers.slice(0, 5).map(({ buyer }) => ({
          user_id: userId,
          client_id: seller.id,
          property_id: buyer.id, // buyer id stored as property_id for dedup
        }));
        await admin.from("notified_matches").upsert(notifyRecords, {
          onConflict: "user_id,client_id,property_id",
          ignoreDuplicates: true,
        });

        sellerMatchCount++;
        sellerGroups++;
      }

      // Push notification for seller matches
      if (sellerMatchCount > 0) {
        const sellerNames = (sellers as ClientRow[])
          .slice()
          .sort((a, b) => tempRank(a.status) - tempRank(b.status))
          .map((s) => s.full_name)
          .slice(0, 3);
        const extra = sellerMatchCount > 3 ? ` y ${sellerMatchCount - 3} más` : "";
        // Deep-link a la conversación del vendedor con match más caliente; fallback "/".
        const topSeller = [...matchedSellers]
          .sort((a, b) => tempRank(a.seller.status) - tempRank(b.seller.status))[0];
        const matchUrl = topSeller ? `/?c=${topSeller.convId}` : "/";

        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              user_id: userId,
              title: "🔔 Compradores encontrados",
              body: `Encontré compradores para ${sellerNames.join(", ")}${extra}`,
              url: matchUrl,
            }),
          });
        } catch (pushErr) {
          console.error(`Push notification (seller) failed for user ${userId}:`, pushErr);
        }
      }
    }
  }

  return { buyerGroups, sellerGroups };
}

/** Distinct user_ids con clientes (cualquier tipo), ordenados. Columna única → query barata.
 *  Dedup/orden en JS para poder paginar por keyset (user_id > afterUserId) de forma estable
 *  ante cambios del set entre lotes. */
async function fetchUserIds(admin: any): Promise<string[]> {
  const { data } = await admin.from("clients").select("user_id").eq("is_client", true);
  return [...new Set((data || []).map((r: any) => r.user_id as string))].sort() as string[];
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
    try {
      body = await req.json();
    } catch { /* sin body: arranque de corrida (orchestrator) */ }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ─── ORCHESTRATOR MODE ───
    // Llamada externa (cron o manual): registra la corrida y dispara el primer lote.
    if (isOrchestratorCall(body)) {
      const batchTimestamp = new Date().toISOString();

      const { count: propCount } = await admin
        .from("properties")
        .select("id", { count: "exact", head: true })
        .or(`created_at.gte.${since},last_seen_at.gte.${since}`);

      const userIds = await fetchUserIds(admin);
      const usersTotal = userIds.length;
      const propertiesScanned = propCount ?? 0;

      // Nada que procesar: cerramos la corrida como success de una (corrida vacía legítima).
      if (propertiesScanned === 0 || usersTotal === 0) {
        await admin.from("match_runs").insert({
          batch_id: batchTimestamp,
          started_at: batchTimestamp,
          finished_at: new Date().toISOString(),
          users_total: usersTotal,
          properties_scanned: propertiesScanned,
          status: "success",
        });
        console.log(`Morning matches: nada para procesar (props=${propertiesScanned}, users=${usersTotal})`);
        return new Response(JSON.stringify({ mode: "orchestrator", matches: 0, reason: "nada para procesar" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await admin.from("match_runs").insert({
        batch_id: batchTimestamp,
        started_at: batchTimestamp,
        users_total: usersTotal,
        properties_scanned: propertiesScanned,
        status: "running",
      });

      // Dispara el primer lote (desde el inicio). Cada worker encadena el siguiente.
      selfInvoke(supabaseUrl, serviceKey, { batchTimestamp, afterUserId: null });

      console.log(`Morning matches iniciado: ${usersTotal} usuarios, ${propertiesScanned} props nuevas (batch ${batchTimestamp})`);
      return new Response(JSON.stringify({ mode: "orchestrator", batch_timestamp: batchTimestamp, users_total: usersTotal }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── WORKER MODE: procesa un lote de usuarios y se auto-encadena ───
    const batchTimestamp = body.batchTimestamp as string;
    const afterUserId = typeof body.afterUserId === "string" && body.afterUserId ? body.afterUserId : null;

    // Helper: finalizar la corrida (último lote o sin nada que hacer).
    const finalizeRun = async (run: any, firstError: string | null) => {
      const status = computeRunStatus(run?.users_processed ?? 0, run?.user_errors ?? 0, run?.users_total ?? 0);
      await admin
        .from("match_runs")
        .update({
          status,
          finished_at: new Date().toISOString(),
          error_detail: firstError ?? run?.error_detail ?? null,
        })
        .eq("batch_id", batchTimestamp);
      console.log(`Morning matches finalizado (${status}): ${run?.users_processed ?? 0} usuarios, ${run?.buyer_match_groups ?? 0} buyer / ${run?.seller_match_groups ?? 0} seller groups (batch ${batchTimestamp})`);
    };

    // Estado acumulado de la corrida (filas previas de este batch).
    const { data: runRow } = await admin
      .from("match_runs")
      .select("*")
      .eq("batch_id", batchTimestamp)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Propiedades nuevas/actualizadas (re-fetch por lote: una query indexada, barata).
    const { data: newProperties } = await admin
      .from("properties")
      .select(PROPERTY_SELECT)
      .or(`created_at.gte.${since},last_seen_at.gte.${since}`)
      .limit(500);

    if (!newProperties || newProperties.length === 0) {
      await finalizeRun(runRow, runRow?.error_detail ?? null);
      return new Response(JSON.stringify({ mode: "worker", matches: 0, reason: "sin propiedades nuevas" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lote de usuarios por keyset (user_id > afterUserId).
    const allUserIds = await fetchUserIds(admin);
    const remaining = allUserIds.filter((id) => afterUserId === null || id > afterUserId);
    const batch = remaining.slice(0, USERS_PER_INVOCATION);

    if (batch.length === 0) {
      await finalizeRun(runRow, runRow?.error_detail ?? null);
      return new Response(JSON.stringify({ mode: "worker", matches: 0, reason: "sin usuarios restantes" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let errors = 0;
    let buyerGroups = 0;
    let sellerGroups = 0;
    let firstError: string | null = runRow?.error_detail ?? null;

    for (const uid of batch) {
      try {
        const r = await processUser(admin, uid, newProperties as PropertyRow[], supabaseUrl, serviceKey);
        buyerGroups += r.buyerGroups;
        sellerGroups += r.sellerGroups;
      } catch (userErr) {
        errors++;
        const msg = userErr instanceof Error ? userErr.message : String(userErr);
        console.error(`processUser falló para ${uid}:`, msg);
        if (!firstError) firstError = `user ${uid}: ${msg}`;
      }
      processed++;
    }

    // Acumular contadores en la fila de la corrida (lotes secuenciales → sin race).
    const newProcessed = (runRow?.users_processed ?? 0) + processed;
    const newErrors = (runRow?.user_errors ?? 0) + errors;
    const newBuyer = (runRow?.buyer_match_groups ?? 0) + buyerGroups;
    const newSeller = (runRow?.seller_match_groups ?? 0) + sellerGroups;
    const usersTotal = runRow?.users_total ?? allUserIds.length;

    const hasMore = remaining.length > batch.length;
    const lastUserId = batch[batch.length - 1];

    if (hasMore) {
      // Persistir el avance y encadenar el siguiente lote (status sigue 'running').
      await admin
        .from("match_runs")
        .update({
          users_processed: newProcessed,
          user_errors: newErrors,
          buyer_match_groups: newBuyer,
          seller_match_groups: newSeller,
          error_detail: firstError,
        })
        .eq("batch_id", batchTimestamp);

      selfInvoke(supabaseUrl, serviceKey, { batchTimestamp, afterUserId: lastUserId });

      return new Response(JSON.stringify({ mode: "worker", batch_processed: processed, has_more: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Último lote: persistir + finalizar con status real.
    const status = computeRunStatus(newProcessed, newErrors, usersTotal);
    await admin
      .from("match_runs")
      .update({
        users_processed: newProcessed,
        user_errors: newErrors,
        buyer_match_groups: newBuyer,
        seller_match_groups: newSeller,
        status,
        finished_at: new Date().toISOString(),
        error_detail: firstError,
      })
      .eq("batch_id", batchTimestamp);

    console.log(`Morning matches finalizado (${status}): ${newProcessed} usuarios, ${newBuyer} buyer / ${newSeller} seller groups (batch ${batchTimestamp})`);
    return new Response(JSON.stringify({ mode: "worker", matches: newBuyer + newSeller, status, has_more: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    reportEdgeErrorBg({ context: "morning-matches", error: err });
    return errorResponse(safeError(err, "morning-matches"), 500);
  }
});
