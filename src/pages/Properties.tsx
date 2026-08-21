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
import { ArrowLeft, Search, Heart, Trash2, SlidersHorizontal, X, UserPlus, Users } from "lucide-react";
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
  habitaciones: number | null;
  price_exposure: boolean | null;
  expenses_price: number | null;
  expenses_currency: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  zone_neighborhood: string | null;
  zone_city: string | null;
  zone_private_community: string | null;
  is_entrepreneurship: boolean | null;
  entrepreneurship: any | null;
  operation_id: number | null;
  photos: string[] | null;
}

interface FavoriteProperty extends PropertyRow {
  favoriteId: string;
}

const PAGE_SIZE = 24;

// Campos del panel de filtros (artboard Propiedades): 38 de alto, radio 12, vidrio, texto 12.
const FILTER_FIELD_CLS =
  "h-[38px] min-w-0 flex-1 rounded-[12px] border-white/[0.08] bg-white/5 px-3 text-xs text-[#C3CAD5] md:text-xs focus:ring-[3px] focus:ring-[rgba(91,147,255,0.12)] focus:ring-offset-0 focus:border-[rgba(91,147,255,0.45)]";

const Properties = () => {
  const { user, agentCode } = useAuth();
  const navigate = useNavigate();

  // Search state
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [operationFilter, setOperationFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [roomsFilter, setRoomsFilter] = useState<string>("all");
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
      const offset = pageNum * PAGE_SIZE;

      const { data, error } = await supabase.rpc("search_properties_filtered", {
        search_term: searchQuery.trim(),
        op_filter: operationFilter === "all" ? "" : operationFilter,
        type_filter: typeFilter === "all" ? "" : typeFilter,
        price_min: priceMin ? Number(priceMin) : null,
        price_max: priceMax ? Number(priceMax) : null,
        rooms_min: roomsFilter === "all" ? null : Number(roomsFilter),
        rooms_max: roomsFilter === "all" || roomsFilter === "5" ? null : Number(roomsFilter),
        page_size: PAGE_SIZE,
        page_offset: offset,
      });

      if (error) throw error;

      const rows = (data ?? []) as unknown as (PropertyRow & { total_count: number })[];
      const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

      // Remove total_count from each row before setting state
      const cleanRows: PropertyRow[] = rows.map(({ total_count, ...rest }) => rest);

      setProperties(prev => append ? [...prev, ...cleanRows] : cleanRows);
      setTotalCount(totalCount);
      setHasMore(cleanRows.length === PAGE_SIZE);
      setPage(pageNum);
    } catch {
      toast.error("Error al buscar propiedades");
    } finally {
      setLoadingProps(false);
    }
  }, [user, searchQuery, operationFilter, typeFilter, priceMin, priceMax, roomsFilter]);

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
  }, [activeTab, searchQuery, operationFilter, typeFilter, priceMin, priceMax, roomsFilter]);

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

  const formatPrice = (p: PropertyRow) => {
    if (p.price_exposure === false) return "Precio a consultar";
    if (p.is_entrepreneurship && p.entrepreneurship) {
      const e = p.entrepreneurship;
      if (e.minPrice || e.maxPrice) {
        const currency = e.currency ?? "USD";
        const parts = [];
        if (e.minPrice) parts.push(`Desde ${currency} ${Number(e.minPrice).toLocaleString("es-AR")}`);
        if (e.maxPrice) parts.push(`Hasta ${currency} ${Number(e.maxPrice).toLocaleString("es-AR")}`);
        return parts.join(" · ");
      }
    }
    if (!p.price) return undefined;
    const sym = p.currency === "USD" ? "USD" : "$";
    return `${sym} ${p.price.toLocaleString("es-AR")}`;
  };

  const formatLocation = (p: PropertyRow) => {
    const zoneBadge = p.zone_private_community || p.zone_neighborhood || p.zone_city;
    const parts = [p.address, p.locality, zoneBadge || p.zone].filter(Boolean);
    // Deduplicate
    const unique = [...new Set(parts.map(s => s!.toLowerCase()))];
    return unique.length > 0 ? parts.filter((_, i) => i === 0 || !parts.slice(0, i).some(prev => prev!.toLowerCase() === parts[i]!.toLowerCase())).join(", ") : undefined;
  };

  const formatSurface = (m2Total: number | null, m2Cover: number | null) => {
    if (m2Total) return `${m2Total} m² totales${m2Cover ? ` / ${m2Cover} m² cubiertos` : ""}`;
    if (m2Cover) return `${m2Cover} m² cubiertos`;
    return undefined;
  };

  const buildExtras = (p: PropertyRow): string[] => {
    const extras: string[] = [];
    // Sin emojis: las tarjetas ya no usan emoji como ícono (rediseño Carbón & Vidrio).
    if (p.is_entrepreneurship) extras.push("Emprendimiento");
    if (p.zone_private_community) extras.push(p.zone_private_community);
    if (p.operation) extras.push(p.operation);
    if (p.property_type) extras.push(p.property_type);
    const parts: string[] = [];
    if (p.habitaciones) parts.push(`${p.habitaciones} hab`);
    if (p.banos) parts.push(`${p.banos} baños`);
    if (parts.length > 0) extras.push(parts.join(" · "));
    if (p.expenses_price && p.expenses_price > 0) {
      const expCurr = p.expenses_currency === "USD" ? "USD" : "$";
      extras.push(`Expensas: ${expCurr} ${p.expenses_price.toLocaleString("es-AR")}`);
    }
    return extras;
  };

  const hasActiveFilters = operationFilter !== "all" || typeFilter !== "all" || roomsFilter !== "all" || priceMin !== "" || priceMax !== "";

  const clearFilters = () => {
    setOperationFilter("all");
    setTypeFilter("all");
    setRoomsFilter("all");
    setPriceMin("");
    setPriceMax("");
    setDebouncedPriceMin("");
    setDebouncedPriceMax("");
    setSearchQuery("");
  };

  const PropertyGrid = ({ items, isFavView = false }: { items: (PropertyRow | FavoriteProperty)[]; isFavView?: boolean }) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <div key={isFavView ? (p as FavoriteProperty).favoriteId : p.id} className="relative">
          {isFavView && (
            <button
              onClick={() => handleRemoveFav((p as FavoriteProperty).favoriteId)}
              className="absolute right-14 top-2.5 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-[rgba(255,90,77,0.55)] text-white backdrop-blur-sm transition-colors hover:bg-[rgba(255,90,77,0.75)]"
              title="Quitar de favoritos"
              aria-label="Quitar de favoritos"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <PropertyCard
            photo={p.photo ?? undefined}
            title={p.title ?? undefined}
            office={p.office ?? undefined}
            price={formatPrice(p)}
            location={formatLocation(p)}
            surface={formatSurface(p.m2_total, p.m2_cover)}
            url={p.url ?? undefined}
            extras={buildExtras(p)}
            agentCode={agentCode}
            contactPhone={p.contact_phone ?? undefined}
            contactEmail={p.contact_email ?? undefined}
          />
          {/* Action buttons row — solo en Buscar; el artboard de Favoritos muestra la tarjeta sola */}
          {!isFavView && (
          <div className="mt-2 flex gap-2.5">
            <Button
              size="sm"
              variant="outline"
              className="h-11 flex-1 gap-1.5 rounded-[14px] border-white/10 bg-white/5 text-xs hover:bg-white/10"
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
                  locality: p.locality,
                });
              }}
            >
              <Users className="h-3.5 w-3.5" />
              Compatibles
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-11 flex-1 gap-1.5 rounded-[14px] border-white/10 bg-white/5 text-xs hover:bg-white/10"
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
          )}
        </div>
      ))}
    </div>
  );

  const LoadingSkeleton = () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-[18px] border border-white/[0.09] bg-white/5">
          <Skeleton className="aspect-video w-full rounded-none bg-white/[0.06]" />
          <div className="space-y-2 p-3.5">
            <Skeleton className="h-4 w-3/4 bg-white/[0.06]" />
            <Skeleton className="h-3 w-1/2 bg-white/[0.06]" />
            <Skeleton className="h-3 w-2/3 bg-white/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-3 safe-top">
        <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => navigate(-1)} aria-label="Volver">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold leading-[1.15] tracking-[-0.02em]">Propiedades</h1>
          <p className="mt-[3px] text-[11px] leading-[1.2] text-muted-foreground tabular-nums">
            {activeTab === "favorites"
              ? `${favorites.length} guardada${favorites.length === 1 ? "" : "s"}`
              : totalCount !== null ? `${totalCount.toLocaleString("es-AR")} propiedad${totalCount === 1 ? "" : "es"}` : "Buscá propiedades"}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-white/[0.07] bg-white/[0.02] px-4">
          <TabsList className="h-[46px] w-full gap-2 bg-transparent p-0">
            <TabsTrigger value="search" className="h-full flex-1 gap-2 rounded-none border-b-2 border-transparent text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-[hsl(var(--primary))] data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none">
              <Search className="h-[15px] w-[15px]" strokeWidth={1.9} aria-hidden="true" />
              Buscar
            </TabsTrigger>
            <TabsTrigger value="favorites" className="h-full flex-1 gap-2 rounded-none border-b-2 border-transparent text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-[hsl(var(--primary))] data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none">
              <Heart className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden="true" />
              Favoritos
              {favorites.length > 0 && (
                <span className="rounded-full border border-[rgba(255,90,77,0.34)] bg-[rgba(255,90,77,0.20)] px-[7px] py-px text-[10px] font-bold tabular-nums text-[hsl(var(--hot))]">
                  {favorites.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Search Tab */}
        <TabsContent value="search" className="flex-1 overflow-y-auto m-0 safe-bottom">
          {/* Search bar + filters */}
          <div className="sticky top-0 z-20 space-y-2.5 border-b border-white/[0.07] bg-background/95 px-4 pb-3.5 pt-3 backdrop-blur-sm">
            <div className="flex gap-2.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7E8694]" strokeWidth={1.8} aria-hidden="true" />
                <Input
                  placeholder="Buscar por título, zona, dirección…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Buscar propiedades"
                  className="h-11 rounded-full border-white/[0.08] bg-white/5 pl-[42px] pr-11 text-sm placeholder:text-[#7E8694]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button
                size="icon"
                variant="outline"
                aria-label={showFilters ? "Ocultar filtros" : "Mostrar filtros"}
                aria-pressed={showFilters}
                className={`shrink-0 rounded-[14px] ${
                  showFilters || hasActiveFilters
                    ? "border-transparent bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-white shadow-[0_10px_24px_-12px_rgba(76,141,255,0.9)] hover:text-white hover:opacity-90"
                    : "border-white/[0.08] bg-white/5 hover:bg-white/10"
                }`}
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </div>

            {showFilters && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Select value={operationFilter} onValueChange={setOperationFilter}>
                    <SelectTrigger className={FILTER_FIELD_CLS} aria-label="Operación">
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
                    <SelectTrigger className={FILTER_FIELD_CLS} aria-label="Tipo de propiedad">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los tipos</SelectItem>
                      <SelectItem value="casa">Casa</SelectItem>
                      <SelectItem value="departamento">Departamento</SelectItem>
                      <SelectItem value="terreno">Terreno</SelectItem>
                      <SelectItem value="ph">PH</SelectItem>
                      <SelectItem value="local">Local</SelectItem>
                      <SelectItem value="oficina">Oficina</SelectItem>
                      <SelectItem value="cochera">Cochera</SelectItem>
                      <SelectItem value="campo">Campo</SelectItem>
                      <SelectItem value="galpon">Galpón</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">Habitaciones:</span>
                  <Select value={roomsFilter} onValueChange={setRoomsFilter}>
                    <SelectTrigger className={FILTER_FIELD_CLS} aria-label="Habitaciones">
                      <SelectValue placeholder="Cualquiera" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Cualquier cantidad</SelectItem>
                      <SelectItem value="1">1 habitación</SelectItem>
                      <SelectItem value="2">2 habitaciones</SelectItem>
                      <SelectItem value="3">3 habitaciones</SelectItem>
                      <SelectItem value="4">4 habitaciones</SelectItem>
                      <SelectItem value="5">5 o más</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="Desde"
                    aria-label="Precio desde"
                    value={debouncedPriceMin}
                    onChange={(e) => setDebouncedPriceMin(e.target.value)}
                    className={`${FILTER_FIELD_CLS} tabular-nums`}
                  />
                  <span className="text-xs text-[#7E8694]">—</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="Hasta"
                    aria-label="Precio hasta"
                    value={debouncedPriceMax}
                    onChange={(e) => setDebouncedPriceMax(e.target.value)}
                    className={`${FILTER_FIELD_CLS} tabular-nums`}
                  />
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" className="shrink-0 text-xs font-medium text-[hsl(var(--primary-soft-foreground))] hover:bg-white/5 hover:text-[hsl(var(--primary-soft-foreground))]" onClick={clearFilters}>
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
                  <Button variant="outline" size="md" onClick={clearFilters}>
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
        <TabsContent value="favorites" className="flex-1 overflow-y-auto m-0 safe-bottom">
          <div className="p-4">
            {loadingFavs ? (
              <LoadingSkeleton />
            ) : favorites.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <Heart className="h-14 w-14 text-muted-foreground/30" />
                <p className="text-base font-medium text-muted-foreground">No tenés favoritos aún</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs">
                  Tocá el corazón en cualquier tarjeta de propiedad para guardarla acá.
                </p>
                <Button variant="outline" size="md" onClick={() => setActiveTab("search")}>
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
