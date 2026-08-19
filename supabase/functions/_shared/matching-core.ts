// ============================================================================
// NÚCLEO COMPARTIDO de matching propiedad↔cliente (ticket 86aj9w5p3 / T3.4).
//
// FUENTE ÚNICA importada por:
//   - src/lib/property-matching.ts          (sugerencias en el front)
//   - supabase/functions/morning-matches/matching.ts  (cron nocturno)
//
// Antes esta lógica vivía COPIADA en ambos lados y divergió en silencio
// (ZONE_PATTERNS 90 vs 50, piso de presupuesto 0.85 solo en el back, bug de
// dedup substring(0,2) con emojis de 3 unidades UTF-16). Una propiedad podía
// matchear en el front y no en el cron. Si tocás algo acá, corré los tests de
// AMBOS lados (property-matching.test.ts y morning-matches/matching.test.ts).
//
// Sin imports de runtime (ni Deno ni browser): puro TS, importable por Vite,
// el bundler de edge functions y Vitest.
// ============================================================================

/** Normalize a property_type slug into comparable tokens */
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

/**
 * Patrones de zona para TÍTULOS de propiedades (superset: desarrollos, countries,
 * barrios, Sierras Chicas). Un título es texto controlado (viene del listing), así que
 * acá entran también términos genéricos como 'country'/'housing' que en una nota de
 * cliente serían ambiguos.
 */
