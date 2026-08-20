// Ficha de cliente/contacto — rediseño 2026-07 (Claude Design bf1ecc53, implementación fiel):
// UNA sola página con scroll natural de documento (sin scrolls internos anidados), header sticky
// colapsable, widget "Último contacto" de un tap (escribe last_contact_at, el mismo campo que usa
// la rotación de campañas de Alan), propiedades protagonistas con "Ver todas", notas integradas.
// La pestaña Actividad fue eliminada a pedido. La capa de datos es la misma que la versión anterior.
import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Phone, Mail, Building2, MapPin, Cake, DollarSign,
  Home, ExternalLink, Trash2, FileText, CalendarDays,
  CheckCircle2, Circle, Send, StickyNote, ChevronDown,
  Pencil, MoreVertical, Sparkles,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import ClientFormFields, { ClientFormData, emptyClientForm } from "@/components/ClientFormFields";
import { Switch } from "@/components/ui/switch";
import ContactTags from "@/components/ContactTags";

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
  is_client: boolean | null;
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

interface ClientNote {
  id: string;
  content: string;
  is_action: boolean;
  is_done: boolean;
  created_at: string;
}

const statusLabel: Record<string, string> = {
  hot: "🔥 Caliente", warm: "☀️ Tibio", cold: "❄️ Frío",
};
const statusColor: Record<string, string> = {
  hot: "bg-red-900/30 text-red-400 border-red-800",
  warm: "bg-amber-900/30 text-amber-400 border-amber-800",
  cold: "bg-blue-900/30 text-blue-400 border-blue-800",
};
const clientTypeLabel: Record<string, string> = {
  buyer: "🔍 Comprador", seller: "🏠 Vendedor", both: "↔️ Ambos",
};
const propStatusLabel: Record<string, string> = {
  sugerida: "Sugerida", enviada: "Enviada", visitada: "Visitada", descartada: "Descartada",
};
// Chips de estado de propiedad, según el rediseño (gris / primario / celeste / rojo).
const propStatusChip: Record<string, string> = {
  sugerida: "bg-muted text-muted-foreground",
  enviada: "bg-primary/10 text-primary",
  visitada: "bg-sky-900/30 text-sky-400",
  descartada: "bg-red-900/30 text-red-400",
};

// Semáforo del widget Último contacto (verde <7 días, ámbar <30, rojo 30+ / nunca).
const contactTiers = {
  green: {
    panel: "bg-green-900/25 border-green-800",
    text: "text-green-300",
    dot: "bg-green-500",
  },
  amber: {
    panel: "bg-amber-900/25 border-amber-800",
    text: "text-amber-300",
    dot: "bg-amber-500",
  },
  red: {
    panel: "bg-red-900/25 border-red-800",
    text: "text-red-300",
    dot: "bg-red-500",
  },
} as const;

const CONTACT_CHIPS: Array<{ label: string; daysAgo: number }> = [
  { label: "Hoy", daysAgo: 0 },
  { label: "Esta semana", daysAgo: 3 },
  { label: "Este mes", daysAgo: 20 },
  { label: "Hace 2 meses", daysAgo: 60 },
  { label: "Hace 3+ meses", daysAgo: 100 },
];

