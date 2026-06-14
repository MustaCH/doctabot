import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";

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

// ---- Main handler ----

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Get properties added/updated in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: newProperties, error: propErr } = await admin
      .from("properties")
      .select("id, zone, price, currency, property_type, title, locality, operation, address, m2_total, habitaciones, photo, url")
      .or(`created_at.gte.${since},last_seen_at.gte.${since}`)
      .limit(500);

    if (propErr) throw propErr;
    if (!newProperties || newProperties.length === 0) {
      console.log("No new properties in last 24h");
      return new Response(JSON.stringify({ matches: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${newProperties.length} new/updated properties`);

    // 2. Get all users who have clients (distinct user_ids)
    const { data: userIds } = await admin
      .from("clients")
      .select("user_id")
      .eq("is_client", true)
      .neq("client_type", "seller");

    const uniqueUserIds = [...new Set((userIds || []).map((r) => r.user_id))];
    console.log(`Processing ${uniqueUserIds.length} users`);

    let totalMatches = 0;

    for (const userId of uniqueUserIds) {
      // 3. Get this user's buyer/both clients
      const { data: clients } = await admin
        .from("clients")
        .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, status, notes")
        .eq("user_id", userId)
        .eq("is_client", true)
        .neq("client_type", "seller");

      if (!clients || clients.length === 0) continue;

      // 3b. Get already-notified pairs for this user
      const { data: alreadyNotified } = await admin
        .from("notified_matches")
        .select("client_id, property_id")
        .eq("user_id", userId);

      const notifiedSet = new Set(
        (alreadyNotified || []).map((r: any) => `${r.client_id}:${r.property_id}`)
      );

      // 4. Cross each property with each client, skipping already notified
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

      if (clientMatches.size === 0) continue;

      // 5. For each matched client, create/find conversation and insert message
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

        totalMatches++;
      }

      // 6. Send push notification to user
      if (clientMatches.size > 0) {
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

      // ========== SELLER-TO-BUYER MATCHING ==========
      // 7. Get this user's seller clients
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
            totalMatches++;
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
    console.log(`Morning matches completed: ${totalMatches} client-match groups created`);

    return new Response(JSON.stringify({ matches: totalMatches }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(safeError(err, "morning-matches"), 500);
  }
});
