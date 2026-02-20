import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hook to manage favorite state for a property identified by its URL.
 * Looks up the property UUID by URL, then toggles the favorites table.
 */
export function useFavorite(propertyUrl: string | undefined) {
  const { user } = useAuth();
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const [propertyDbId, setPropertyDbId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Resolve property DB id from URL
  useEffect(() => {
    if (!propertyUrl || !user) return;
    let cancelled = false;

    const resolve = async () => {
      // Match by URL ignoring query params
      const baseUrl = propertyUrl.split("?")[0];
      const { data } = await supabase
        .from("properties")
        .select("id")
        .ilike("url", `${baseUrl}%`)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (data) {
        setPropertyDbId(data.id);
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [propertyUrl, user]);

  // Check if already favorited
  useEffect(() => {
    if (!propertyDbId || !user) return;
    let cancelled = false;

    const check = async () => {
      const { data } = await supabase
        .from("favorites")
        .select("id")
        .eq("property_id", propertyDbId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;
      setFavoriteId(data?.id ?? null);
    };

    check();
    return () => { cancelled = true; };
  }, [propertyDbId, user]);

  const isFavorite = favoriteId !== null;

  const toggle = useCallback(async () => {
    if (!user || !propertyDbId || loading) return;
    setLoading(true);
    try {
      if (isFavorite) {
        await supabase.from("favorites").delete().eq("id", favoriteId!);
        setFavoriteId(null);
      } else {
        const { data } = await supabase
          .from("favorites")
          .insert({ property_id: propertyDbId, user_id: user.id })
          .select("id")
          .single();
        setFavoriteId(data?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [user, propertyDbId, isFavorite, favoriteId, loading]);

  return { isFavorite, toggle, loading, canFavorite: !!propertyDbId && !!user };
}
