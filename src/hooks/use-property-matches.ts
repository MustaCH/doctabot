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
  matchReasons: string[];
}

interface PropertyForMatch {
  zone: string | null;
  price: number | null;
  currency: string | null;
  property_type: string | null;
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
        // Fetch all user's clients (typically under 1000)
        const { data: clients, error } = await supabase
          .from("clients")
          .select(
            "id, full_name, phone, email, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, status, client_type"
          )
          .eq("user_id", user.id);

        if (error) throw error;

        const matched: MatchedClient[] = [];

        for (const c of clients ?? []) {
          const reasons: string[] = [];

          // Zone match
          if (property.zone && c.preferred_zones) {
            const clientZones = c.preferred_zones
              .split(",")
              .map((z: string) => z.trim().toLowerCase());
            if (clientZones.some((z: string) => property.zone!.toLowerCase().includes(z) || z.includes(property.zone!.toLowerCase()))) {
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
              const inMax = !c.budget_max || property.price <= c.budget_max;
              if (inMin && inMax) {
                reasons.push(`💰 Presupuesto compatible`);
              }
            }
          }

          // Property type match
          if (property.property_type && c.property_type_interest) {
            const interests = c.property_type_interest
              .split(",")
              .map((t: string) => t.trim().toLowerCase());
            if (interests.some((t: string) => property.property_type!.toLowerCase().includes(t) || t.includes(property.property_type!.toLowerCase()))) {
              reasons.push(`🏗️ Tipo: ${property.property_type}`);
            }
          }

          if (reasons.length > 0) {
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
