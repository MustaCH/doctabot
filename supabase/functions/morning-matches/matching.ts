// Pure matching helpers for morning-matches (extracted from index.ts so they can be
// unit-tested and kept in sync with the frontend logic in src/lib/property-matching.ts).
// No Deno/runtime imports here — keep it pure TS so Vitest can import it.

export function normalizePropertyType(raw: string): string[] {
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

const ZONE_PATTERNS = [
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

export function extractZoneFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  for (const pattern of ZONE_PATTERNS) {
    const match = lower.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function extractTypeFromTitle(title: string): string[] {
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
export function extractClientZonesFromNotes(notes: string): string[] {
  const lower = notes.toLowerCase();
  const zones: string[] = [];
  for (const pattern of ZONE_PATTERNS) {
    const match = lower.match(pattern);
    if (match) zones.push(match[1].toLowerCase());
  }
  return [...new Set(zones)];
}

export function zonesMatch(propertyZone: string, clientZone: string): boolean {
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

/** Palabras genéricas que NO alcanzan para afirmar coincidencia de zona/municipio.
 *  (Mantener en sync con src/lib/property-matching.ts.) */
const ZONE_STOPWORDS = new Set([
  "del", "las", "los", "san", "santa", "villa", "barrio", "alto", "alta",
  "rio", "río", "calle", "este", "oeste", "norte", "sur", "parque",
]);

export function parseNumberWithSuffix(numStr: string, suffix?: string): number {
  const n = Number(numStr.replace(/[.,]/g, ""));
  if (!suffix) return n;
  const s = suffix.toLowerCase();
  if (s === "k") return n * 1000;
  if (s === "m") return n * 1000000;
  return n;
}

export interface PropertyRow {
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
  habitaciones: number | null;
  photo: string | null;
  url: string | null;
}

export interface ClientRow {
  id: string;
  full_name: string;
  preferred_zones: string | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  property_type_interest: string | null;
  client_type: string;
  status: string | null;
  notes: string | null;
}

export function findSellerBuyerMatchReasons(seller: ClientRow, buyer: ClientRow): string[] {
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

/** Umbral por defecto de reasons para notificar un match. */
export const MIN_MATCH_REASONS = 2;

/**
 * Umbral de reasons para que un cliente sea elegible para notificación.
 *
 * Un cliente "solo-zona" — tiene `preferred_zones` cargada pero NO `property_type_interest`
 * ni budget — alcanza con 1 reason (la zona matcheó), porque para ese cliente la zona es
 * todo lo que pidió. Antes el umbral fijo de 2 silenciaba estas fichas (las más comunes).
 * El resto (con tipo o budget) sigue exigiendo MIN_MATCH_REASONS. Ver ticket 86aj1f13j.
 */
export function minReasonsFor(client: {
  preferred_zones?: string | null;
  property_type_interest?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
}): number {
  const hasZone = !!(client.preferred_zones && client.preferred_zones.trim());
  const hasType = !!(client.property_type_interest && client.property_type_interest.trim());
  const hasBudget = !!(client.budget_min || client.budget_max);
  if (hasZone && !hasType && !hasBudget) return 1;
  return MIN_MATCH_REASONS;
}

export function findMatchReasons(property: PropertyRow, client: ClientRow): string[] {
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

    // Solo contamos palabras DISTINTIVAS del zone de la propiedad: las stopwords y palabras
    // cortas ("del", "san", "villa", "norte"…) matchearían casi cualquier nota y cruzarían
    // municipios distintos (ej. "Falda del Carmen" matcheaba por "del"). Exigimos una palabra
    // significativa (>=4 chars, no stopword) presente como palabra completa.
    if (!existingPrefixes.has("📍") && effectiveZone) {
      const zoneWords = effectiveZone
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !ZONE_STOPWORDS.has(w));
      const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (zoneWords.some((w) => new RegExp(`\\b${escapeRe(w)}\\b`).test(lower))) {
        reasons.push(`📍 Zona (notas): ${effectiveZone}`);
      }
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
