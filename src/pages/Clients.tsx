import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Users, Phone, Mail, FileText, Home, Plus, Upload, Building2, MapPin, Cake, DollarSign, Search, X } from "lucide-react";
import { toast } from "sonner";
import ImportClientsDialog from "@/components/ImportClientsDialog";
import ClientFormFields, { ClientFormData, emptyClientForm } from "@/components/ClientFormFields";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";

interface Client {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  client_type: string;
  birthday: string | null;
  company: string | null;
  address: string | null;
  preferred_zones: string | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  property_type_interest: string | null;
  source: string | null;
  last_contact_at: string | null;
}

const statusLabel: Record<string, string> = {
  prospect: "Prospecto",
  active: "Activo",
  inactive: "Inactivo",
  closed: "Cerrado",
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  prospect: "secondary",
  active: "default",
  inactive: "outline",
  closed: "destructive",
};

const clientTypeLabel: Record<string, string> = {
  buyer: "🔍 Comprador",
  seller: "🏠 Vendedor",
  both: "↔️ Ambos",
};

const clientTypeVariant: Record<string, "default" | "secondary" | "outline"> = {
  buyer: "default",
  seller: "outline",
  both: "secondary",
};

type TypeFilter = "all" | "buyer" | "seller" | "both";

const formToDb = (form: ClientFormData) => ({
  full_name: form.full_name.trim(),
  phone: form.phone.trim() || null,
  email: form.email.trim() || null,
  notes: form.notes.trim() || null,
  status: form.status,
  client_type: form.client_type,
  birthday: form.birthday || null,
  company: form.company.trim() || null,
  address: form.address.trim() || null,
  preferred_zones: form.preferred_zones.trim() || null,
  budget_min: form.budget_min ? Number(form.budget_min) : null,
  budget_max: form.budget_max ? Number(form.budget_max) : null,
  budget_currency: form.budget_currency || "USD",
  property_type_interest: form.property_type_interest.trim() || null,
  source: form.source || null,
});

