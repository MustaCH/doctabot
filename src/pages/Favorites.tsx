import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PropertyCard from "@/components/PropertyCard";
import { ArrowLeft, Heart, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface FavoriteProperty {
  favoriteId: string;
  photo: string | null;
  title: string | null;
  office: string | null;
  price: number | null;
  currency: string | null;
  address: string | null;
  locality: string | null;
  zone: string | null;
  m2_total: number | null;
  m2_cover: number | null;
  url: string | null;
  operation: string | null;
  habitaciones: number | null;
  banos: number | null;
  property_type: string | null;
}

const Favorites = () => {
  const { user, agentCode } = useAuth();
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<FavoriteProperty[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFavorites = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("favorites")
        .select(`
          id,
          properties (
            photo, title, office, price, currency,
            address, locality, zone, m2_total, m2_cover,
            url, operation, habitaciones, banos, property_type
          )
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const mapped: FavoriteProperty[] = (data ?? [])
        .filter((f: any) => f.properties)
        .map((f: any) => ({
          favoriteId: f.id,
          ...f.properties,
        }));

      setFavorites(mapped);
    } catch {
      toast.error("Error al cargar favoritos");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const handleRemove = async (favoriteId: string) => {
    const { error } = await supabase.from("favorites").delete().eq("id", favoriteId);
    if (error) {
      toast.error("Error al eliminar favorito");
    } else {
      setFavorites((prev) => prev.filter((f) => f.favoriteId !== favoriteId));
      toast.success("Favorito eliminado");
    }
  };

  const formatPrice = (price: number | null, currency: string | null) => {
    if (!price) return undefined;
    const sym = currency === "USD" ? "USD" : "$";
    return `${sym} ${price.toLocaleString("es-AR")}`;
  };

  const formatLocation = (address: string | null, locality: string | null, zone: string | null) => {
    const parts = [address, locality, zone].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : undefined;
  };

  const formatSurface = (m2Total: number | null, m2Cover: number | null) => {
    if (m2Total) return `${m2Total} m² totales${m2Cover ? ` / ${m2Cover} m² cubiertos` : ""}`;
    if (m2Cover) return `${m2Cover} m² cubiertos`;
    return undefined;
  };

  const buildExtras = (f: FavoriteProperty): string[] => {
    const extras: string[] = [];
    if (f.operation) extras.push(`🏷️ ${f.operation}`);
    if (f.property_type) extras.push(`🏗️ ${f.property_type}`);
    if (f.habitaciones) extras.push(`🛋️ ${f.habitaciones} hab.`);
    if (f.banos) extras.push(`🚿 ${f.banos} baños`);
    return extras;
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Heart className="h-5 w-5 fill-destructive text-destructive" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Mis Favoritos</p>
          <p className="text-xs text-muted-foreground">
            {loading ? "Cargando..." : `${favorites.length} propiedad${favorites.length !== 1 ? "es" : ""} guardada${favorites.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
                <Skeleton className="aspect-video w-full" />
                <div className="space-y-2 p-3.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : favorites.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Heart className="h-14 w-14 text-muted-foreground/30" />
            <p className="text-base font-medium text-muted-foreground">No tenés favoritos aún</p>
            <p className="text-sm text-muted-foreground/70 max-w-xs">
              Tocá el ❤️ en cualquier tarjeta de propiedad para guardarla acá.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              Ir al chat
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.map((f) => (
              <div key={f.favoriteId} className="group relative">
                <PropertyCard
                  photo={f.photo ?? undefined}
                  title={f.title ?? undefined}
                  office={f.office ?? undefined}
                  price={formatPrice(f.price, f.currency)}
                  location={formatLocation(f.address, f.locality, f.zone)}
                  surface={formatSurface(f.m2_total, f.m2_cover)}
                  url={f.url ?? undefined}
                  extras={buildExtras(f)}
                  agentCode={agentCode}
                />
                {/* Remove button overlay */}
                <button
                  onClick={() => handleRemove(f.favoriteId)}
                  className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow backdrop-blur-sm transition-all hover:opacity-90 opacity-0 group-hover:opacity-100"
                  title="Quitar de favoritos"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Favorites;
