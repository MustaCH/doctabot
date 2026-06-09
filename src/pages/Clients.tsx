import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Users, Plus, Upload, Search, X } from "lucide-react";
import { toast } from "sonner";
import ImportClientsDialog from "@/components/ImportClientsDialog";
import ClientFormFields, { ClientFormData, emptyClientForm } from "@/components/ClientFormFields";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "@/lib/contact-avatar";
import { groupContacts, filterContacts, type ContactListItem, type ContactKind, type StatusFilter } from "@/lib/contact-list";

const statusChip: Record<string, { label: string; cls: string }> = {
  hot: { label: "🔥", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  warm: { label: "☀️", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  cold: { label: "❄️", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

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

const Clients = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<ContactKind>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ClientFormData>(emptyClientForm);
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadContacts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, phone, email, is_client, status, client_type")
        .eq("user_id", user.id);
      if (error) throw error;
      setContacts((data as ContactListItem[]) ?? []);
    } catch {
      toast.error("Error al cargar los contactos");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const { pullDistance, refreshing } = usePullToRefresh({ onRefresh: loadContacts, scrollRef });

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const groups = useMemo(
    () => groupContacts(filterContacts(contacts, { query: searchQuery, kind, status })),
    [contacts, searchQuery, kind, status]
  );
  const totalFiltered = useMemo(() => groups.reduce((n, g) => n + g.contacts.length, 0), [groups]);

  const handleCreate = async () => {
    if (!user) return;
    if (!createForm.full_name.trim()) { toast.error("El nombre no puede estar vacío"); return; }
    setCreating(true);
    try {
      const { error } = await supabase.from("clients").insert({ ...formToDb(createForm), user_id: user.id });
      if (error) throw error;
      toast.success("Contacto creado");
      setShowCreate(false);
      setCreateForm(emptyClientForm);
      loadContacts();
    } catch {
      toast.error("Error al crear el contacto");
    } finally {
      setCreating(false);
    }
  };

  const filterButtons: { key: ContactKind; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "client", label: "Clientes" },
    { key: "contact", label: "Contactos" },
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
          <p className="text-sm font-semibold">Contactos</p>
          <p className="text-xs text-muted-foreground">
            {loading ? "Cargando..." : `${totalFiltered} contacto${totalFiltered !== 1 ? "s" : ""}`}
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

      {/* Search + filters */}
      <div className="border-b border-border bg-card/50 px-4 py-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre, teléfono o email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 pl-9 text-sm bg-background" />
          {searchQuery && (
            <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6" onClick={() => setSearchQuery("")}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {filterButtons.map((fb) => (
            <Button key={fb.key} size="sm" variant={kind === fb.key ? "default" : "ghost"} className="h-7 text-xs px-3 shrink-0" onClick={() => setKind(fb.key)}>
              {fb.label}
            </Button>
          ))}
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-7 rounded-md border border-border bg-background px-2 text-xs">
            <option value="all">Estado: todos</option>
            <option value="hot">🔥 Caliente</option>
            <option value="warm">☀️ Tibio</option>
            <option value="cold">❄️ Frío</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto safe-bottom">
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-4 w-1/2" /></div>
            ))}
          </div>
        ) : totalFiltered === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center px-4">
            <Users className="h-14 w-14 text-muted-foreground/30" />
            <p className="text-base font-medium text-muted-foreground">No hay contactos para mostrar</p>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>Agregar contacto</Button>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.letter}>
              <div className="sticky top-0 bg-muted/80 px-4 py-1 text-xs font-bold text-primary backdrop-blur">{group.letter}</div>
              {group.contacts.map((c) => (
                <button key={c.id} onClick={() => navigate(`/clients/${c.id}`)} className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left hover:bg-muted/40">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_COLORS[getAvatarColorIndex(c.full_name)]}`}>
                    {getInitials(c.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.full_name}</p>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`rounded-full px-1.5 text-[10px] font-medium ${c.is_client ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-muted text-muted-foreground"}`}>
                        {c.is_client ? "Cliente" : "Contacto"}
                      </span>
                      {c.is_client && statusChip[c.status] && (
                        <span className={`rounded-full px-1.5 text-[10px] font-medium ${statusChip[c.status].cls}`}>{statusChip[c.status].label}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-2"><DialogTitle>Nuevo contacto</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-2 min-h-0">
            <ClientFormFields form={createForm} onChange={setCreateForm} showPlaceholders />
          </div>
          <DialogFooter className="px-5 pb-5 pt-3 border-t border-border/40 gap-2 flex-col sm:flex-col">
            <Button className="w-full" onClick={handleCreate} disabled={creating}>{creating ? "Creando..." : "Crear contacto"}</Button>
            <Button variant="outline" className="w-full" onClick={() => setShowCreate(false)} disabled={creating}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {user && <ImportClientsDialog open={showImport} onOpenChange={setShowImport} userId={user.id} onImported={loadContacts} />}
    </div>
  );
};

export default Clients;
