import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Users, Phone, Mail, FileText, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Client {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string;
  created_at: string;
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

const Clients = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState({ full_name: "", phone: "", email: "", notes: "", status: "prospect" });
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadClients = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, phone, email, notes, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setClients(data ?? []);
    } catch {
      toast.error("Error al cargar los clientes");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const openEdit = (client: Client) => {
    setEditClient(client);
    setEditForm({
      full_name: client.full_name,
      phone: client.phone ?? "",
      email: client.email ?? "",
      notes: client.notes ?? "",
      status: client.status,
    });
  };

  const handleSaveEdit = async () => {
    if (!editClient) return;
    const name = editForm.full_name.trim();
    if (!name) {
      toast.error("El nombre no puede estar vacío");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("clients")
        .update({
          full_name: name,
          phone: editForm.phone.trim() || null,
          email: editForm.email.trim() || null,
          notes: editForm.notes.trim() || null,
          status: editForm.status,
        })
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
            {loading ? "Cargando..." : `${clients.length} cliente${clients.length !== 1 ? "s" : ""}`}
          </p>
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
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Users className="h-14 w-14 text-muted-foreground/30" />
            <p className="text-base font-medium text-muted-foreground">No tenés clientes registrados</p>
            <p className="text-sm text-muted-foreground/70 max-w-xs">
              Podés pedirle a Alan que registre un cliente desde el chat con lenguaje natural.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              Ir al chat
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map((client) => (
              <div
                key={client.id}
                className="rounded-xl border border-border bg-card p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm leading-tight">{client.full_name}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={statusVariant[client.status] ?? "secondary"}>
                      {statusLabel[client.status] ?? client.status}
                    </Badge>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(client)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteClient(client)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {client.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span>{client.phone}</span>
                  </div>
                )}

                {client.email && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{client.email}</span>
                  </div>
                )}

                {client.notes && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <FileText className="h-3 w-3 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{client.notes}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editClient} onOpenChange={(open) => !open && setEditClient(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre *</label>
              <Input
                value={editForm.full_name}
                onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Teléfono</label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                maxLength={30}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                maxLength={255}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Estado</label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prospect">Prospecto</SelectItem>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="inactive">Inactivo</SelectItem>
                  <SelectItem value="closed">Cerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas</label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                maxLength={1000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClient(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
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
    </div>
  );
};

export default Clients;
