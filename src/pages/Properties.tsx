import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PropertyCard from "@/components/PropertyCard";
import { LinkPropertyToClientDialog } from "@/components/LinkPropertyToClientDialog";
import { PropertyMatchesDialog } from "@/components/PropertyMatchesDialog";
import { usePropertyMatches } from "@/hooks/use-property-matches";
import { ArrowLeft, Search, Heart, Trash2, Building2, SlidersHorizontal, X, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

interface PropertyRow {
  id: string;
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
  ambientes: number | null;
  banos: number | null;
  property_type: string | null;
}

interface FavoriteProperty extends PropertyRow {
  favoriteId: string;
}

const PAGE_SIZE = 24;

const Properties = () => {
  const { user, agentCode } = useAuth();
  const navigate = useNavigate();

  // Search state
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [operationFilter, setOperationFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Favorites state
  const [favorites, setFavorites] = useState<FavoriteProperty[]>([]);
  const [loadingFavs, setLoadingFavs] = useState(true);

  // Link to client dialog
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkPropertyId, setLinkPropertyId] = useState("");
  const [linkPropertyTitle, setLinkPropertyTitle] = useState<string | undefined>();

  // Matches dialog
  const { matches, loading: matchesLoading, findMatches } = usePropertyMatches();
  const [matchesOpen, setMatchesOpen] = useState(false);
  const [matchesPropertyId, setMatchesPropertyId] = useState("");
  const [matchesPropertyTitle, setMatchesPropertyTitle] = useState<string | undefined>();

  // Active tab
  const [activeTab, setActiveTab] = useState("search");

  // --- Load properties with search/filters ---
  const loadProperties = useCallback(async (pageNum: number, append = false) => {
    if (!user) return;
    setLoadingProps(true);
    try {
      let query = supabase
        .from("properties")
        .select("id, photo, title, office, price, currency, address, locality, zone, m2_total, m2_cover, url, operation, ambientes, banos, property_type", { count: "exact" });

      if (searchQuery.trim()) {
        const q = `%${searchQuery.trim()}%`;
        query = query.or(`title.ilike.${q},address.ilike.${q},locality.ilike.${q},zone.ilike.${q},office.ilike.${q}`);
      }
      if (operationFilter !== "all") {
        query = query.eq("operation", operationFilter);
      }
      if (typeFilter !== "all") {
        query = query.eq("property_type", typeFilter);
      }
      if (priceMin) {
        query = query.gte("price", Number(priceMin));
      }
      if (priceMax) {
        query = query.lte("price", Number(priceMax));
      }

      query = query
        .order("created_at", { ascending: false })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      const rows = (data ?? []) as PropertyRow[];
      setProperties(prev => append ? [...prev, ...rows] : rows);
      setTotalCount(count);
      setHasMore(rows.length === PAGE_SIZE);
      setPage(pageNum);
    } catch {
      toast.error("Error al buscar propiedades");
    } finally {
      setLoadingProps(false);
    }
  }, [user, searchQuery, operationFilter, typeFilter, priceMin, priceMax]);

  // Debounce price inputs
  const [debouncedPriceMin, setDebouncedPriceMin] = useState("");
  const [debouncedPriceMax, setDebouncedPriceMax] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setPriceMin(debouncedPriceMin); }, 500);
    return () => clearTimeout(t);
  }, [debouncedPriceMin]);

  useEffect(() => {
    const t = setTimeout(() => { setPriceMax(debouncedPriceMax); }, 500);
    return () => clearTimeout(t);
  }, [debouncedPriceMax]);

  // Load on filter/search change
  useEffect(() => {
    if (activeTab === "search") {
      loadProperties(0);
    }
  }, [activeTab, searchQuery, operationFilter, typeFilter, priceMin, priceMax]);

  // --- Load favorites ---
  const loadFavorites = useCallback(async () => {
    if (!user) return;
    setLoadingFavs(true);
    try {
      const { data, error } = await supabase
        .from("favorites")
        .select(`
          id,
          properties (
            id, photo, title, office, price, currency,
            address, locality, zone, m2_total, m2_cover,
            url, operation, ambientes, banos, property_type
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
      setLoadingFavs(false);
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "favorites") {
      loadFavorites();
    }
  }, [activeTab, loadFavorites]);

  // Initial favorites count
  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const handleRemoveFav = async (favoriteId: string) => {
    const { error } = await supabase.from("favorites").delete().eq("id", favoriteId);
    if (error) {
      toast.error("Error al eliminar favorito");
    } else {
      setFavorites(prev => prev.filter(f => f.favoriteId !== favoriteId));
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

  const buildExtras = (p: PropertyRow): string[] => {
    const extras: string[] = [];
    if (p.operation) extras.push(`🏷️ ${p.operation}`);
    if (p.property_type) extras.push(`🏗️ ${p.property_type}`);
    if (p.ambientes) extras.push(`🛋️ ${p.ambientes} amb.`);
    if (p.banos) extras.push(`🚿 ${p.banos} baños`);
    return extras;
  };

  const hasActiveFilters = operationFilter !== "all" || typeFilter !== "all" || priceMin !== "" || priceMax !== "";

  const clearFilters = () => {
    setOperationFilter("all");
    setTypeFilter("all");
    setPriceMin("");
    setPriceMax("");
    setDebouncedPriceMin("");
    setDebouncedPriceMax("");
    setSearchQuery("");
  };

  const PropertyGrid = ({ items, isFavView = false }: { items: (PropertyRow | FavoriteProperty)[]; isFavView?: boolean }) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <div key={isFavView ? (p as FavoriteProperty).favoriteId : p.id} className="group relative overflow-hidden rounded-xl">
          {isFavView && (
            <button
              onClick={() => handleRemoveFav((p as FavoriteProperty).favoriteId)}
              className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow backdrop-blur-sm transition-all hover:opacity-90 sm:opacity-0 sm:group-hover:opacity-100"
              title="Quitar de favoritos"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <PropertyCard
            photo={p.photo ?? undefined}
            title={p.title ?? undefined}
            office={p.office ?? undefined}
            price={formatPrice(p.price, p.currency)}
            location={formatLocation(p.address, p.locality, p.zone)}
            surface={formatSurface(p.m2_total, p.m2_cover)}
            url={p.url ?? undefined}
            extras={buildExtras(p)}
            agentCode={agentCode}
          />
          {/* Action buttons row */}
          <div className="flex gap-2 px-3.5 pb-3 -mt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1.5 text-xs h-8"
              onClick={() => {
                setMatchesPropertyId(p.id);
                setMatchesPropertyTitle(p.title ?? undefined);
                setMatchesOpen(true);
                findMatches({
                  zone: p.zone,
                  price: p.price,
                  currency: p.currency,
                  property_type: p.property_type,
                  title: p.title,
                });
              }}
            >
              <Users className="h-3.5 w-3.5" />
              Compatibles
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1.5 text-xs h-8"
              onClick={() => {
                setLinkPropertyId(p.id);
                setLinkPropertyTitle(p.title ?? undefined);
                setLinkDialogOpen(true);
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Vincular
            </Button>
          </div>
        </div>
      ))}
    </div>
  );

  const LoadingSkeleton = () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
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
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Building2 className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Propiedades</p>
          <p className="text-xs text-muted-foreground">
            {totalCount !== null ? `${totalCount.toLocaleString("es-AR")} propiedades` : "Buscá propiedades"}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border bg-card px-4">
          <TabsList className="w-full bg-transparent h-10">
            <TabsTrigger value="search" className="flex-1 gap-2 data-[state=active]:bg-muted">
              <Search className="h-3.5 w-3.5" />
              Buscar
            </TabsTrigger>
            <TabsTrigger value="favorites" className="flex-1 gap-2 data-[state=active]:bg-muted">
              <Heart className="h-3.5 w-3.5" />
              Favoritos
              {favorites.length > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {favorites.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Search Tab */}
        <TabsContent value="search" className="flex-1 overflow-y-auto m-0">
          {/* Search bar + filters */}
          <div className="sticky top-0 z-20 space-y-2 border-b border-border bg-background/95 backdrop-blur-sm px-4 py-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por título, zona, dirección..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>
              <Button
                size="icon"
                variant={showFilters || hasActiveFilters ? "default" : "outline"}
                className="h-10 w-10 shrink-0"
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </div>

            {showFilters && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Select value={operationFilter} onValueChange={setOperationFilter}>
                    <SelectTrigger className="flex-1 h-9 text-xs">
                      <SelectValue placeholder="Operación" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las operaciones</SelectItem>
                      <SelectItem value="Venta">Venta</SelectItem>
                      <SelectItem value="Alquiler">Alquiler</SelectItem>
                      <SelectItem value="Alquiler temporario">Alquiler temporario</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="flex-1 h-9 text-xs">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los tipos</SelectItem>
                      <SelectItem value="Casa">Casa</SelectItem>
                      <SelectItem value="Departamento">Departamento</SelectItem>
                      <SelectItem value="Terreno">Terreno</SelectItem>
                      <SelectItem value="Local">Local</SelectItem>
                      <SelectItem value="Oficina">Oficina</SelectItem>
                      <SelectItem value="Galpón">Galpón</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">💰 Precio:</span>
                  <Input
                    type="number"
                    placeholder="Desde"
                    value={debouncedPriceMin}
                    onChange={(e) => setDebouncedPriceMin(e.target.value)}
                    className="h-9 text-xs flex-1"
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input
                    type="number"
                    placeholder="Hasta"
                    value={debouncedPriceMax}
                    onChange={(e) => setDebouncedPriceMax(e.target.value)}
                    className="h-9 text-xs flex-1"
                  />
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" className="h-9 text-xs shrink-0" onClick={clearFilters}>
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Results */}
          <div className="p-4">
            {loadingProps && properties.length === 0 ? (
              <LoadingSkeleton />
            ) : properties.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <Search className="h-14 w-14 text-muted-foreground/30" />
                <p className="text-base font-medium text-muted-foreground">No se encontraron propiedades</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs">
                  Probá ajustando los filtros o cambiando el texto de búsqueda.
                </p>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Limpiar filtros
                  </Button>
                )}
              </div>
            ) : (
              <>
                <PropertyGrid items={properties} />
                {hasMore && (
                  <div className="flex justify-center pt-6">
                    <Button
                      variant="outline"
                      onClick={() => loadProperties(page + 1, true)}
                      disabled={loadingProps}
                    >
                      {loadingProps ? "Cargando..." : "Cargar más"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* Favorites Tab */}
        <TabsContent value="favorites" className="flex-1 overflow-y-auto m-0">
          <div className="p-4">
            {loadingFavs ? (
              <LoadingSkeleton />
            ) : favorites.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <Heart className="h-14 w-14 text-muted-foreground/30" />
                <p className="text-base font-medium text-muted-foreground">No tenés favoritos aún</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs">
                  Tocá el ❤️ en cualquier tarjeta de propiedad para guardarla acá.
                </p>
                <Button variant="outline" size="sm" onClick={() => setActiveTab("search")}>
                  Buscar propiedades
                </Button>
              </div>
            ) : (
              <PropertyGrid items={favorites} isFavView />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <LinkPropertyToClientDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        propertyId={linkPropertyId}
        propertyTitle={linkPropertyTitle}
      />

      <PropertyMatchesDialog
        open={matchesOpen}
        onOpenChange={setMatchesOpen}
        matches={matches}
        loading={matchesLoading}
        propertyTitle={matchesPropertyTitle}
        onLinkClient={() => {
          setMatchesOpen(false);
          setLinkPropertyId(matchesPropertyId);
          setLinkPropertyTitle(matchesPropertyTitle);
          setLinkDialogOpen(true);
        }}
      />
    </div>
  );
};

export default Properties;
