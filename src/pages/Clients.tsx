import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Users, Phone, Mail, FileText, Pencil, Trash2, Home, ChevronDown, ExternalLink, Plus, Upload, Building2, MapPin, Cake, DollarSign, Search, CalendarDays, X } from "lucide-react";
import { toast } from "sonner";
import ImportClientsDialog from "@/components/ImportClientsDialog";
import ClientFormFields, { ClientFormData, emptyClientForm } from "@/components/ClientFormFields";

interface ClientProperty {
  id: string;
  property_id: string;
  status: string;
  notes: string | null;
  properties: {
    title: string | null;
    address: string | null;
    price: number | null;
    currency: string | null;
    url: string | null;
    photo: string | null;
    operation: string | null;
  } | null;
}

interface ClientEvent {
  id: string;
  event_type: string;
  title: string;
  event_date: string;
  recurrence: string;
  google_event_id: string | null;
  notes: string | null;
}

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

const propStatusLabel: Record<string, string> = {
  sugerida: "Sugerida",
  enviada: "Enviada",
  visitada: "Visitada",
  descartada: "Descartada",
};

const propStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  sugerida: "secondary",
  enviada: "default",
  visitada: "outline",
  descartada: "destructive",
};

type TypeFilter = "all" | "buyer" | "seller" | "both";

