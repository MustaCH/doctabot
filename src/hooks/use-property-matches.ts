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
}

/** Normalize a property_type slug into comparable tokens */
function normalizePropertyType(raw: string): string[] {
  const lower = raw.toLowerCase().replace(/_/g, " ").trim();
  const tokens: string[] = [];

  if (/\bdepartamento\b/.test(lower)) tokens.push("departamento");
  if (/\bcasa\b/.test(lower)) tokens.push("casa");
  if (/\bph\b/.test(lower)) tokens.push("ph");
  if (/\bduplex\b/.test(lower) || /\bdúplex\b/.test(lower)) tokens.push("duplex");
  if (/\blote\b/.test(lower) || /\bterreno\b/.test(lower)) tokens.push("terreno", "lote");
  if (/\blocal\b/.test(lower)) tokens.push("local");
  if (/\boficina\b/.test(lower)) tokens.push("oficina");
  if (/\bgalpón\b/.test(lower) || /\bgalpon\b/.test(lower)) tokens.push("galpon");
  if (/\bcochera\b/.test(lower)) tokens.push("cochera");
  if (/\bcampo\b/.test(lower)) tokens.push("campo");
  if (/\bfondo de comercio\b/.test(lower)) tokens.push("fondo de comercio");

  if (tokens.length === 0) tokens.push(lower);
  return tokens;
}

/** Check if two zones match (case-insensitive, trimmed, also partial) */
function zonesMatch(propertyZone: string, clientZone: string): boolean {
  const pz = propertyZone.trim().toLowerCase();
  const cz = clientZone.trim().toLowerCase();
  return pz === cz || pz.includes(cz) || cz.includes(pz);
}

/** Try to extract matching info from free-text notes */
function extractFromNotes(notes: string, property: PropertyForMatch): string[] {
  const reasons: string[] = [];
  const lower = notes.toLowerCase();

  // Zone match from notes
  if (property.zone) {
    const pz = property.zone.trim().toLowerCase();
    if (lower.includes(pz)) {
      reasons.push(`📍 Zona (notas): ${property.zone}`);
    }
  }

  // Property type match from notes
  if (property.property_type) {
    const propTokens = normalizePropertyType(property.property_type);
    if (propTokens.some((t) => lower.includes(t))) {
      reasons.push(`🏗️ Tipo (notas): ${property.property_type}`);
    }
  }

  // Budget from notes — look for numbers that could be a budget
  if (property.price) {
    const numbers = lower.match(/\d[\d.,]*\d|\d+/g);
    if (numbers) {
      const parsed = numbers.map((n) => Number(n.replace(/[.,]/g, ""))).filter((n) => n > 1000);
      if (parsed.some((n) => property.price! <= n * 1.2 && property.price! >= n * 0.5)) {
        reasons.push(`💰 Presupuesto (notas)`);
      }
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

        const matched: MatchedClient[] = [];

        for (const c of clients ?? []) {
          // Only match buyers or "both"
          if (c.client_type === "seller") continue;

          const reasons: string[] = [];
          const hasStructuredData = !!(c.preferred_zones || c.budget_min || c.budget_max || c.property_type_interest);

          if (hasStructuredData) {
            // Zone match
            if (property.zone && c.preferred_zones) {
              const clientZones = c.preferred_zones
                .split(",")
                .map((z: string) => z.trim())
                .filter(Boolean);
              if (clientZones.some((z: string) => zonesMatch(property.zone!, z))) {
                reasons.push(`📍 Zona: ${property.zone}`);
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
            if (property.property_type && c.property_type_interest) {
              const propTokens = normalizePropertyType(property.property_type);
              const clientInterests = c.property_type_interest
                .split(",")
                .map((t: string) => t.trim())
                .filter(Boolean);
              const clientTokens = clientInterests.flatMap(normalizePropertyType);
              const hasOverlap = propTokens.some((pt) => clientTokens.includes(pt));
              if (hasOverlap) {
                reasons.push(`🏗️ Tipo: ${property.property_type}`);
              }
            }
          } else if (c.notes) {
            // Fallback: extract from notes
            const noteReasons = extractFromNotes(c.notes, property);
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