const Clients = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [propertyCounts, setPropertyCounts] = useState<Record<string, number>>({});
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ClientFormData>(emptyClientForm);
  const [creating, setCreating] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);

  const loadClients = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, phone, email, notes, status, created_at, client_type, birthday, company, address, preferred_zones, budget_min, budget_max, property_type_interest, source, last_contact_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setClients((data as Client[]) ?? []);
    } catch {
      toast.error("Error al cargar los clientes");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadPropertyCounts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("client_properties")
      .select("client_id")
      .eq("user_id", user.id);
    if (data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.client_id] = (counts[row.client_id] || 0) + 1;
      }
      setPropertyCounts(counts);
    }
  }, [user]);

  useEffect(() => {
    loadClients();
    loadPropertyCounts();
  }, [loadClients, loadPropertyCounts]);

  const filteredClients = useMemo(() => {
    let result = clients;
    if (typeFilter !== "all") {
      result = result.filter(c => c.client_type === typeFilter || c.client_type === "both");
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(c =>
        c.full_name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
      );
    }
    return result;
  }, [clients, typeFilter, searchQuery]);

  const handleCreate = async () => {
    if (!user) return;
    if (!createForm.full_name.trim()) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from("clients").insert({
        ...formToDb(createForm),
        user_id: user.id,
      });
      if (error) throw error;
      toast.success("Cliente creado");
      setShowCreate(false);
      setCreateForm(emptyClientForm);
      loadClients();
    } catch {
      toast.error("Error al crear el cliente");
    } finally {
      setCreating(false);
    }
  };

  const formatBudget = (min: number | null, max: number | null) => {
    if (!min && !max) return null;
    if (min && max) return `USD ${min.toLocaleString("es-AR")} – ${max.toLocaleString("es-AR")}`;
    if (min) return `Desde USD ${min.toLocaleString("es-AR")}`;
    return `Hasta USD ${max!.toLocaleString("es-AR")}`;
  };

  const filterButtons: { key: TypeFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "buyer", label: "🔍 Compradores" },
    { key: "seller", label: "🏠 Vendedores" },
  ];

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Users className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Mis Clientes</p>
          <p className="text-xs text-muted-foreground">
            {loading ? "Cargando..." : `${filteredClients.length} cliente${filteredClients.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={() => setShowImport(true)} title="Importar desde Excel/CSV">
            <Upload className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="default" className="h-8 w-8 rounded-full" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search + Type filter */}
      <div className="border-b border-border bg-card/50 px-4 py-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, teléfono o email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-9 text-sm bg-background"
          />
          {searchQuery && (
            <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6" onClick={() => setSearchQuery("")}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {filterButtons.map(fb => (
            <Button
              key={fb.key}
              size="sm"
              variant={typeFilter === fb.key ? "default" : "ghost"}
              className="h-7 text-xs px-3 shrink-0"
              onClick={() => setTypeFilter(fb.key)}
            >
              {fb.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Users className="h-14 w-14 text-muted-foreground/30" />
            <p className="text-base font-medium text-muted-foreground">
              {typeFilter === "all" ? "No tenés clientes registrados" : "No hay clientes de este tipo"}
            </p>
            <p className="text-sm text-muted-foreground/70 max-w-xs">
              Podés pedirle a Alan que registre un cliente desde el chat con lenguaje natural.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              Ir al chat
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredClients.map((client) => {
              const budget = formatBudget(client.budget_min, client.budget_max);
              const propCount = propertyCounts[client.id] || 0;

              return (
                <div
                  key={client.id}
                  className="rounded-xl border border-border bg-card p-4 space-y-2 cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => navigate(`/clients/${client.id}`)}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <p className="font-bold text-base leading-snug py-0.5">
                        {client.full_name}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={clientTypeVariant[client.client_type] ?? "secondary"} className="text-[10px] h-5">
                          {clientTypeLabel[client.client_type] ?? client.client_type}
                        </Badge>
                        <Badge variant={statusVariant[client.status] ?? "secondary"} className="text-[10px] h-5">
                          {statusLabel[client.status] ?? client.status}
                        </Badge>
                        {client.source && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {client.source}
                          </span>
                        )}
                      </div>
                    </div>
                    {propCount > 0 && (
                      <div className="flex items-center gap-1 shrink-0 rounded-full bg-primary/10 px-2 py-1">
                        <Home className="h-3 w-3 text-primary" />
                        <span className="text-xs font-semibold text-primary">{propCount}</span>
                      </div>
                    )}
                  </div>

                  {/* Contact info */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {client.phone && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{client.phone}</span>
                      </span>
                    )}
                    {client.email && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[180px]">{client.email}</span>
                      </span>
                    )}
                    {client.company && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span>{client.company}</span>
                      </span>
                    )}
                    {client.birthday && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Cake className="h-3 w-3 shrink-0" />
                        <span>{new Date(client.birthday + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span>
                      </span>
                    )}
                  </div>

                  {/* Buyer preferences summary */}
                  {(client.client_type === "buyer" || client.client_type === "both") && (client.preferred_zones || budget || client.property_type_interest) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                      {client.preferred_zones && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[200px]">{client.preferred_zones}</span>
                        </span>
                      )}
                      {budget && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <DollarSign className="h-3 w-3 shrink-0" />
                          <span>{budget}</span>
                        </span>
                      )}
                      {client.property_type_interest && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Search className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[200px]">{client.property_type_interest}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {client.notes && (
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{client.notes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-2">
            <DialogTitle>Nuevo cliente</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-2 min-h-0">
            <ClientFormFields form={createForm} onChange={setCreateForm} showPlaceholders />
          </div>
          <DialogFooter className="px-5 pb-5 pt-3 border-t border-border/40 gap-2 flex-col sm:flex-col">
            <Button className="w-full" onClick={handleCreate} disabled={creating}>{creating ? "Creando..." : "Crear cliente"}</Button>
            <Button variant="outline" className="w-full" onClick={() => setShowCreate(false)} disabled={creating}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      {user && (
        <ImportClientsDialog
          open={showImport}
          onOpenChange={setShowImport}
          userId={user.id}
          onImported={loadClients}
        />
      )}

    </div>
  );
};

export default Clients;