const clientToForm = (c: Client): ClientFormData => ({
  full_name: c.full_name,
  phone: c.phone ?? "",
  email: c.email ?? "",
  notes: c.notes ?? "",
  status: c.status,
  client_type: c.client_type ?? "buyer",
  birthday: c.birthday ?? "",
  company: c.company ?? "",
  address: c.address ?? "",
  preferred_zones: c.preferred_zones ?? "",
  budget_min: c.budget_min != null ? String(c.budget_min) : "",
  budget_max: c.budget_max != null ? String(c.budget_max) : "",
  budget_currency: c.budget_currency ?? "USD",
  property_type_interest: c.property_type_interest ?? "",
  source: c.source ?? "",
});

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
  const [clientProperties, setClientProperties] = useState<Record<string, ClientProperty[]>>({});
  const [clientEvents, setClientEvents] = useState<Record<string, ClientEvent[]>>({});
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  // Edit state
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState<ClientFormData>(emptyClientForm);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ClientFormData>(emptyClientForm);
  const [creating, setCreating] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);

  // Event creation state
  const [eventForClient, setEventForClient] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState({ title: "", event_type: "birthday", event_date: "", recurrence: "yearly", notes: "" });
  const [creatingEvent, setCreatingEvent] = useState(false);

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

  const loadClientProperties = useCallback(async (clientId: string) => {
    if (!user) return;
    const { data } = await supabase
      .from("client_properties")
      .select("id, property_id, status, notes, properties(title, address, price, currency, url, photo, operation)")
      .eq("client_id", clientId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setClientProperties(prev => ({ ...prev, [clientId]: (data as unknown as ClientProperty[]) ?? [] }));
  }, [user]);

  const loadClientEvents = useCallback(async (clientId: string) => {
    if (!user) return;
    const { data } = await supabase
      .from("client_events")
      .select("id, event_type, title, event_date, recurrence, google_event_id, notes")
      .eq("client_id", clientId)
      .eq("user_id", user.id)
      .order("event_date", { ascending: true });
    setClientEvents(prev => ({ ...prev, [clientId]: (data as ClientEvent[]) ?? [] }));
  }, [user]);

  const loadAllEvents = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("client_events")
      .select("id, client_id, event_type, title, event_date, recurrence, google_event_id, notes")
      .eq("user_id", user.id)
      .order("event_date", { ascending: true });
    if (data) {
      const grouped: Record<string, ClientEvent[]> = {};
      for (const ev of data) {
        const cid = (ev as any).client_id as string;
        if (!grouped[cid]) grouped[cid] = [];
        grouped[cid].push(ev as ClientEvent);
      }
      setClientEvents(grouped);
    }
  }, [user]);

  const toggleExpand = (clientId: string) => {
    setExpandedClients(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
        if (!clientProperties[clientId]) {
          loadClientProperties(clientId);
        }
        if (!clientEvents[clientId]) {
          loadClientEvents(clientId);
        }
      }
      return next;
    });
  };

  useEffect(() => {
    loadClients();
    loadAllEvents();
  }, [loadClients, loadAllEvents]);

  const filteredClients = useMemo(() => {
    if (typeFilter === "all") return clients;
    return clients.filter(c => c.client_type === typeFilter || c.client_type === "both");
  }, [clients, typeFilter]);

  const openEdit = (client: Client) => {
    setEditClient(client);
    setEditForm(clientToForm(client));
  };

  const handleSaveEdit = async () => {
    if (!editClient) return;
    if (!editForm.full_name.trim()) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("clients")
        .update(formToDb(editForm))
        .eq("id", editClient.id);
      if (error) throw error;
      toast.success("Cliente actualizado");
      setEditClient(null);
      loadClients();
    } catch {
      toast.error("Error al guardar los cambios");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteClient) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("clients").delete().eq("id", deleteClient.id);
      if (error) throw error;
      toast.success("Cliente eliminado");
      setDeleteClient(null);
      loadClients();
    } catch {
      toast.error("Error al eliminar el cliente");
    } finally {
      setDeleting(false);
    }
  };

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

  const handleCreateEvent = async () => {
    if (!user || !eventForClient) return;
    if (!eventForm.title.trim() || !eventForm.event_date) {
      toast.error("Completá título y fecha");
      return;
    }
    setCreatingEvent(true);
    try {
      const { data: inserted, error } = await supabase.from("client_events").insert({
        client_id: eventForClient,
        user_id: user.id,
        title: eventForm.title.trim(),
        event_type: eventForm.event_type,
        event_date: eventForm.event_date,
        recurrence: eventForm.recurrence,
        notes: eventForm.notes.trim() || null,
      }).select("id").single();
      if (error) throw error;

      // Sync to Google Calendar in background
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token && inserted?.id) {
          const SUPABASE_FUNCTIONS_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;
          const syncRes = await fetch(`${SUPABASE_FUNCTIONS_URL}/sync-calendar-event`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              event_id: inserted.id,
              title: eventForm.title.trim(),
              event_date: eventForm.event_date,
              recurrence: eventForm.recurrence,
              notes: eventForm.notes.trim() || null,
            }),
          });
          const syncData = await syncRes.json();
          if (syncData.synced) {
            toast.success("Evento creado y sincronizado con Google Calendar 📅");
          } else {
            toast.success("Evento creado (sin calendario conectado)");
          }
        } else {
          toast.success("Evento creado");
        }
      } catch {
        toast.success("Evento creado (no se pudo sincronizar con calendario)");
      }

      setEventForClient(null);
      setEventForm({ title: "", event_type: "birthday", event_date: "", recurrence: "yearly", notes: "" });
      loadAllEvents();
    } catch {
      toast.error("Error al crear el evento");
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      const { error } = await supabase.from("client_events").delete().eq("id", eventId);
      if (error) throw error;
      toast.success("Evento eliminado");
      loadAllEvents();
    } catch {
      toast.error("Error al eliminar el evento");
    }
  };

  const formatPrice = (price: number | null, currency: string | null) => {
    if (!price) return null;
    return `${currency ?? "USD"} ${price.toLocaleString("es-AR")}`;
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

      {/* Type filter tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-border bg-card/50 overflow-x-auto">
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
              const isExpanded = expandedClients.has(client.id);
              const props = clientProperties[client.id];
              const budget = formatBudget(client.budget_min, client.budget_max);

              return (
                <div key={client.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight">{client.full_name}</p>
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
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(client)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteClient(client)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Contact info */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {client.phone && (
                      <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{client.phone}</span>
                      </a>
                    )}
                    {client.email && (
                      <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[180px]">{client.email}</span>
                      </a>
                    )}
                    {client.company && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span>{client.company}</span>
                      </div>
                    )}
                    {client.birthday && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Cake className="h-3 w-3 shrink-0" />
                        <span>{new Date(client.birthday + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span>
                      </div>
                    )}
                  </div>

                  {/* Buyer preferences summary */}
                  {(client.client_type === "buyer" || client.client_type === "both") && (client.preferred_zones || budget || client.property_type_interest) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                      {client.preferred_zones && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[200px]">{client.preferred_zones}</span>
                        </div>
                      )}
                      {budget && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <DollarSign className="h-3 w-3 shrink-0" />
                          <span>{budget}</span>
                        </div>
                      )}
                      {client.property_type_interest && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Search className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[200px]">{client.property_type_interest}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {client.notes && (
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{client.notes}</span>
                    </div>
                  )}

                  {/* Events section - always visible when loaded */}
                  {(() => {
                    const events = clientEvents[client.id];
                    const eventTypeEmoji: Record<string, string> = { birthday: "🎂", purchase_anniversary: "🏠", contract_expiry: "📄", followup: "📞", custom: "📌" };
                    const recurrenceLabel: Record<string, string> = { yearly: "Anual", once: "Única vez", monthly: "Mensual" };
                    return (
                      <div className="space-y-1 pt-0.5">
                        <div className="flex items-center justify-between px-1 py-0.5">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            <span>Fechas importantes</span>
                            {events && events.length > 0 && (
                              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{events.length}</Badge>
                            )}
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5"
                            onClick={() => {
                              setEventForClient(client.id);
                              setEventForm({ title: "", event_type: "birthday", event_date: "", recurrence: "yearly", notes: "" });
                            }}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        {events && events.map((ev) => (
                          <div key={ev.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 group">
                            <span className="text-sm">{eventTypeEmoji[ev.event_type] ?? "📌"}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{ev.title}</p>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>{new Date(ev.event_date + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span>
                                <span className="text-muted-foreground/50">·</span>
                                <span>{recurrenceLabel[ev.recurrence] ?? ev.recurrence}</span>
                                {ev.google_event_id && (
                                  <span title="Sincronizado con Google Calendar" className="inline-flex items-center ml-0.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-3.5 w-3.5">
                                      <path fill="#4285F4" d="M35.8 42H12.2C10.4 42 9 40.6 9 38.8V12.2C9 10.4 10.4 9 12.2 9h23.5C37.6 9 39 10.4 39 12.2v26.5c0 1.8-1.4 3.3-3.2 3.3z"/>
                                      <path fill="#fff" d="M33.3 25.8c0-.6-.1-1.2-.3-1.7h-9v3.2h5.2c-.2 1.1-.9 2.1-1.9 2.7v2.3h3c1.8-1.6 2.9-4 2.9-6.5z"/>
                                      <path fill="#34A853" d="M24 34c2.6 0 4.7-.8 6.3-2.3l-3-2.3c-.8.6-1.9.9-3.2.9-2.5 0-4.6-1.7-5.3-3.9h-3.1v2.4C17.1 31.8 20.3 34 24 34z"/>
                                      <path fill="#FBBC05" d="M18.7 27.3c-.2-.6-.3-1.2-.3-1.8s.1-1.3.3-1.8v-2.4h-3.1C14.6 23 14 24.4 14 26s.6 3 1.6 4.3l3.1-3z"/>
                                      <path fill="#EA4335" d="M24 19.6c1.4 0 2.7.5 3.7 1.5l2.8-2.8C28.7 16.5 26.5 15.5 24 15.5c-3.7 0-6.9 2.2-8.4 5.3l3.1 2.4c.8-2.3 2.9-3.6 5.3-3.6z"/>
                                    </svg>
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive shrink-0"
                              onClick={() => handleDeleteEvent(ev.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Properties toggle */}
                  <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(client.id)}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                        <span className="flex items-center gap-1.5">
                          <Home className="h-3 w-3" />
                          Propiedades vinculadas
                          {props && props.length > 0 && (
                            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{props.length}</Badge>
                          )}
                        </span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {!props ? (
                        <div className="py-2 space-y-1.5">
                          <Skeleton className="h-12 w-full rounded-lg" />
                          <Skeleton className="h-12 w-full rounded-lg" />
                        </div>
                      ) : props.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60 py-2 text-center">
                          Sin propiedades. Pedile a Alan que guarde propiedades para este cliente.
                        </p>
                      ) : (
                        <div className="space-y-2 pt-1">
                          {props.map((cp) => (
                            <div key={cp.id} className="flex gap-2.5 rounded-lg border border-border/50 bg-muted/30 p-2.5">
                              {cp.properties?.photo && (
                                <img src={cp.properties.photo} alt="" className="h-12 w-12 rounded-md object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              )}
                              <div className="flex-1 min-w-0 space-y-0.5">
                                <p className="text-xs font-medium leading-tight truncate">{cp.properties?.title ?? "Propiedad"}</p>
                                {cp.properties?.address && <p className="text-[11px] text-muted-foreground truncate">{cp.properties.address}</p>}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {cp.properties?.price && (
                                    <span className="text-[11px] font-medium text-primary">{formatPrice(cp.properties.price, cp.properties.currency)}</span>
                                  )}
                                  <Badge variant={propStatusVariant[cp.status] ?? "secondary"} className="h-4 px-1.5 text-[10px]">{propStatusLabel[cp.status] ?? cp.status}</Badge>
                                </div>
                                {cp.notes && <p className="text-[11px] text-muted-foreground/70 line-clamp-1">{cp.notes}</p>}
                              </div>
                              {cp.properties?.url && (
                                <a href={cp.properties.url} target="_blank" rel="noopener noreferrer" className="shrink-0 self-center text-muted-foreground hover:text-primary transition-colors">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editClient} onOpenChange={(open) => !open && setEditClient(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-2">
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-2 min-h-0">
            <ClientFormFields form={editForm} onChange={setEditForm} />
          </div>
          <DialogFooter className="px-5 pb-5 pt-3 border-t border-border/40 gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditClient(null)} disabled={saving}>Cancelar</Button>
            <Button className="flex-1" onClick={handleSaveEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteClient} onOpenChange={(open) => !open && setDeleteClient(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente a <strong>{deleteClient?.full_name}</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Event Creation Dialog */}
      <Dialog open={!!eventForClient} onOpenChange={(open) => { if (!open) setEventForClient(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva fecha importante</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Título</Label>
              <Input
                placeholder="Ej: Cumpleaños de Juan"
                value={eventForm.title}
                onChange={(e) => setEventForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <Select value={eventForm.event_type} onValueChange={(v) => setEventForm(f => ({ ...f, event_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="birthday">🎂 Cumpleaños</SelectItem>
                    <SelectItem value="purchase_anniversary">🏠 Aniversario compra</SelectItem>
                    <SelectItem value="contract_expiry">📄 Vencimiento</SelectItem>
                    <SelectItem value="followup">📞 Seguimiento</SelectItem>
                    <SelectItem value="custom">📌 Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Recurrencia</Label>
                <Select value={eventForm.recurrence} onValueChange={(v) => setEventForm(f => ({ ...f, recurrence: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yearly">Anual</SelectItem>
                    <SelectItem value="monthly">Mensual</SelectItem>
                    <SelectItem value="once">Única vez</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha</Label>
              <Input
                type="date"
                value={eventForm.event_date}
                onChange={(e) => setEventForm(f => ({ ...f, event_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notas (opcional)</Label>
              <Input
                placeholder="Notas adicionales..."
                value={eventForm.notes}
                onChange={(e) => setEventForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEventForClient(null)} disabled={creatingEvent}>Cancelar</Button>
            <Button onClick={handleCreateEvent} disabled={creatingEvent}>{creatingEvent ? "Creando..." : "Crear evento"}</Button>
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
