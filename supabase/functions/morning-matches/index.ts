import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- Matching helpers (mirrored from frontend use-property-matches.ts) ----

function normalizePropertyType(raw: string): string[] {
  const lower = raw.toLowerCase().replace(/_/g, " ").trim();
  const tokens: string[] = [];
  if (/\bdepartamento\b/.test(lower)) tokens.push("departamento");
  if (/\bcasa\b/.test(lower)) tokens.push("casa");
  if (/\bph\b/.test(lower)) tokens.push("ph", "duplex", "triplex");
  if (/\bduplex\b|\bdúplex\b/.test(lower)) tokens.push("duplex", "ph");
  if (/\blote\b|\bterreno\b/.test(lower)) tokens.push("terreno", "lote");
  if (/\blocal\b/.test(lower)) tokens.push("local");
  if (/\boficina\b/.test(lower)) tokens.push("oficina");
  if (/\bgalpón\b|\bgalpon\b/.test(lower)) tokens.push("galpon");
  if (/\bcochera\b/.test(lower)) tokens.push("cochera");
  if (/\bcampo\b/.test(lower)) tokens.push("campo");
  if (/\bfondo de comercio\b/.test(lower)) tokens.push("fondo de comercio");
  if (tokens.length === 0) tokens.push(lower);
  return [...new Set(tokens)];
}

function extractZoneFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  const zonePatterns = [
    /\b(docta)\b/i, /\b(manantiales)\b/i, /\b(valle escondido)\b/i, /\b(housing)\b/i,
    /\b(greenville)\b/i, /\b(claros del bosque)\b/i, /\b(siete soles)\b/i,
    /\b(la calandria)\b/i, /\b(la cascada)\b/i, /\b(jardín claret)\b/i,
    /\b(jardin claret)\b/i, /\b(lomas de la carolina)\b/i, /\b(la rufina)\b/i,
    /\b(cinco lomas)\b/i, /\b(causana)\b/i, /\b(altos del chateau)\b/i,
    /\b(chacras del norte)\b/i, /\b(tierra alta)\b/i, /\b(cuesta colorada)\b/i,
    /\b(nuevo poeta)\b/i, /\b(poeta lugones)\b/i,
    /\b(arguello)\b/i, /\b(argüello)\b/i, /\b(villa allende)\b/i,
    /\b(mendiolaza)\b/i, /\b(unquillo)\b/i, /\b(villa warcalde)\b/i,
    /\b(cerro de las rosas)\b/i,
    /\b(nueva córdoba)\b/i, /\b(nueva cordoba)\b/i,
    /\b(general paz)\b/i, /\b(alto alberdi)\b/i, /\b(alberdi)\b/i,
    /\b(alta córdoba)\b/i, /\b(alta cordoba)\b/i,
    /\b(güemes)\b/i, /\b(guemes)\b/i, /\b(cofico)\b/i,
    /\b(san vicente)\b/i, /\b(observatorio)\b/i,
    /\b(villa cabrera)\b/i, /\b(urca)\b/i, /\b(villa belgrano)\b/i,
    /\b(barrio jardín)\b/i, /\b(barrio jardin)\b/i,
    /\b(saldán)\b/i, /\b(saldan)\b/i,
    /\b(río ceballos)\b/i, /\b(rio ceballos)\b/i,
    /\b(la calera)\b/i, /\b(villa carlos paz)\b/i,
    /\b(centro)\b/i,
  ];
  for (const pattern of zonePatterns) {
    const match = lower.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractTypeFromTitle(title: string): string[] {
  const lower = title.toLowerCase();
  const tokens: string[] = [];
  if (/\bduplex\b|\bdúplex\b/.test(lower)) tokens.push("duplex", "ph");
  if (/\bdepartamento\b|\bdepto\b|\bdpto\b/.test(lower)) tokens.push("departamento");
  if (/\bcasa\b/.test(lower)) tokens.push("casa");
  if (/\blote\b|\bterreno\b/.test(lower)) tokens.push("lote", "terreno");
  if (/\bph\b/.test(lower)) tokens.push("ph", "duplex");
  if (/\blocal\b/.test(lower)) tokens.push("local");
  if (/\boficina\b/.test(lower)) tokens.push("oficina");
  return [...new Set(tokens)];
}

/** Extract zone keywords from client notes */
function extractClientZonesFromNotes(notes: string): string[] {
  const lower = notes.toLowerCase();
  const zones: string[] = [];
  const zonePatterns = [
    /\b(docta)\b/i, /\b(manantiales)\b/i, /\b(valle escondido)\b/i,
    /\b(greenville)\b/i, /\b(claros del bosque)\b/i, /\b(siete soles)\b/i,
    /\b(la calandria)\b/i, /\b(la cascada)\b/i, /\b(jardín claret)\b/i,
    /\b(jardin claret)\b/i, /\b(lomas de la carolina)\b/i, /\b(la rufina)\b/i,
    /\b(cinco lomas)\b/i, /\b(causana)\b/i, /\b(altos del chateau)\b/i,
    /\b(chacras del norte)\b/i, /\b(tierra alta)\b/i, /\b(cuesta colorada)\b/i,
    /\b(nuevo poeta)\b/i, /\b(poeta lugones)\b/i,
    /\b(arguello)\b/i, /\b(argüello)\b/i, /\b(villa allende)\b/i,
    /\b(mendiolaza)\b/i, /\b(unquillo)\b/i, /\b(villa warcalde)\b/i,
    /\b(cerro de las rosas)\b/i,
    /\b(nueva córdoba)\b/i, /\b(nueva cordoba)\b/i,
    /\b(general paz)\b/i, /\b(alto alberdi)\b/i, /\b(alberdi)\b/i,
    /\b(alta córdoba)\b/i, /\b(alta cordoba)\b/i,
    /\b(güemes)\b/i, /\b(guemes)\b/i, /\b(cofico)\b/i,
    /\b(san vicente)\b/i, /\b(observatorio)\b/i,
    /\b(villa cabrera)\b/i, /\b(urca)\b/i, /\b(villa belgrano)\b/i,
    /\b(barrio jardín)\b/i, /\b(barrio jardin)\b/i,
    /\b(saldán)\b/i, /\b(saldan)\b/i,
    /\b(río ceballos)\b/i, /\b(rio ceballos)\b/i,
    /\b(la calera)\b/i, /\b(villa carlos paz)\b/i,
    /\b(centro)\b/i,
  ];
  for (const pattern of zonePatterns) {
    const match = lower.match(pattern);
    if (match) zones.push(match[1].toLowerCase());
  }
  return [...new Set(zones)];
}

function zonesMatch(propertyZone: string, clientZone: string): boolean {
  const pz = propertyZone.trim().toLowerCase();
  const cz = clientZone.trim().toLowerCase();
  if (pz === cz || pz.includes(cz) || cz.includes(pz)) return true;
  // Strict partial word matching: both words must be 4+ chars and similar length
  const pzWords = pz.split(/\s+/);
  const czWords = cz.split(/\s+/);
  return pzWords.some((w) => w.length >= 4 && czWords.some((cw) => {
    if (cw.length < 4) return false;
    const shorter = w.length <= cw.length ? w : cw;
    const longer = w.length > cw.length ? w : cw;
    return longer.includes(shorter) && shorter.length / longer.length >= 0.75;
  }));
}

function parseNumberWithSuffix(numStr: string, suffix?: string): number {
  const n = Number(numStr.replace(/[.,]/g, ""));
  if (!suffix) return n;
  const s = suffix.toLowerCase();
  if (s === "k") return n * 1000;
  if (s === "m") return n * 1000000;
  return n;
}

interface PropertyRow {
  id: string;
  zone: string | null;
  price: number | null;
  currency: string | null;
  property_type: string | null;
  title: string | null;
  locality: string | null;
  operation: string | null;
  address: string | null;
  m2_total: number | null;
  ambientes: number | null;
  url: string | null;
}

interface ClientRow {
  id: string;
  full_name: string;
  preferred_zones: string | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  property_type_interest: string | null;
  client_type: string;
  notes: string | null;
}

function buildClientSearchSummary(client: ClientRow): string {
  const parts: string[] = [];

  // Tipo
  const types = client.property_type_interest
    ?.split(",").map((t) => t.trim()).filter(Boolean) || [];
  if (types.length === 0 && client.notes) {
    const noteTypes = extractTypeFromTitle(client.notes);
    if (noteTypes.length) types.push(...noteTypes);
  }

  // Zonas
  const zones = client.preferred_zones
    ?.split(",").map((z) => z.trim()).filter(Boolean) || [];
  if (client.notes) {
    const noteZones = extractClientZonesFromNotes(client.notes);
    for (const z of noteZones) {
      if (!zones.some((ez) => ez.toLowerCase() === z)) zones.push(z);
    }
  }

  // Construir texto tipo + zona
  const typeStr = types.length
    ? types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join("/")
    : null;
  const zoneStr = zones.length ? zones.join(", ") : null;
  if (typeStr && zoneStr) parts.push(`${typeStr} en ${zoneStr}`);
  else if (typeStr) parts.push(typeStr);
  else if (zoneStr) parts.push(`en ${zoneStr}`);

  // Presupuesto
  if (client.budget_max) {
    const curr = client.budget_currency || "USD";
    parts.push(`Hasta ${curr} ${client.budget_max.toLocaleString("es-AR")}`);
  } else if (client.budget_min) {
    // Legacy: single value stored in min = treat as max
    const curr = client.budget_currency || "USD";
    parts.push(`Hasta ${curr} ${client.budget_min.toLocaleString("es-AR")}`);
  }

  // Fallback: si no hay datos estructurados, usar notas
  if (parts.length === 0 && client.notes) {
    return `🔍 **Busca:** ${client.notes.substring(0, 100)}`;
  }

  return parts.length ? `🔍 **Busca:** ${parts.join(" · ")}` : "";
}

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

function findSellerBuyerMatchReasons(seller: ClientRow, buyer: ClientRow): string[] {
  // Extract what the seller is selling
  const sellerTypes = seller.property_type_interest
    ? seller.property_type_interest.split(",").map((t) => t.trim()).filter(Boolean).flatMap(normalizePropertyType)
    : [];
  if (sellerTypes.length === 0 && seller.notes) {
    sellerTypes.push(...extractTypeFromTitle(seller.notes));
  }

  const sellerZones = seller.preferred_zones
    ? seller.preferred_zones.split(",").map((z) => z.trim()).filter(Boolean)
    : [];
  if (seller.notes) {
    const noteZones = extractClientZonesFromNotes(seller.notes);
    for (const z of noteZones) {
      if (!sellerZones.some((ez) => ez.toLowerCase() === z)) sellerZones.push(z);
    }
  }

  // Extract what the buyer wants
  const buyerTypes = buyer.property_type_interest
    ? buyer.property_type_interest.split(",").map((t) => t.trim()).filter(Boolean).flatMap(normalizePropertyType)
    : [];
  if (buyerTypes.length === 0 && buyer.notes) {
    buyerTypes.push(...extractTypeFromTitle(buyer.notes));
  }

  const buyerZones = buyer.preferred_zones
    ? buyer.preferred_zones.split(",").map((z) => z.trim()).filter(Boolean)
    : [];
  if (buyer.notes) {
    const noteZones = extractClientZonesFromNotes(buyer.notes);
    for (const z of noteZones) {
      if (!buyerZones.some((ez) => ez.toLowerCase() === z)) buyerZones.push(z);
    }
  }

  const reasons: string[] = [];

  // Zone — mandatory if seller has zone info
  if (sellerZones.length > 0) {
    if (buyerZones.length === 0) return [];
    const zoneMatch = sellerZones.some((sz) => buyerZones.some((bz) => zonesMatch(sz, bz)));
    if (!zoneMatch) return [];
    reasons.push(`📍 Zona: ${sellerZones.join(", ")}`);
  } else if (buyerZones.length > 0 && sellerZones.length === 0) {
    // Seller has no zone info — can't confirm zone match
    return [];
  }

  // Type
  if (sellerTypes.length > 0 && buyerTypes.length > 0) {
    if (sellerTypes.some((st) => buyerTypes.includes(st))) {
      reasons.push(`🏗️ Tipo: ${[...new Set(sellerTypes)].join("/")}`);
    }
  }

  // Budget compatibility (buyer budget vs seller asking price)
  const buyerEffectiveMax = buyer.budget_max ?? buyer.budget_min;
  if (seller.budget_min && buyerEffectiveMax) {
    const sameCurrency = !seller.budget_currency || !buyer.budget_currency || seller.budget_currency === buyer.budget_currency;
    if (sameCurrency && buyerEffectiveMax * 1.30 >= seller.budget_min) {
      reasons.push("💰 Presupuesto compatible");
    }
  }

  return reasons;
}

function formatBuyerLine(buyer: ClientRow): string {
  const lines: string[] = [];
  lines.push(`👤 **${buyer.full_name}**`);
  const summary = buildClientSearchSummary(buyer);
  if (summary) lines.push(summary);
  if ((buyer as any).phone) lines.push(`📞 ${(buyer as any).phone}`);
  return lines.join("\n");
}

function findMatchReasons(property: PropertyRow, client: ClientRow): string[] {
  const effectiveZone =
    property.zone
    || (property.title ? extractZoneFromTitle(property.title) : null)
    || (property.locality ? extractZoneFromTitle(property.locality) : null)
    || property.locality;

  const baseTypeTokens = property.property_type ? normalizePropertyType(property.property_type) : [];
  const titleTypeTokens = (!property.property_type && property.title) ? extractTypeFromTitle(property.title) : [];
  const effectiveTypeTokens = [...new Set([...baseTypeTokens, ...titleTypeTokens])];

  const reasons: string[] = [];

  // Build client zones from structured data + notes
  const structuredZones = client.preferred_zones
    ? client.preferred_zones.split(",").map((z) => z.trim()).filter(Boolean)
    : [];
  const noteZones = client.notes ? extractClientZonesFromNotes(client.notes) : [];
  const allClientZones = [...new Set([...structuredZones, ...noteZones])];

  // Zone — MANDATORY if client has zone preferences
  if (allClientZones.length > 0) {
    if (!effectiveZone || !allClientZones.some((z) => zonesMatch(effectiveZone, z))) {
      return []; // No zone match → skip entirely
    }
    reasons.push(`📍 Zona: ${effectiveZone}`);
  } else if (effectiveZone && client.preferred_zones) {
    const clientZones = client.preferred_zones.split(",").map((z) => z.trim()).filter(Boolean);
    if (clientZones.some((z) => zonesMatch(effectiveZone, z))) {
      reasons.push(`📍 Zona: ${effectiveZone}`);
    }
  }

  // Type — MANDATORY if client has type preference
  if (client.property_type_interest) {
    const clientTokens = client.property_type_interest
      .split(",").map((t) => t.trim()).filter(Boolean).flatMap(normalizePropertyType);

    const allTypeTokens = [...effectiveTypeTokens];
    if (allTypeTokens.length === 0 && property.title) {
      allTypeTokens.push(...extractTypeFromTitle(property.title));
    }

    if (allTypeTokens.length === 0 || !allTypeTokens.some((pt) => clientTokens.includes(pt))) {
      return []; // No type match → skip entirely
    }
    reasons.push(`🏗️ Tipo: ${property.property_type || "desde título"}`);
  }

  // Budget (structured fields)
  if (property.price) {
    const effectiveMax = client.budget_max ?? client.budget_min;
    const effectiveMin = client.budget_max ? client.budget_min : null;
    const sameCurrency = !client.budget_currency || !property.currency || client.budget_currency === property.currency;
    if (sameCurrency && effectiveMax) {
      const upperLimit = effectiveMax * 1.30;
      const lowerLimit = effectiveMin ? effectiveMin * 0.85 : 0;
      if (property.price <= upperLimit && property.price >= lowerLimit) {
        reasons.push(`💰 Presupuesto: ${client.budget_currency || "USD"} ${effectiveMax.toLocaleString("es-AR")}`);
      }
    }
  }

  // Notes supplement
  if (client.notes) {
    const lower = client.notes.toLowerCase();
    const existingPrefixes = new Set(reasons.map((r) => r.substring(0, 2)));

    if (!existingPrefixes.has("📍") && effectiveZone) {
      const zoneWords = effectiveZone.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      if (zoneWords.some((w) => lower.includes(w))) reasons.push(`📍 Zona (notas): ${effectiveZone}`);
    }

    if (!existingPrefixes.has("🏗️") && effectiveTypeTokens.length > 0) {
      if (effectiveTypeTokens.some((t) => lower.includes(t))) reasons.push(`🏗️ Tipo (notas)`);
    }

    if (!existingPrefixes.has("💰") && property.price) {
      const budgetRegex = /(\d+(?:[.,]\d+)?)\s*(k|m)?(?:\s*(?:usd|dol|pesos|ars))?\b/gi;
      let match;
      while ((match = budgetRegex.exec(lower)) !== null) {
        const val = parseNumberWithSuffix(match[1], match[2]);
        if (val > 1000 && property.price <= val * 1.30 && property.price >= val * 0.5) {
          reasons.push("💰 Presupuesto (notas)");
          break;
        }
      }
    }
  }

  return reasons;
}

function formatPropertyLine(p: PropertyRow): string {
  const lines: string[] = [];
  if (p.title) lines.push(`🏠 **${p.title}**`);
  if (p.price) lines.push(`💰 ${p.currency || "USD"} ${p.price.toLocaleString("es-AR")}`);
  if (p.address) lines.push(`📍 ${p.address}`);
  const surfaceParts: string[] = [];
  if (p.m2_total) surfaceParts.push(`${p.m2_total} m²`);
  if (p.ambientes) surfaceParts.push(`${p.ambientes} amb.`);
  if (surfaceParts.length) lines.push(`📐 ${surfaceParts.join(" · ")}`);
  if (p.url) lines.push(`🔗 [Ver propiedad](${p.url})`);
  return lines.join("\n");
}

// ---- Main handler ----

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Get properties added/updated in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: newProperties, error: propErr } = await admin
      .from("properties")
      .select("id, zone, price, currency, property_type, title, locality, operation, address, m2_total, ambientes, url")
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
      .neq("client_type", "seller");

    const uniqueUserIds = [...new Set((userIds || []).map((r) => r.user_id))];
    console.log(`Processing ${uniqueUserIds.length} users`);

    let totalMatches = 0;

    for (const userId of uniqueUserIds) {
      // 3. Get this user's buyer/both clients
      const { data: clients } = await admin
        .from("clients")
        .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes")
        .eq("user_id", userId)
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

      for (const prop of newProperties as PropertyRow[]) {
        for (const client of clients as ClientRow[]) {
          // Skip if already notified
          if (notifiedSet.has(`${client.id}:${prop.id}`)) continue;

          const reasons = findMatchReasons(prop, client);
          if (reasons.length >= 2) {
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

        // Record notified matches to avoid duplicates
        const notifyRecords = matchedProps.slice(0, 5).map(({ prop }) => ({
          user_id: userId,
          client_id: clientId,
          property_id: prop.id,
        }));
        await admin.from("notified_matches").upsert(notifyRecords, {
          onConflict: "user_id,client_id,property_id",
          ignoreDuplicates: true,
        });

        totalMatches++;
      }

      // 6. Send push notification to user
      if (clientMatches.size > 0) {
        const clientNames = [...clientMatches.values()].map((m) => m.client.full_name).slice(0, 3);
        const extra = clientMatches.size > 3 ? ` y ${clientMatches.size - 3} más` : "";

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
              url: "/chat",
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
        .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes")
        .eq("user_id", userId)
        .eq("client_type", "seller");

      if (sellers && sellers.length > 0) {
        // Get buyers for cross-matching
        const { data: buyers } = await admin
          .from("clients")
          .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes, phone, email, status")
          .eq("user_id", userId)
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

          for (const seller of sellers as ClientRow[]) {
            const matchedBuyers: { buyer: ClientRow & { phone?: string; email?: string }; reasons: string[] }[] = [];

            for (const buyer of buyers as (ClientRow & { phone?: string; email?: string })[]) {
              // Skip if already notified (seller_id:buyer_id)
              if (sellerNotifiedSet.has(`${seller.id}:${buyer.id}`)) continue;

              const reasons = findSellerBuyerMatchReasons(seller, buyer);
              if (reasons.length >= 2) {
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
              .filter((s) => true)
              .map((s) => s.full_name)
              .slice(0, 3);
            const extra = sellerMatchCount > 3 ? ` y ${sellerMatchCount - 3} más` : "";

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
                  url: "/chat",
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
    console.error("morning-matches error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
