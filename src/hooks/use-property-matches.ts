import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MatchedClient {
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
  notes: string | null;
  last_contact_at: string | null;
  matchReasons: string[];
}

interface PropertyForMatch {
  zone: string | null;
  price: number | null;
  currency: string | null;
  property_type: string | null;
  title: string | null;
}

/** Normalize a property_type slug into comparable tokens */
function normalizePropertyType(raw: string): string[] {
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
function extractZoneFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  // Common zone/neighborhood keywords in Córdoba real estate
  const zonePatterns = [
    /\b(docta(?:\s+central)?)\b/i,
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
    /\b(nuevo poeta)\b/i,
    /\b(poeta lugones)\b/i,
    /\b(arguello)\b/i,
    /\b(villa allende)\b/i,
    /\b(mendiolaza)\b/i,
    /\b(unquillo)\b/i,
    /\b(villa warcalde)\b/i,
    /\b(cerro de las rosas)\b/i,
    /\b(nueva córdoba)\b/i,
    /\b(general paz)\b/i,
    /\b(alto alberdi)\b/i,
    /\b(centro)\b/i,
  ];

  for (const pattern of zonePatterns) {
    const match = lower.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/** Extract property type tokens from title */
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

/** Check if two zones match (case-insensitive, trimmed, also partial) */
function zonesMatch(propertyZone: string, clientZone: string): boolean {
  const pz = propertyZone.trim().toLowerCase();
  const cz = clientZone.trim().toLowerCase();
  if (pz === cz || pz.includes(cz) || cz.includes(pz)) return true;
  // Check if main word of one appears in the other
  const pzWords = pz.split(/\s+/);
  const czWords = cz.split(/\s+/);
  return pzWords.some((w) => w.length > 3 && czWords.some((cw) => cw.includes(w) || w.includes(cw)));
}

/** Parse a number string that may have K/M suffix */
function parseNumberWithSuffix(numStr: string, suffix?: string): number {
  const n = Number(numStr.replace(/[.,]/g, ""));
  if (!suffix) return n;
  const s = suffix.toLowerCase();
  if (s === "k") return n * 1000;
  if (s === "m") return n * 1000000;
  return n;
}

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

  // Zone match from notes (skip if already matched via structured data)
  if (!existingReasonPrefixes.has("📍") && effectiveZone) {
    const zoneWords = effectiveZone.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (zoneWords.some((w) => lower.includes(w))) {
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
    const BUDGET_TOLERANCE = 1.15;
    if (parsedNumbers.some((n) => property.price! <= n * BUDGET_TOLERANCE && property.price! >= n * 0.5)) {
      reasons.push(`💰 Presupuesto (notas)`);
    }
  }

  return reasons;
}

export function usePropertyMatches() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchedClient[]>([]);
  const [loading, setLoading] = useState(false);

  const findMatches = useCallback(
    async (property: PropertyForMatch) => {
      if (!user) return;
      setLoading(true);
      try {
        const { data: clients, error } = await supabase
          .from("clients")
          .select(
            "id, full_name, phone, email, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, status, client_type, notes, last_contact_at"
          )
          .eq("user_id", user.id);

        if (error) throw error;

        // Compute effective zone and type tokens from property fields + title
        const effectiveZone =
          property.zone || (property.title ? extractZoneFromTitle(property.title) : null);

        const baseTypeTokens = property.property_type
          ? normalizePropertyType(property.property_type)
          : [];
        const titleTypeTokens = property.title ? extractTypeFromTitle(property.title) : [];
        const effectiveTypeTokens = [...new Set([...baseTypeTokens, ...titleTypeTokens])];

        const matched: MatchedClient[] = [];

        for (const c of clients ?? []) {
          // Only match buyers or "both"
          if (c.client_type === "seller") continue;

          const reasons: string[] = [];

          // --- Structured data matching ---

          // Zone match
          if (effectiveZone && c.preferred_zones) {
            const clientZones = c.preferred_zones
              .split(",")
              .map((z: string) => z.trim())
              .filter(Boolean);
            if (clientZones.some((z: string) => zonesMatch(effectiveZone, z))) {
              reasons.push(`📍 Zona: ${effectiveZone}`);
            }
          }

          // Budget match
          if (property.price && (c.budget_min || c.budget_max)) {
            const sameCurrency =
              !property.currency ||
              !c.budget_currency ||
              property.currency === c.budget_currency;
            if (sameCurrency) {
              const inMin = !c.budget_min || property.price >= c.budget_min;
              const BUDGET_TOLERANCE = 1.15;
              if (inMin) {
                if (!c.budget_max || property.price <= c.budget_max) {
                  reasons.push(`💰 Presupuesto compatible`);
                } else if (c.budget_max && property.price <= c.budget_max * BUDGET_TOLERANCE) {
                  const overPercent = Math.round((property.price / c.budget_max - 1) * 100);
                  reasons.push(`💰 Presupuesto negociable (~${overPercent}% sobre máx.)`);
                }
              }
            }
          }

          // Property type match
          if (effectiveTypeTokens.length > 0 && c.property_type_interest) {
            const clientInterests = c.property_type_interest
              .split(",")
              .map((t: string) => t.trim())
              .filter(Boolean);
            const clientTokens = clientInterests.flatMap(normalizePropertyType);
            const hasOverlap = effectiveTypeTokens.some((pt) => clientTokens.includes(pt));
            if (hasOverlap) {
              reasons.push(`🏗️ Tipo: ${property.property_type || "desde título"}`);
            }
          }

          // --- Always check notes as supplement ---
          if (c.notes) {
            const existingPrefixes = new Set(reasons.map((r) => r.substring(0, 2)));
            const noteReasons = extractFromNotes(c.notes, property, effectiveZone, effectiveTypeTokens, existingPrefixes);
            reasons.push(...noteReasons);
          }

          // Require at least 2 matching criteria to avoid false positives
          if (reasons.length >= 2) {
            matched.push({ ...c, matchReasons: reasons });
          }
        }

        // Sort by number of matching criteria (desc)
        matched.sort((a, b) => b.matchReasons.length - a.matchReasons.length);
        setMatches(matched);
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { matches, loading, findMatches };
}
