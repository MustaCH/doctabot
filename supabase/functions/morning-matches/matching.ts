// Matching del cron morning-matches. Los primitivos (patrones de zona, zonesMatch, tipos,
// presupuesto, notas) viven en el NÚCLEO COMPARTIDO ../_shared/matching-core.ts, importado
// también por src/lib/property-matching.ts — antes estaban copiados y divergieron en
// silencio (T3.4 / ticket 86aj9w5p3). Acá queda solo la capa propia del cron:
// findMatchReasons (buyer→propiedad) y findSellerBuyerMatchReasons (seller→buyer).
// Sin imports de runtime: puro TS testeable con Vitest.

import {
  normalizePropertyType,
  extractZoneFromTitle,
  extractTypeFromTitle,
  extractClientZonesFromNotes,
  zonesMatch,
  budgetCeilingFloor,
  BUDGET_MARGIN,
  parseNumberWithSuffix,
  MIN_MATCH_REASONS,
  minReasonsFor,
  notesSupplementReasons,
  computeEffectiveZone,
  computeEffectiveTypeTokens,
} from "../_shared/matching-core.ts";

// Re-export: la superficie pública del módulo no cambia (index.ts y tests siguen igual).
export {
  normalizePropertyType,
  extractZoneFromTitle,
  extractTypeFromTitle,
  extractClientZonesFromNotes,
  zonesMatch,
  parseNumberWithSuffix,
  MIN_MATCH_REASONS,
  minReasonsFor,
};

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
    if (sameCurrency && buyerEffectiveMax * BUDGET_MARGIN >= seller.budget_min) {
      reasons.push("💰 Presupuesto compatible");
    }
  }

  return reasons;
}

export function findMatchReasons(property: PropertyRow, client: ClientRow): string[] {
  const effectiveZone = computeEffectiveZone(property);
  const effectiveTypeTokens = computeEffectiveTypeTokens(property);

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

  // Budget (structured fields) — regla unificada del núcleo (budgetCeilingFloor): techo
  // +30%, piso exacto. (El viejo piso con tolerancia 0.85 era una divergencia solo-back.)
  if (property.price) {
    const range = budgetCeilingFloor(client.budget_min, client.budget_max);
    const sameCurrency = !client.budget_currency || !property.currency || client.budget_currency === property.currency;
    if (sameCurrency && range && property.price >= range.floor && property.price <= range.ceiling) {
      reasons.push(`💰 Presupuesto: ${client.budget_currency || "USD"} ${range.declaredMax.toLocaleString("es-AR")}`);
    }
  }

  // Notes supplement (dedup por emoji líder con split(' ')[0] — substring(0,2) estaba
  // roto para emojis de 3 unidades UTF-16 y duplicaba el tipo; fix de T3.4).
  if (client.notes) {
    const existingPrefixes = new Set(reasons.map((r) => r.split(" ")[0]));
    reasons.push(...notesSupplementReasons(client.notes, property, effectiveZone, effectiveTypeTokens, existingPrefixes));
  }

  return reasons;
}
