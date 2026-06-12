/**
 * Pure property↔client matching logic.
 *
 * Extracted from `use-property-matches.ts` so it can be unit-tested without
 * React or the Supabase client (importing the hook eagerly constructs the
 * Supabase client from `import.meta.env`, which is unavailable under Vitest).
 *
 * Behaviour here mirrors the original hook EXACTLY — these functions are a
 * faithful move, not a rewrite. The hook is now a thin wrapper that fetches
 * the agent's clients and delegates to `findPropertyMatches`.
 */

/** A client row, limited to the columns the matcher reads. */
export interface ClientForMatch {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_zones: string | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  property_type_interest: string | null;
  status: string;
  client_type: string;
  is_client: boolean;
  notes: string | null;
  last_contact_at: string | null;
}

export interface MatchedClient extends ClientForMatch {
  matchReasons: string[];
}

export interface PropertyForMatch {
  zone: string | null;
  price: number | null;
  currency: string | null;
  property_type: string | null;
  title: string | null;
  locality: string | null;
}

/** Normalize a property_type slug into comparable tokens */
export function normalizePropertyType(raw: string): string[] {
  const lower = raw.toLowerCase().replace(/_/g, " ").trim();
  const tokens: string[] = [];

  if (/\bdepartamento\b/.test(lower)) tokens.push("departamento");
  if (/\bcasa\b/.test(lower)) tokens.push("casa");
  if (/\bph\b/.test(lower)) tokens.push("ph", "duplex", "triplex");
  if (/\bduplex\b/.test(lower) || /\bdúplex\b/.test(lower)) tokens.push("duplex", "ph");
  if (/\blote\b/.test(lower) || /\bterreno\b/.test(lower)) tokens.push("terreno", "lote");
  if (/\blocal\b/.test(lower)) tokens.push("local");
  if (/\boficina\b/.test(lower)) tokens.push("oficina");
  if (/\bgalpón\b/.test(lower) || /\bgalpon\b/.test(lower)) tokens.push("galpon");
  if (/\bcochera\b/.test(lower)) tokens.push("cochera");
  if (/\bcampo\b/.test(lower)) tokens.push("campo");
  if (/\bfondo de comercio\b/.test(lower)) tokens.push("fondo de comercio");

  if (tokens.length === 0) tokens.push(lower);
  return [...new Set(tokens)];
}