const PROPS_PREVIEW_COUNT = 3;

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const ClientDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user, agentCode } = useAuth();
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<ClientProperty[]>([]);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [isAction, setIsAction] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<ClientFormData>(emptyClientForm);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAllProps, setShowAllProps] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Header colapsable: el documento entero scrollea (sin contenedores internos), así que
  // escuchamos el scroll de la ventana.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 96);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
    loadNotes();
  }, [loadClient, loadProperties, loadNotes]);

  // ----- Último contacto -----
  const lastContact = useMemo(() => {
    if (!client) return null;
    if (!client.last_contact_at) {
      return { tier: "red" as const, human: "Nunca contactado", sub: "Registrá el primer contacto" };
    }
    const days = Math.max(0, Math.floor((Date.now() - new Date(client.last_contact_at).getTime()) / 86400000));
    if (days <= 0) return { tier: "green" as const, human: "Contactado hoy", sub: "Al día — buen trabajo" };
    const human = days < 45 ? `Contactado hace ${days} ${days === 1 ? "día" : "días"}` : `Contactado hace ${Math.round(days / 30)} meses`;
    if (days < 7) return { tier: "green" as const, human, sub: "Contacto reciente" };
    if (days < 30) return { tier: "amber" as const, human, sub: "Conviene retomar pronto" };
    return { tier: "red" as const, human, sub: "Contacto atrasado — priorizar" };
  }, [client]);

  const handleMarkContacted = async (date: Date, label: string) => {
    if (!client || !user) return;
    const iso = date.toISOString();
    const prev = client.last_contact_at;
    setClient({ ...client, last_contact_at: iso }); // optimista
    const { error } = await supabase
      .from("clients")
      .update({ last_contact_at: iso })
      .eq("id", client.id)
      .eq("user_id", user.id);
    if (error) {
      setClient({ ...client, last_contact_at: prev });
      toast.error("No se pudo registrar el contacto");
      return;
    }
    toast.success(`✓ Contacto registrado — ${label}`);
    // Registro en el historial (misma tabla que usaban las notas; barato y auditable).
    supabase.from("client_activity_log").insert({
      client_id: client.id,
      user_id: user.id,
      action_type: "call_logged",
      description: `Contacto registrado (${label})`,
    });
  };

  // ----- Notas -----
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
      const summary = newNote.trim().slice(0, 60);
      setNewNote("");
      setIsAction(false);
      loadNotes();
      await supabase.from("client_activity_log").insert({
        client_id: id,
        user_id: user.id,
        action_type: "note_added",
        description: `Nota agregada: ${summary}`,
      });
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

  // ----- Propiedades -----
  const handleUnlinkProperty = async (cpId: string) => {
    const { error } = await supabase.from("client_properties").delete().eq("id", cpId);
    if (error) {
      toast.error("Error al desvincular");
    } else {
      toast.success("Propiedad desvinculada");
      loadProperties();
    }
  };

  const withAssociate = (rawUrl: string | null): string | null => {
    if (!rawUrl) return null;
    let url = rawUrl;
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
    return url;
  };

  const handleWhatsApp = (prop: ClientProperty) => {
    if (!client?.phone || !prop.properties?.url) return;
    const phone = client.phone.replace(/\D/g, "");
    const url = withAssociate(prop.properties.url);
    const lines = [
      prop.properties.title && `🏠 *${prop.properties.title}*`,
      prop.properties.price && `💰 ${prop.properties.currency ?? "USD"} ${prop.properties.price.toLocaleString("es-AR")}`,
      prop.properties.address && `📍 ${prop.properties.address}`,
      `\n🔗 ${url}`,
    ].filter(Boolean);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  // ----- Edición / borrado (sin cambios de lógica) -----
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
    is_client: c.is_client ?? false,
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
    is_client: form.is_client,
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
    if (!client || !user) return;
    setDeleting(true);
    try {
      const cleanupResults = await Promise.all([
        supabase.from("client_properties").delete().eq("client_id", client.id).eq("user_id", user.id),
        supabase.from("client_notes").delete().eq("client_id", client.id).eq("user_id", user.id),
        supabase.from("client_activity_log").delete().eq("client_id", client.id).eq("user_id", user.id),
        supabase.from("client_events").delete().eq("client_id", client.id).eq("user_id", user.id),
        supabase.from("client_tags").delete().match({ client_id: client.id }),
        supabase.from("conversations").delete().eq("client_id", client.id).eq("user_id", user.id),
      ]);
      cleanupResults.forEach((r, i) => {
        if (r.error) console.warn(`Cleanup step ${i} error:`, r.error);
      });

      const { error } = await supabase.from("clients").delete().eq("id", client.id).eq("user_id", user.id);
      if (error) throw error;

      const { data: check } = await supabase.from("clients").select("id").eq("id", client.id).maybeSingle();
      if (check) {
        console.error("Client still exists after delete!", check);
        toast.error("No se pudo eliminar el cliente. Intentá de nuevo.");
        return;
      }

      toast.success("Cliente eliminado");
      navigate("/clients", { replace: true });
    } catch (err) {
      console.error("Error deleting client:", err);
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
      <div className="min-h-[100dvh] bg-background">
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="p-4 space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!client) return null;

  const initials = client.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  const budget = (() => {
    const { budget_min: min, budget_max: max, budget_currency: cur } = client;
    if (!min && !max) return null;
    const sym = cur ?? "USD";
    if (min && max) return `${sym} ${min.toLocaleString("es-AR")} – ${max.toLocaleString("es-AR")}`;
    if (min) return `Desde ${sym} ${min.toLocaleString("es-AR")}`;
    return `Hasta ${sym} ${max!.toLocaleString("es-AR")}`;
  })();

  const pendingActions = notes.filter(n => n.is_action && !n.is_done);
  const tier = lastContact ? contactTiers[lastContact.tier] : contactTiers.red;
  const visibleProps = showAllProps ? properties : properties.slice(0, PROPS_PREVIEW_COUNT);

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* ===== Header sticky colapsable ===== */}
      <div className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur-md safe-top">
        <div className="flex min-h-12 items-center justify-between gap-2 px-3">
          <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0" onClick={() => navigate("/clients")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-center">
            {scrolled ? (
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {initials}
                </div>
                <span className="truncate text-sm font-bold">{client.full_name}</span>
              </div>
            ) : (
              <span className="text-xs font-medium text-muted-foreground">Contacto</span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0">
                <MoreVertical className="h-5 w-5" />
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
        {!scrolled && (
          <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-1">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-extrabold text-primary-foreground">
              {initials}
            </div>
            <p className="max-w-full break-words text-center text-lg font-extrabold tracking-tight">{client.full_name}</p>
            {client.is_client && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-bold ${statusColor[client.status] ?? "bg-muted text-muted-foreground"}`}>
                  {statusLabel[client.status] ?? client.status}
                </span>
                <span className="inline-flex h-6 items-center rounded-full border bg-muted/40 px-2.5 text-[11px] font-bold text-muted-foreground">
                  {clientTypeLabel[client.client_type] ?? client.client_type}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== Cuerpo: flujo vertical único ===== */}
      <div className="flex flex-col gap-4 px-4 py-4 pb-10 safe-bottom">

        {/* Es cliente */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <div>
            <p className="text-sm font-bold">Es cliente</p>
            <p className="text-[11px] text-muted-foreground">Activá para datos comerciales y matching</p>
          </div>
          <Switch
            checked={!!client.is_client}
            onCheckedChange={async (v) => {
              await supabase.from("clients").update({ is_client: v }).eq("id", client.id);
              loadClient();
            }}
          />
        </div>

        {/* Acciones rápidas */}
        <div className="grid grid-cols-3 gap-2">
          <a href={client.phone ? `tel:${client.phone}` : undefined} className={client.phone ? "" : "pointer-events-none opacity-40"}>
            <Button variant="outline" className="h-11 w-full gap-1.5 rounded-xl text-[13px] font-bold">
              <Phone className="h-4 w-4" /> Llamar
            </Button>
          </a>
          <a
            href={client.phone ? `https://wa.me/${client.phone.replace(/\D/g, "")}` : undefined}
            target="_blank" rel="noopener noreferrer"
            className={client.phone ? "" : "pointer-events-none opacity-40"}
          >
            <Button variant="outline" className="h-11 w-full gap-1.5 rounded-xl text-[13px] font-bold">
              <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> WhatsApp
            </Button>
          </a>
          <a href={client.email ? `mailto:${client.email}` : undefined} className={client.email ? "" : "pointer-events-none opacity-40"}>
            <Button variant="outline" className="h-11 w-full gap-1.5 rounded-xl text-[13px] font-bold">
              <Mail className="h-4 w-4" /> Email
            </Button>
          </a>
        </div>

        {/* ===== Widget Último contacto ===== */}
        <div className={`overflow-hidden rounded-2xl border shadow-sm ${tier.panel}`}>
          <div className="px-4 pb-3.5 pt-4">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${tier.dot} ring-4 ring-black/20`} />
              <span className={`text-[11px] font-extrabold uppercase tracking-widest ${tier.text}`}>Último contacto</span>
            </div>
            <p className={`mb-0.5 mt-2 text-[22px] font-extrabold tracking-tight ${tier.text}`}>{lastContact?.human}</p>
            <p className={`text-xs font-semibold opacity-80 ${tier.text}`}>{lastContact?.sub}</p>
            <div className={`mt-2 flex items-center gap-1.5 text-[11px] opacity-70 ${tier.text}`}>
              <Sparkles className="h-3 w-3" /> Alimenta la rotación de campañas del asistente IA
            </div>
          </div>
          <div className="border-t border-inherit bg-card px-3.5 pb-3.5 pt-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Registrar contacto</p>
            <div className="flex flex-wrap gap-2">
              {CONTACT_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => handleMarkContacted(new Date(Date.now() - chip.daysAgo * 86400000), chip.label.toLowerCase())}
                  className="min-h-11 rounded-full border border-border bg-card px-4 text-[13px] font-bold text-foreground transition-colors hover:border-primary hover:text-primary active:scale-95"
                >
                  {chip.label}
                </button>
              ))}
              <label className="relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-4 text-[13px] font-bold text-foreground transition-colors hover:border-primary hover:text-primary">
                <CalendarDays className="h-4 w-4" /> Fecha exacta…
                <input
                  type="date"
                  className="pointer-events-none absolute h-px w-px opacity-0"
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    handleMarkContacted(new Date(`${v}T12:00:00`), formatDate(v));
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Información (plegable, scroll de página) */}
        <details open className="group rounded-2xl border border-border bg-card px-4 py-3.5">
          <summary className="flex cursor-pointer select-none list-none items-center justify-between [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-bold">
              Información
              {pendingActions.length > 0 && (
                <span className="ml-2 inline-flex h-4 items-center rounded-full bg-destructive px-1.5 text-[9px] font-bold text-destructive-foreground">
                  {pendingActions.length} tarea{pendingActions.length > 1 ? "s" : ""}
                </span>
              )}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 space-y-2.5">
            {client.phone && (
              <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {client.phone}
              </div>
            )}
            {client.email && (
              <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{client.email}</span>
              </div>
            )}
            {client.company && (
              <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {client.company}
              </div>
            )}
            {client.birthday && (
              <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                <Cake className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {formatDate(client.birthday)}
              </div>
            )}
            {client.address && (
              <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{client.address}</span>
              </div>
            )}
            {client.notes && (
              <p className="text-xs italic text-muted-foreground">
                <FileText className="mr-1 inline h-3 w-3" />{client.notes}
              </p>
            )}
            <div className="pt-1">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Etiquetas</p>
              <ContactTags clientId={client.id} />
            </div>
          </div>
        </details>

        {/* Búsqueda (plegable) */}
        {client.is_client && (client.preferred_zones || budget || client.property_type_interest) && (
          <details open className="group rounded-2xl border border-border bg-card px-4 py-3.5">
            <summary className="flex cursor-pointer select-none list-none items-center justify-between [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-bold">Búsqueda</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 space-y-2.5">
              {client.preferred_zones && (
                <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {client.preferred_zones}
                </div>
              )}
              {budget && (
                <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                  <DollarSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {budget}
                </div>
              )}
              {client.property_type_interest && (
                <div className="flex items-center gap-2.5 text-sm text-foreground/80">
                  <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {client.property_type_interest}
                </div>
              )}
              {client.source && (
                <span className="inline-flex rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                  {client.source}
                </span>
              )}
            </div>
          </details>
        )}

        {/* ===== Propiedades (sección protagonista) ===== */}
        {client.is_client && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 px-0.5">
              <h2 className="text-base font-extrabold tracking-tight">Propiedades</h2>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-extrabold text-primary-foreground">
                {properties.length}
              </span>
            </div>

            {properties.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
                <Home className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-semibold text-muted-foreground">Sin propiedades vinculadas todavía</p>
                <p className="mt-1 text-xs text-muted-foreground/70">Vinculá desde el explorador o pedile a Alan en el chat.</p>
              </div>
            ) : (
              <>
                {visibleProps.map((cp) => {
                  const p = cp.properties;
                  if (!p) return null;
                  const propUrl = withAssociate(p.url);
                  return (
                    <div key={cp.id} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
                      {p.photo ? (
                        <img
                          src={p.photo}
                          alt=""
                          className="h-[88px] w-[88px] shrink-0 rounded-xl bg-muted object-cover"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground/40">
                          <Home className="h-6 w-6" />
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-[13px] font-bold leading-snug">{p.title ?? "Sin título"}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${propStatusChip[cp.status] ?? "bg-muted text-muted-foreground"}`}>
                            {propStatusLabel[cp.status] ?? cp.status}
                          </span>
                        </div>
                        {p.address && (
                          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{p.address}</span>
                          </p>
                        )}
                        {p.price != null && (
                          <p className="text-sm font-extrabold text-primary">
                            {p.currency ?? "USD"} {p.price.toLocaleString("es-AR")}
                          </p>
                        )}
                        {cp.notes && <p className="truncate text-[10px] italic text-muted-foreground">💬 {cp.notes}</p>}
                        <div className="mt-auto flex gap-1.5 pt-1.5">
                          {propUrl && (
                            <a href={propUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                              <Button variant="outline" className="h-9 w-full gap-1 rounded-lg text-xs font-bold">
                                <ExternalLink className="h-3.5 w-3.5" /> Abrir
                              </Button>
                            </a>
                          )}
                          <Button
                            variant="outline" size="icon"
                            className="h-9 w-11 rounded-lg"
                            onClick={() => handleWhatsApp(cp)}
                            disabled={!client.phone || !p.url}
                            title={client.phone ? "Enviar por WhatsApp" : "Sin teléfono"}
                          >
                            <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
                          </Button>
                          <Button
                            variant="outline" size="icon"
                            className="h-9 w-11 rounded-lg text-destructive hover:text-destructive"
                            onClick={() => handleUnlinkProperty(cp.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {properties.length > PROPS_PREVIEW_COUNT && (
                  <Button
                    variant="outline"
                    className="h-11 w-full rounded-xl text-[13px] font-bold text-primary"
                    onClick={() => setShowAllProps(v => !v)}
                  >
                    {showAllProps ? "Ver menos" : `Ver todas (${properties.length})`}
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {/* ===== Notas ===== */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 px-0.5">
            <h2 className="text-base font-extrabold tracking-tight">Notas</h2>
            {notes.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-extrabold text-muted-foreground">
                {notes.length}
              </span>
            )}
          </div>

          {/* Composer */}
          <div className="rounded-2xl border border-border bg-card p-3">
            <Textarea
              placeholder="Escribí una nota…"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-[56px] resize-none border-none p-0 text-[13px] shadow-none focus-visible:ring-0"
            />
            <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-2.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={isAction} onCheckedChange={(v) => setIsAction(v === true)} className="h-3.5 w-3.5" />
                Acción pendiente
              </label>
              <Button
                size="sm"
                className="h-9 gap-1.5 rounded-lg px-4 text-[13px] font-bold"
                onClick={handleAddNote}
                disabled={!newNote.trim() || savingNote}
              >
                <Send className="h-3.5 w-3.5" /> Agregar
              </Button>
            </div>
          </div>

          {notes.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-6 text-center">
              <StickyNote className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">Sin notas todavía</p>
            </div>
          )}

          {notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-2xl border p-3.5 ${
                note.is_action && !note.is_done
                  ? "border-primary/30 bg-primary/5"
                  : note.is_done
                  ? "border-border bg-muted/50 opacity-60"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {note.is_action && (
                  <button onClick={() => handleToggleNoteDone(note)} className="mt-0.5 shrink-0">
                    {note.is_done ? (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground" />
                    )}
                  </button>
                )}
                <p className={`flex-1 text-[13px] leading-relaxed ${note.is_done ? "line-through" : ""}`}>
                  {note.content}
                </p>
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteNote(note.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className={`mt-1.5 text-[11px] text-muted-foreground ${note.is_action ? "pl-[30px]" : ""}`}>
                {formatDateTime(note.created_at)}
              </p>
            </div>
          ))}
        </div>
      </div>

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
      <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => { if (!deleting) setShowDeleteConfirm(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente a <strong>{client.full_name}</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                await handleDelete();
              }}
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClientDetail;