export const ZONE_PATTERNS_TITLE: RegExp[] = [
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

/**
 * Patrones de zona para NOTAS de clientes (subconjunto CONSERVADOR y deliberado:
 * las notas son texto libre — 'country'/'housing'/'tejas' en una nota son ambiguos y
 * convertirían la zona en criterio OBLIGATORIO equivocado). No agregar genéricos acá.
 */
export const ZONE_PATTERNS_NOTES: RegExp[] = [
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

/** Extract zone keywords from a property title when zone field is null */
export function extractZoneFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  for (const pattern of ZONE_PATTERNS_TITLE) {
    const match = lower.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** Extract zone keywords from client notes (lista conservadora, ver arriba) */
export function extractClientZonesFromNotes(notes: string): string[] {
  const lower = notes.toLowerCase();
  const zones: string[] = [];
  for (const pattern of ZONE_PATTERNS_NOTES) {
    const match = lower.match(pattern);
    if (match) zones.push(match[1].toLowerCase());
  }
  return [...new Set(zones)];
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

/** Zonas "contenedoras" demasiado genéricas para matchear por substring o palabra: 'córdoba'
 *  está contenida en 'nueva córdoba', 'alta córdoba', etc. — solo valen por igualdad exacta.
 *  Ticket 86aj9w5mw. */
export const CONTAINER_ZONES = new Set([
  "cordoba", "córdoba", "cordoba capital", "córdoba capital", "capital", "sierras", "centro",
]);

/** Check if two zones match (case-insensitive, trimmed, also partial). Ver 86aj9w5mw. */
export function zonesMatch(propertyZone: string, clientZone: string): boolean {
  const pz = propertyZone.trim().toLowerCase();
  const cz = clientZone.trim().toLowerCase();
  if (pz === cz) return true;
  // Zonas contenedoras: cortan acá — como substring o palabra afirmaban zona equivocada.
  if (CONTAINER_ZONES.has(pz) || CONTAINER_ZONES.has(cz)) return false;
  // includes() con umbral: un término <5 chars es demasiado ambiguo como substring.
  if ((cz.length >= 5 && pz.includes(cz)) || (pz.length >= 5 && cz.includes(pz))) return true;
  // Strict partial word matching: both words must be 4+ chars and similar length.
  const pzWords = pz.split(/\s+/);
  const czWords = cz.split(/\s+/);
  return pzWords.some((w) => w.length >= 4 && !CONTAINER_ZONES.has(w) && czWords.some((cw) => {
    if (cw.length < 4 || CONTAINER_ZONES.has(cw)) return false;
    const shorter = w.length <= cw.length ? w : cw;
    const longer = w.length > cw.length ? w : cw;
    return longer.includes(shorter) && shorter.length / longer.length >= 0.75;
  }));
}

/** Palabras genéricas que NO alcanzan para afirmar coincidencia de zona/municipio. */
export const ZONE_STOPWORDS = new Set([
  "del", "las", "los", "san", "santa", "villa", "barrio", "alto", "alta",
  "rio", "río", "calle", "este", "oeste", "norte", "sur", "parque",
]);

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
  budgetMax: number | null,
): { floor: number; ceiling: number; declaredMax: number } | null {
  const vals = [budgetMin, budgetMax].filter(
    (v): v is number => typeof v === "number" && isFinite(v) && v > 0,
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

/** Umbral por defecto de reasons para notificar un match. */
export const MIN_MATCH_REASONS = 2;

/**
 * Umbral de reasons para que un cliente sea elegible. Un cliente "solo-zona" (tiene
 * preferred_zones pero NO tipo ni budget) alcanza con 1 reason: la zona es todo lo que
 * pidió. El resto exige MIN_MATCH_REASONS. Ver ticket 86aj1f13j.
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

/**
 * Suplemento de reasons desde las NOTAS libres del cliente (zona/tipo/presupuesto).
 * `existingReasonPrefixes` dedupea contra los reasons estructurados: la clave es el
 * emoji líder obtenido con split(' ')[0] — substring(0,2) estaba ROTO para emojis de
 * 3 unidades UTF-16 ("🏗️" = emoji + variation selector) y duplicaba el tipo (T3.4).
 */
export function notesSupplementReasons(
  notes: string,
  property: { price: number | null; property_type: string | null },
  effectiveZone: string | null,
  effectiveTypeTokens: string[],
  existingReasonPrefixes: Set<string>,
): string[] {
  const reasons: string[] = [];
  const lower = notes.toLowerCase();

  // Zona desde notas: solo palabras DISTINTIVAS del zone (las stopwords cruzaban
  // municipios — "Falda del Carmen" matcheaba por "del"). Ver 86aj165ed.
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

  if (!existingReasonPrefixes.has("🏗️") && effectiveTypeTokens.length > 0) {
    if (effectiveTypeTokens.some((t) => lower.includes(t))) {
      reasons.push(`🏗️ Tipo (notas): ${property.property_type || "desde título"}`);
    }
  }

  if (!existingReasonPrefixes.has("💰") && property.price) {
    const budgetRegex = /(\d+(?:[.,]\d+)?)\s*(k|m)?(?:\s*(?:usd|dol|pesos|ars))?\b/gi;
    let match;
    while ((match = budgetRegex.exec(lower)) !== null) {
      const val = parseNumberWithSuffix(match[1], match[2]);
      if (val > 1000 && property.price <= val * BUDGET_MARGIN && property.price >= val * 0.5) {
        reasons.push("💰 Presupuesto (notas)");
        break;
      }
    }
  }

  return reasons;
}

/** Effective zone for a property: structured field, then title, then locality. */
export function computeEffectiveZone(property: { zone: string | null; title: string | null; locality: string | null }): string | null {
  return (
    property.zone
    || (property.title ? extractZoneFromTitle(property.title) : null)
    || (property.locality ? extractZoneFromTitle(property.locality) : null)
    || property.locality
  );
}

/** Effective property-type tokens: from the structured field, else from the title. */
export function computeEffectiveTypeTokens(property: { property_type: string | null; title: string | null }): string[] {
  const baseTypeTokens = property.property_type ? normalizePropertyType(property.property_type) : [];
  const titleTypeTokens = (!property.property_type && property.title) ? extractTypeFromTitle(property.title) : [];
  return [...new Set([...baseTypeTokens, ...titleTypeTokens])];
}
