/**
 * Matching propiedad↔cliente del FRONT (sugerencias en vivo).
 *
 * Los primitivos (patrones de zona, zonesMatch, tipos, presupuesto, notas) viven en el
 * NÚCLEO COMPARTIDO `supabase/functions/_shared/matching-core.ts`, importado también por
 * el cron `morning-matches` — antes estaban copiados y divergieron en silencio (T3.4 /
 * ticket 86aj9w5p3). Acá queda solo la capa propia del front: computeMatchReasons (con el
 * filtro is_client/seller) y findPropertyMatches (umbral por cliente).
 */
import {
  normalizePropertyType,
  extractZoneFromTitle,
  extractTypeFromTitle,
  extractClientZonesFromNotes,
  zonesMatch,
  BUDGET_MARGIN,
  budgetCeilingFloor,
  parseNumberWithSuffix,
  minReasonsFor,
  notesSupplementReasons,
  computeEffectiveZone as coreComputeEffectiveZone,
  computeEffectiveTypeTokens as coreComputeEffectiveTypeTokens,
} from "../../supabase/functions/_shared/matching-core.ts";

// Re-export de los primitivos compartidos: la superficie pública de este módulo no cambia
// (los consumidores e imports de tests siguen funcionando igual).
export {
  normalizePropertyType,
  extractZoneFromTitle,
  extractTypeFromTitle,
  extractClientZonesFromNotes,
  zonesMatch,
  BUDGET_MARGIN,
  budgetCeilingFloor,
  parseNumberWithSuffix,
  minReasonsFor,
};

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

/** Effective zone for a property: structured field, then title, then locality. */
export function computeEffectiveZone(property: PropertyForMatch): string | null {
  return coreComputeEffectiveZone(property);
}

/** Effective property-type tokens: from the structured field, else from the title. */
export function computeEffectiveTypeTokens(property: PropertyForMatch): string[] {
  return coreComputeEffectiveTypeTokens(property);
}

/**
 * Compute the list of match reasons for a single client against a property.
 * Returns `null` when the client must be excluded outright (seller, or a
 * mandatory zone/type criterion that did not match). Returns the reasons
 * array otherwise (may be < threshold).
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

  // --- Always check notes as supplement (dedup por emoji líder, ver matching-core) ---
  if (client.notes) {
    const existingPrefixes = new Set(reasons.map((r) => r.split(" ")[0]));
    reasons.push(...notesSupplementReasons(client.notes, property, effectiveZone, effectiveTypeTokens, existingPrefixes));
  }

  return reasons;
}

/**
 * Find every client that matches the given property, con el umbral POR CLIENTE del núcleo
 * (minReasonsFor): un cliente "solo-zona" alcanza con 1 reason (86aj1f13j — antes el front
 * exigía 2 fijo y divergía del cron). Results sorted by number of reasons, descending.
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
    if (reasons && reasons.length >= minReasonsFor(c)) {
      matched.push({ ...c, matchReasons: reasons });
    }
  }

  // Sort by number of matching criteria (desc)
  matched.sort((a, b) => b.matchReasons.length - a.matchReasons.length);
  return matched;
}