/** Extract zone keywords from a property title when zone field is null */
export function extractZoneFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  // Common zone/neighborhood keywords in Córdoba real estate
  const zonePatterns = [
    // Desarrollos / countries conocidos
    /\b(docta)\b/i,
    /\b(manantiales)\b/i,
    /\b(valle escondido)\b/i,
    /\b(housing)\b/i,
    /\b(country)\b/i,
    /\b(greenville)\b/i,
    /\b(miradores)\b/i,
    /\b(claros del bosque)\b/i,
    /\b(cañuelas)\b/i,
    /\b(tejas)\b/i,
    /\b(comarca)\b/i,
    /\b(siete soles)\b/i,
    /\b(santina)\b/i,
    /\b(la calandria)\b/i,
    /\b(la cascada)\b/i,
    /\b(las delicias)\b/i,
    /\b(jardín claret)\b/i,
    /\b(jardin claret)\b/i,
    /\b(el bosque)\b/i,
    /\b(valle del golf)\b/i,
    /\b(lomas de la carolina)\b/i,
    /\b(la rufina)\b/i,
    /\b(cinco lomas)\b/i,
    /\b(causana)\b/i,
    /\b(terrazas de o'higgins)\b/i,
    /\b(el prado)\b/i,
    /\b(altos del chateau)\b/i,
    /\b(palmas del claret)\b/i,
    /\b(solares de santa maría)\b/i,
    /\b(solares de santa maria)\b/i,
    /\b(las cañitas)\b/i,
    /\b(las canitas)\b/i,
    /\b(chacras del norte)\b/i,
    /\b(don miguel)\b/i,
    /\b(jardines del olmo)\b/i,
    /\b(altos de villasol)\b/i,
    /\b(tierra alta)\b/i,
    /\b(cuesta colorada)\b/i,
    /\b(el remanso)\b/i,
    /\b(las piedras)\b/i,
    // Barrios tradicionales Córdoba Capital
    /\b(nuevo poeta)\b/i,
    /\b(poeta lugones)\b/i,
    /\b(arguello)\b/i,
    /\b(argüello)\b/i,
    /\b(villa allende)\b/i,
    /\b(mendiolaza)\b/i,
    /\b(unquillo)\b/i,
    /\b(villa warcalde)\b/i,
    /\b(cerro de las rosas)\b/i,
    /\b(nueva córdoba)\b/i,
    /\b(nueva cordoba)\b/i,
    /\b(general paz)\b/i,
    /\b(alto alberdi)\b/i,
    /\b(alberdi)\b/i,
    /\b(alta córdoba)\b/i,
    /\b(alta cordoba)\b/i,
    /\b(güemes)\b/i,
    /\b(guemes)\b/i,
    /\b(cofico)\b/i,
    /\b(juniors)\b/i,
    /\b(san vicente)\b/i,
    /\b(observatorio)\b/i,
    /\b(jardín(?:\s+espinosa)?)\b/i,
    /\b(jardin(?:\s+espinosa)?)\b/i,
    /\b(san martín)\b/i,
    /\b(san martin)\b/i,
    /\b(rogelio martínez)\b/i,
    /\b(rogelio martinez)\b/i,
    /\b(residencial américa)\b/i,
    /\b(residencial america)\b/i,
    /\b(villa cabrera)\b/i,
    /\b(cerro norte)\b/i,
    /\b(urca)\b/i,
    /\b(quebrada de las rosas)\b/i,
    /\b(villa belgrano)\b/i,
    /\b(parque vélez sársfield)\b/i,
    /\b(parque velez sarsfield)\b/i,
    /\b(pueyrredón)\b/i,
    /\b(pueyrredon)\b/i,
    // Sierras Chicas
    /\b(saldán)\b/i,
    /\b(saldan)\b/i,
    /\b(río ceballos)\b/i,
    /\b(rio ceballos)\b/i,
    /\b(la calera)\b/i,
    /\b(salsipuedes)\b/i,
    /\b(villa carlos paz)\b/i,
    /\b(cosquín)\b/i,
    /\b(cosquin)\b/i,
    /\b(la granja)\b/i,
    /\b(agua de oro)\b/i,
    // Zona Sur
    /\b(barrio jardín)\b/i,
    /\b(barrio jardin)\b/i,
    /\b(los platanos)\b/i,
    /\b(los boulevares)\b/i,
    /\b(inaudi)\b/i,
    /\b(tablada park)\b/i,
    // Genéricos
    /\b(centro)\b/i,
  ];

  for (const pattern of zonePatterns) {
    const match = lower.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/** Extract property type tokens from title */
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

/** Check if two zones match (case-insensitive, trimmed, also partial) */
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

/** Margen sobre el techo de presupuesto: se muestran propiedades hasta 30% más caras
 *  (se negocia a la baja y el comprador puede estirar con préstamo). */
export const BUDGET_MARGIN = 1.30;

/**
 * Rango de precio efectivo a partir del presupuesto del cliente (regla RE/MAX Docta):
 * - un solo valor → es el TECHO (máximo); piso 0; se muestra hasta techo * 1.30.
 * - dos valores → el menor es el piso y el mayor el techo (sin importar en qué columna
 *   estén); se aplica +30% sobre el techo.
 * Devuelve { floor, ceiling, declaredMax } o null si no hay presupuesto.
 */
export function budgetCeilingFloor(
  budgetMin: number | null,
  budgetMax: number | null
): { floor: number; ceiling: number; declaredMax: number } | null {
  const vals = [budgetMin, budgetMax].filter(
    (v): v is number => typeof v === "number" && isFinite(v) && v > 0
  );
  if (vals.length === 0) return null;
  if (vals.length === 1) {
    return { floor: 0, ceiling: vals[0] * BUDGET_MARGIN, declaredMax: vals[0] };
  }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return { floor: lo, ceiling: hi * BUDGET_MARGIN, declaredMax: hi };
}

/** Parse a number string that may have K/M suffix */
export function parseNumberWithSuffix(numStr: string, suffix?: string): number {
  const n = Number(numStr.replace(/[.,]/g, ""));
  if (!suffix) return n;
  const s = suffix.toLowerCase();
  if (s === "k") return n * 1000;
  if (s === "m") return n * 1000000;
  return n;
}

/** Palabras genéricas que NO alcanzan para afirmar coincidencia de zona/municipio. */
const ZONE_STOPWORDS = new Set([
  "del", "las", "los", "san", "santa", "villa", "barrio", "alto", "alta",
  "rio", "río", "calle", "este", "oeste", "norte", "sur", "parque",
]);

/** Try to extract matching info from free-text notes */
function extractFromNotes(
  notes: string,
  property: PropertyForMatch,
  effectiveZone: string | null,
  effectiveTypeTokens: string[],
  existingReasonPrefixes: Set<string>
): string[] {
  const reasons: string[] = [];
  const lower = notes.toLowerCase();

  // Zone match from notes (skip if already matched via structured data).
  // Solo contamos palabras DISTINTIVAS del zone de la propiedad: las stopwords y palabras
  // cortas ("del", "san", "villa", "norte"…) matchearían casi cualquier nota y cruzarían
  // municipios distintos (ej. "Falda del Carmen" matcheaba por "del"). Exigimos una palabra
  // significativa (>=4 chars, no stopword) presente como palabra completa.
  if (!existingReasonPrefixes.has("📍") && effectiveZone) {
    const zoneWords = effectiveZone
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !ZONE_STOPWORDS.has(w));
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (zoneWords.some((w) => new RegExp(`\\b${escapeRe(w)}\\b`).test(lower))) {
      reasons.push(`📍 Zona (notas): ${effectiveZone}`);
    }
  }

  // Property type match from notes (skip if already matched)
  if (!existingReasonPrefixes.has("🏗️") && effectiveTypeTokens.length > 0) {
    if (effectiveTypeTokens.some((t) => lower.includes(t))) {
      reasons.push(`🏗️ Tipo (notas): ${property.property_type || "desde título"}`);
    }
  }

  // Budget from notes — look for numbers with optional K/M suffix (skip if already matched)
  if (!existingReasonPrefixes.has("💰") && property.price) {
    // Match patterns like "110k", "110K", "110.000", "110000", "hasta 110k"
    const budgetRegex = /(\d+(?:[.,]\d+)?)\s*(k|m)?(?:\s*(?:usd|dol|pesos|ars))?\b/gi;
    let match;
    const parsedNumbers: number[] = [];
    while ((match = budgetRegex.exec(lower)) !== null) {
      const val = parseNumberWithSuffix(match[1], match[2]);
      if (val > 1000) parsedNumbers.push(val);
    }
    const BUDGET_TOLERANCE = 1.30;
    if (parsedNumbers.some((n) => property.price! <= n * BUDGET_TOLERANCE && property.price! >= n * 0.5)) {
      reasons.push(`💰 Presupuesto (notas)`);
    }
  }

  return reasons;
}

/** Effective zone for a property: structured field, then title, then locality. */
export function computeEffectiveZone(property: PropertyForMatch): string | null {
  return (
    property.zone
    || (property.title ? extractZoneFromTitle(property.title) : null)
    || (property.locality ? extractZoneFromTitle(property.locality) : null)
    || property.locality
  );
}

/** Effective property-type tokens: from the structured field, else from the title. */
export function computeEffectiveTypeTokens(property: PropertyForMatch): string[] {
  const baseTypeTokens = property.property_type
    ? normalizePropertyType(property.property_type)
    : [];
  const titleTypeTokens = (!property.property_type && property.title) ? extractTypeFromTitle(property.title) : [];
  return [...new Set([...baseTypeTokens, ...titleTypeTokens])];
}

/**
 * Compute the list of match reasons for a single client against a property.
 * Returns `null` when the client must be excluded outright (seller, or a
 * mandatory zone/type criterion that did not match) — mirroring the original
 * `continue` statements. Returns the reasons array otherwise (may be < 2).
 */
export function computeMatchReasons(
  property: PropertyForMatch,
  client: ClientForMatch,
  effectiveZone: string | null,
  effectiveTypeTokens: string[]
): string[] | null {
  // Solo los contactos marcados como cliente entran al matching.
  if (!client.is_client) return null;
  // Only match buyers or "both"
  if (client.client_type === "seller") return null;

  const reasons: string[] = [];

  // --- Build client zones from structured data + notes ---
  const structuredZones = client.preferred_zones
    ? client.preferred_zones.split(",").map((z: string) => z.trim()).filter(Boolean)
    : [];
  const noteZones = client.notes ? extractClientZonesFromNotes(client.notes) : [];
  const allClientZones = [...new Set([...structuredZones, ...noteZones])];

  // Zone — MANDATORY if client has zone preferences
  if (allClientZones.length > 0) {
    if (!effectiveZone || !allClientZones.some((z: string) => zonesMatch(effectiveZone, z))) {
      return null; // No zone match → skip entirely
    }
    reasons.push(`📍 Zona: ${effectiveZone}`);
  }

  // Type — MANDATORY if client has type preference
  if (client.property_type_interest) {
    const clientInterests = client.property_type_interest
      .split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
    const clientTokens = clientInterests.flatMap(normalizePropertyType);

    const allTypeTokens = [...effectiveTypeTokens];
    if (allTypeTokens.length === 0 && property.title) {
      allTypeTokens.push(...extractTypeFromTitle(property.title));
    }

    if (allTypeTokens.length === 0 || !allTypeTokens.some((pt) => clientTokens.includes(pt))) {
      return null; // No type match → skip entirely
    }
    reasons.push(`🏗️ Tipo: ${property.property_type || "desde título"}`);
  }

  // Budget match (structured fields): presupuesto = techo, +30% de margen (regla RE/MAX Docta)
  if (property.price) {
    const range = budgetCeilingFloor(client.budget_min, client.budget_max);
    const sameCurrency = !client.budget_currency || !property.currency || client.budget_currency === property.currency;

    if (sameCurrency && range && property.price >= range.floor && property.price <= range.ceiling) {
      reasons.push(`💰 Presupuesto: ${client.budget_currency || "USD"} ${range.declaredMax.toLocaleString("es-AR")}`);
    }
  }

  // --- Always check notes as supplement ---
  if (client.notes) {
    // Dedup key = the leading emoji token (split on the first space). Using
    // substring(0,2) was buggy: "🏗️" is 3 UTF-16 units (emoji + variation
    // selector U+FE0F), so the slice produced "🏗" and never matched the
    // has("🏗️") check — the type-from-notes reason was never deduped and
    // types could be counted twice.
    const existingPrefixes = new Set(reasons.map((r) => r.split(" ")[0]));
    const noteReasons = extractFromNotes(client.notes, property, effectiveZone, effectiveTypeTokens, existingPrefixes);
    reasons.push(...noteReasons);
  }

  return reasons;
}

/**
 * Find every client that matches the given property. A client is included only
 * when it accumulates at least 2 match reasons (to avoid false positives).
 * Results are sorted by number of reasons, descending.
 */
export function findPropertyMatches(
  property: PropertyForMatch,
  clients: ClientForMatch[]
): MatchedClient[] {
  const effectiveZone = computeEffectiveZone(property);
  const effectiveTypeTokens = computeEffectiveTypeTokens(property);

  const matched: MatchedClient[] = [];
  for (const c of clients) {
    const reasons = computeMatchReasons(property, c, effectiveZone, effectiveTypeTokens);
    // Require at least 2 matching criteria to avoid false positives
    if (reasons && reasons.length >= 2) {
      matched.push({ ...c, matchReasons: reasons });
    }
  }

  // Sort by number of matching criteria (desc)
  matched.sort((a, b) => b.matchReasons.length - a.matchReasons.length);
  return matched;
}
