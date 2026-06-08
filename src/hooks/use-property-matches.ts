import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  findPropertyMatches,
  type ClientForMatch,
  type MatchedClient,
  type PropertyForMatch,
} from "@/lib/property-matching";

// Re-exported for backwards compatibility with existing imports.
export type { MatchedClient, PropertyForMatch } from "@/lib/property-matching";

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
            "id, full_name, phone, email, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, status, client_type, notes, last_contact_at, is_client"
          )
          .eq("user_id", user.id)
          .eq("is_client", true);

        if (error) throw error;

        setMatches(findPropertyMatches(property, (clients ?? []) as ClientForMatch[]));
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { matches, loading, findMatches };
}
