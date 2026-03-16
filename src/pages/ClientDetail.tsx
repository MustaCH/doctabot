import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Phone, Mail, Building2, MapPin, Cake, DollarSign,
  Home, ExternalLink, Trash2, FileText, CalendarDays, Plus,
  Clock, CheckCircle2, Circle, Send, Share2, StickyNote, ChevronDown,
  Pencil, MoreVertical,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useTags } from "@/hooks/use-tags";
import { ClientTagPicker } from "@/components/TagComponents";
import ClientFormFields, { ClientFormData, emptyClientForm } from "@/components/ClientFormFields";

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

interface ClientProperty {
  id: string;
  property_id: string;
  status: string;
  notes: string | null;
  created_at: string;
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
  notes: string | null;
}

interface ActivityLog {
  id: string;
  action_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ClientNote {
  id: string;
  content: string;
  is_action: boolean;
  is_done: boolean;
  created_at: string;
}

const statusLabel: Record<string, string> = {
  prospect: "Prospecto", active: "Activo", inactive: "Inactivo", closed: "Cerrado",
};
const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  prospect: "secondary", active: "default", inactive: "outline", closed: "destructive",
};
const clientTypeLabel: Record<string, string> = {
  buyer: "🔍 Comprador", seller: "🏠 Vendedor", both: "↔️ Ambos",
};
const propStatusLabel: Record<string, string> = {
  sugerida: "Sugerida", enviada: "Enviada", visitada: "Visitada", descartada: "Descartada",
};
const propStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  sugerida: "secondary", enviada: "default", visitada: "outline", descartada: "destructive",
};
const actionIcons: Record<string, React.ReactNode> = {
  property_linked: <Home className="h-3.5 w-3.5 text-primary" />,
  status_changed: <CheckCircle2 className="h-3.5 w-3.5 text-accent-foreground" />,
  note_added: <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />,
  event_created: <CalendarDays className="h-3.5 w-3.5 text-primary" />,
  call_logged: <Phone className="h-3.5 w-3.5 text-primary" />,
};

const ClientDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user, agentCode } = useAuth();
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<ClientProperty[]>([]);
  const [events, setEvents] = useState<ClientEvent[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [isAction, setIsAction] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<ClientFormData>(emptyClientForm);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { tags, getClientTags, assignTag, removeTag } = useTags();

  const loadClient = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) {
      toast.error("Cliente no encontrado");
      navigate("/clients");
      return;
    }
    setClient(data as Client);
    setLoading(false);
  }, [id, user, navigate]);

  const loadProperties = useCallback(async () => {
    if (!id || !user) return;
    const { data } = await supabase
      .from("client_properties")
      .select("id, property_id, status, notes, created_at, properties(title, address, price, currency, url, photo, operation)")
      .eq("client_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setProperties((data as unknown as ClientProperty[]) ?? []);
  }, [id, user]);

  const loadEvents = useCallback(async () => {
    if (!id || !user) return;
    const { data } = await supabase
      .from("client_events")
      .select("id, event_type, title, event_date, recurrence, notes")
      .eq("client_id", id)
      .eq("user_id", user.id)
      .order("event_date", { ascending: true });
    setEvents((data as ClientEvent[]) ?? []);
  }, [id, user]);

  const loadActivity = useCallback(async () => {
    if (!id || !user) return;
    const { data } = await supabase
      .from("client_activity_log")
      .select("id, action_type, description, metadata, created_at")
      .eq("client_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setActivity((data as ActivityLog[]) ?? []);
  }, [id, user]);

  const loadNotes = useCallback(async () => {
    if (!id || !user) return;
    const { data } = await supabase
      .from("client_notes")
      .select("id, content, is_action, is_done, created_at")
      .eq("client_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setNotes((data as ClientNote[]) ?? []);
  }, [id, user]);

  useEffect(() => {
    loadClient();
    loadProperties();
    loadEvents();
    loadActivity();
    loadNotes();
  }, [loadClient, loadProperties, loadEvents, loadActivity, loadNotes]);

  const handleAddNote = async () => {
    if (!id || !user || !newNote.trim()) return;
    setSavingNote(true);
    const { error } = await supabase.from("client_notes").insert({
      client_id: id,
      user_id: user.id,
      content: newNote.trim(),
      is_action: isAction,
    });
    if (error) {
      toast.error("Error al guardar nota");
    } else {
      setNewNote("");
      setIsAction(false);
      loadNotes();
      // Log activity
      await supabase.from("client_activity_log").insert({
        client_id: id,
        user_id: user.id,
        action_type: "note_added",
        description: `Nota agregada: ${newNote.trim().slice(0, 60)}`,
      });
      loadActivity();
    }
    setSavingNote(false);
  };

  const handleToggleNoteDone = async (note: ClientNote) => {
    await supabase.from("client_notes").update({ is_done: !note.is_done }).eq("id", note.id);
    loadNotes();
  };

  const handleDeleteNote = async (noteId: string) => {
    await supabase.from("client_notes").delete().eq("id", noteId);
    loadNotes();
  };

  const handleUnlinkProperty = async (cpId: string) => {
    const { error } = await supabase.from("client_properties").delete().eq("id", cpId);
    if (error) {
      toast.error("Error al desvincular");
    } else {
      toast.success("Propiedad desvinculada");
      loadProperties();
    }
  };

  const handleWhatsApp = (prop: ClientProperty) => {
    if (!client?.phone || !prop.properties?.url) return;
    const phone = client.phone.replace(/\D/g, "");
    let url = prop.properties.url;
    if (agentCode) {
      try {
        const u = new URL(url);
        u.searchParams.set("associate", agentCode);
        url = u.toString();
      } catch {
        const sep = url.includes("?") ? "&" : "?";
        url = `${url}${sep}associate=${encodeURIComponent(agentCode)}`;
      }
    }
    const lines = [
      prop.properties.title && `🏠 *${prop.properties.title}*`,
      prop.properties.price && `💰 ${prop.properties.currency ?? "USD"} ${prop.properties.price.toLocaleString("es-AR")}`,
      prop.properties.address && `📍 ${prop.properties.address}`,
      `\n🔗 ${url}`,
    ].filter(Boolean);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

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

  const openEdit = () => {
    if (!client) return;
    setEditForm(clientToForm(client));
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!client) return;
    if (!editForm.full_name.trim()) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("clients").update(formToDb(editForm)).eq("id", client.id);
      if (error) throw error;
      toast.success("Cliente actualizado");
      setShowEdit(false);
      loadClient();
    } catch {
      toast.error("Error al guardar los cambios");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!client) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("clients").delete().eq("id", client.id);
      if (error) throw error;
      toast.success("Cliente eliminado");
      navigate("/clients");
    } catch {
      toast.error("Error al eliminar el cliente");
    } finally {
      setDeleting(false);
    }
  };


  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return d;
    }
  };

  const formatDateTime = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch {
      return d;
    }
  };

  if (loading) {
    return (
      <div className="flex h-[100dvh] flex-col bg-background">
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!client) return null;

  const budget = (() => {
    const { budget_min: min, budget_max: max, budget_currency: cur } = client;
    if (!min && !max) return null;
    const sym = cur ?? "USD";
    if (min && max) return `${sym} ${min.toLocaleString("es-AR")} – ${max.toLocaleString("es-AR")}`;
    if (min) return `Desde ${sym} ${min.toLocaleString("es-AR")}`;
    return `Hasta ${sym} ${max!.toLocaleString("es-AR")}`;
  })();

  const pendingActions = notes.filter(n => n.is_action && !n.is_done);

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3 safe-top">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => navigate("/clients")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {/* Avatar circle */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
            {client.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{client.full_name}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge variant={statusVariant[client.status] ?? "secondary"} className="text-[10px] h-5">
                {statusLabel[client.status] ?? client.status}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {clientTypeLabel[client.client_type] ?? client.client_type}
              </span>
            </div>
          </div>

          {/* Edit/Delete menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openEdit} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Editar cliente
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="gap-2 text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Eliminar cliente
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="mt-2 ml-[4.5rem]">
            <ClientTagPicker
              clientId={client.id}
              allTags={tags}
              assignedTags={getClientTags(client.id)}
              onAssign={assignTag}
              onRemove={removeTag}
            />
          </div>
        )}
      </div>

      {/* Quick action bar */}
      <div className="flex items-center gap-2 border-b border-border bg-card/50 px-4 py-2">
        {client.phone && (
          <a href={`tel:${client.phone}`} className="flex-1">
            <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs h-8">
              <Phone className="h-3 w-3" /> Llamar
            </Button>
          </a>
        )}
        {client.phone && (
          <a href={`https://wa.me/${client.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="flex-1">
            <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs h-8">
              <Share2 className="h-3 w-3" /> WhatsApp
            </Button>
          </a>
        )}
        {client.email && (
          <a href={`mailto:${client.email}`} className="flex-1">
            <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs h-8">
              <Mail className="h-3 w-3" /> Email
            </Button>
          </a>
        )}
      </div>

      {/* Client info — collapsible details */}
      <details className="border-b border-border bg-card/30 group">
        <summary className="px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer select-none flex items-center gap-1.5 hover:text-foreground transition-colors">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          Información del cliente
          {pendingActions.length > 0 && (
            <Badge variant="destructive" className="text-[9px] h-4 px-1 ml-auto">
              {pendingActions.length} tarea{pendingActions.length > 1 ? "s" : ""}
            </Badge>
          )}
        </summary>
        <div className="px-4 pb-3 space-y-2.5">
          {/* Contact details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {client.phone && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="h-3 w-3 shrink-0 text-primary/60" />
                <span className="truncate">{client.phone}</span>
              </div>
            )}
            {client.email && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground col-span-2">
                <Mail className="h-3 w-3 shrink-0 text-primary/60" />
                <span className="truncate">{client.email}</span>
              </div>
            )}
            {client.company && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3 shrink-0 text-primary/60" />
                <span className="truncate">{client.company}</span>
              </div>
            )}
            {client.birthday && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Cake className="h-3 w-3 shrink-0 text-primary/60" />
                <span>{formatDate(client.birthday)}</span>
              </div>
            )}
            {client.address && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground col-span-2">
                <MapPin className="h-3 w-3 shrink-0 text-primary/60" />
                <span className="truncate">{client.address}</span>
              </div>
            )}
          </div>

          {/* Search preferences */}
          {(client.preferred_zones || budget || client.property_type_interest) && (
            <div className="rounded-lg bg-muted/50 p-2.5 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Búsqueda</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {client.preferred_zones && (
                  <span className="flex items-center gap-1.5 text-xs">
                    <MapPin className="h-3 w-3 text-primary/60" /> {client.preferred_zones}
                  </span>
                )}
                {budget && (
                  <span className="flex items-center gap-1.5 text-xs">
                    <DollarSign className="h-3 w-3 text-primary/60" /> {budget}
                  </span>
                )}
                {client.property_type_interest && (
                  <span className="flex items-center gap-1.5 text-xs">
                    <Home className="h-3 w-3 text-primary/60" /> {client.property_type_interest}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {client.notes && (
            <p className="text-xs text-muted-foreground italic">
              <FileText className="inline h-3 w-3 mr-1 text-primary/60" />{client.notes}
            </p>
          )}
        </div>
      </details>

      {/* Tabs */}
      <Tabs defaultValue="properties" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div className="border-b border-border bg-card px-4">
          <TabsList className="w-full bg-transparent h-10">
            <TabsTrigger value="properties" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-muted">
              <Home className="h-3.5 w-3.5" />
              Propiedades
              {properties.length > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {properties.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-muted">
              <StickyNote className="h-3.5 w-3.5" />
              Notas
              {notes.length > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground/20 px-1 text-[9px] font-bold">
                  {notes.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-muted">
              <Clock className="h-3.5 w-3.5" />
              Actividad
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Properties Tab */}
        <TabsContent value="properties" className="m-0 p-4 overflow-y-auto" style={{ flex: 1, minHeight: 0 }}>
          {properties.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Home className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Sin propiedades vinculadas</p>
              <p className="text-xs text-muted-foreground/70 max-w-xs">
                Vinculá propiedades desde el explorador o pedile a Alan en el chat.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {properties.map((cp) => {
                const p = cp.properties;
                if (!p) return null;
                return (
                  <div key={cp.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    {p.photo && (
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                        <img src={p.photo} alt={p.title ?? ""} className="h-full w-full object-cover" loading="lazy" />
                      </div>
                    )}
                    <div className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{p.title ?? "Sin título"}</p>
                          {p.address && <p className="text-xs text-muted-foreground truncate">📍 {p.address}</p>}
                          {p.price && (
                            <p className="text-xs font-medium text-primary">
                              💰 {p.currency ?? "USD"} {p.price.toLocaleString("es-AR")}
                            </p>
                          )}
                        </div>
                        <Badge variant={propStatusVariant[cp.status] ?? "secondary"} className="text-[10px] shrink-0">
                          {propStatusLabel[cp.status] ?? cp.status}
                        </Badge>
                      </div>
                      {cp.notes && (
                        <p className="text-xs text-muted-foreground italic">💬 {cp.notes}</p>
                      )}
                      <div className="flex gap-1.5 pt-1">
                        {p.url && (
                          <a
                            href={(() => {
                              let url = p.url;
                              if (agentCode) {
                                try {
                                  const u = new URL(url);
                                  u.searchParams.set("associate", agentCode);
                                  url = u.toString();
                                } catch { /* keep original */ }
                              }
                              return url;
                            })()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1"
                          >
                            <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs h-8">
                              <ExternalLink className="h-3 w-3" /> Ver
                            </Button>
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs h-8"
                          onClick={() => handleWhatsApp(cp)}
                          disabled={!client.phone}
                          title={client.phone ? "Enviar por WhatsApp" : "El cliente no tiene teléfono"}
                        >
                          <Share2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive shrink-0"
                          onClick={() => handleUnlinkProperty(cp.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="flex-1 overflow-y-auto m-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {notes.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <StickyNote className="h-12 w-12 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Sin notas</p>
              </div>
            )}
            {notes.map((note) => (
              <div
                key={note.id}
                className={`rounded-lg border p-3 space-y-1 ${
                  note.is_action && !note.is_done
                    ? "border-primary/30 bg-primary/5"
                    : note.is_done
                    ? "border-border bg-muted/50 opacity-60"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {note.is_action && (
                      <button
                        onClick={() => handleToggleNoteDone(note)}
                        className="mt-0.5 shrink-0"
                      >
                        {note.is_done ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    )}
                    <p className={`text-xs ${note.is_done ? "line-through" : ""}`}>
                      {note.content}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteNote(note.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">{formatDateTime(note.created_at)}</p>
              </div>
            ))}
          </div>
          {/* Add note */}
          <div className="border-t border-border bg-card px-4 py-3 space-y-2">
            <Textarea
              placeholder="Escribí una nota..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-[60px] text-xs resize-none"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={isAction}
                  onCheckedChange={(v) => setIsAction(v === true)}
                  className="h-3.5 w-3.5"
                />
                Marcar como acción pendiente
              </label>
              <Button
                size="sm"
                className="gap-1.5 h-8"
                onClick={handleAddNote}
                disabled={!newNote.trim() || savingNote}
              >
                <Send className="h-3 w-3" />
                Guardar
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="flex-1 overflow-y-auto m-0 px-4 pt-2 pb-4">
          {/* Events section */}
          {events.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">📅 Eventos</p>
              <div className="space-y-2">
                {events.map((ev) => (
                  <div key={ev.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5">
                    <CalendarDays className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{ev.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatDate(ev.event_date)} · {ev.recurrence === "yearly" ? "Anual" : ev.recurrence === "monthly" ? "Mensual" : "Una vez"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity log */}
          <p className="text-xs font-medium text-muted-foreground mb-2">🕐 Historial de actividad</p>
          {activity.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Sin actividad registrada</p>
            </div>
          ) : (
            <div className="relative ml-2 border-l-2 border-border pl-4 space-y-4">
              {activity.map((a) => (
                <div key={a.id} className="relative">
                  <div className="absolute -left-[1.35rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background border-2 border-border">
                    {actionIcons[a.action_type] ?? <Circle className="h-3 w-3 text-muted-foreground" />}
                  </div>
                  <p className="text-xs">{a.description}</p>
                  <p className="text-[10px] text-muted-foreground">{formatDateTime(a.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-2">
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-2 min-h-0">
            <ClientFormFields form={editForm} onChange={setEditForm} />
          </div>
          <DialogFooter className="px-5 pb-5 pt-3 border-t border-border/40 gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowEdit(false)} disabled={saving}>Cancelar</Button>
            <Button className="flex-1" onClick={handleSaveEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente a <strong>{client.full_name}</strong>. Esta acción no se puede deshacer.
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
    </div>
  );
};

export default ClientDetail;
