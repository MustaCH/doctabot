import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, UserPlus, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "@/lib/contact-avatar";
import { ClientStatusChip } from "@/components/ClientStatusChip";
import { CLIENT_TYPE_LABEL as clientTypeLabel } from "@/lib/client-status";

// Diálogo "Vincular a cliente" del explorador (ticket 86ak3z09d): filas de 44+ con avatar de
// AVATAR_COLORS, el seleccionado con fondo azul tenue, y "Vincular propiedad" como primario de 48.

interface Client {
  id: string;
  full_name: string;
  client_type: string;
  status: string;
}

interface LinkPropertyToClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyTitle?: string;
}

const STATUS_OPTIONS = [
  { value: "sugerida", label: "Sugerida" },
  { value: "enviada", label: "Enviada" },
  { value: "visitada", label: "Visitada" },
];

export function LinkPropertyToClientDialog({ open, onOpenChange, propertyId, propertyTitle }: LinkPropertyToClientDialogProps) {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [status, setStatus] = useState("sugerida");
  const [linking, setLinking] = useState(false);
  const [alreadyLinked, setAlreadyLinked] = useState<Set<string>>(new Set());

  // Load clients
  useEffect(() => {
    if (!open || !user) return;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, client_type, status")
        .eq("user_id", user.id)
        .eq("is_client", true)
        .order("full_name");
      setClients((data as Client[]) ?? []);

      // Check which clients already have this property linked
      const { data: linked } = await supabase
        .from("client_properties")
        .select("client_id")
        .eq("property_id", propertyId)
        .eq("user_id", user.id);
      setAlreadyLinked(new Set((linked ?? []).map((l: { client_id: string }) => l.client_id)));

      setLoading(false);
    };
    load();
  }, [open, user, propertyId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedClient(null);
      setStatus("sugerida");
    }
  }, [open]);

  const filtered = clients.filter((c) =>
    c.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleLink = async () => {
    if (!user || !selectedClient) return;
    setLinking(true);
    try {
      const { error } = await supabase.from("client_properties").insert({
        client_id: selectedClient,
        property_id: propertyId,
        user_id: user.id,
        status,
      });
      if (error) {
        if (error.code === "23505") {
          toast.error("Esta propiedad ya está vinculada a ese cliente");
        } else {
          throw error;
        }
      } else {
        const clientName = clients.find((c) => c.id === selectedClient)?.full_name;
        toast.success(`Propiedad vinculada a ${clientName}`);
        setAlreadyLinked((prev) => new Set([...prev, selectedClient]));
        onOpenChange(false);
      }
    } catch {
      toast.error("Error al vincular propiedad");
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-primary" />
            Vincular a cliente
          </DialogTitle>
          {propertyTitle && (
            <p className="text-xs text-muted-foreground truncate mt-1 pr-8">{propertyTitle}</p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Search clients */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Buscar cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar cliente"
              className="h-11 rounded-[14px] border-white/[0.09] bg-white/[0.04] pl-10 text-sm focus-visible:ring-offset-0"
            />
          </div>

          {/* Client list: filas de 44+ con avatar; la seleccionada con fondo azul tenue */}
          <div className="max-h-56 overflow-y-auto rounded-[14px] border border-white/[0.09] bg-white/[0.03]" role="listbox" aria-label="Clientes">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {search ? "Sin resultados" : "No tenés clientes"}
              </p>
            ) : (
              filtered.map((c) => {
                const isLinked = alreadyLinked.has(c.id);
                const isSelected = selectedClient === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={isLinked}
                    onClick={() => setSelectedClient(isSelected ? null : c.id)}
                    className={`flex min-h-[52px] w-full items-center gap-3 border-b border-white/[0.06] px-3 py-2 text-left text-sm transition-colors last:border-b-0 ${
                      isLinked
                        ? "cursor-not-allowed opacity-50"
                        : isSelected
                        ? "bg-[rgba(91,147,255,0.12)]"
                        : "hover:bg-white/5"
                    }`}
                  >
                    <div
                      aria-hidden="true"
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${AVATAR_COLORS[getAvatarColorIndex(c.full_name)]}`}
                    >
                      {getInitials(c.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{c.full_name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{clientTypeLabel[c.client_type] ?? c.client_type}</span>
                        <ClientStatusChip status={c.status} />
                      </div>
                    </div>
                    {isLinked ? (
                      <span className="text-xs text-muted-foreground shrink-0">Ya vinculada</span>
                    ) : isSelected ? (
                      <Check className="h-4 w-4 shrink-0 text-[hsl(var(--brand))]" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {/* Status selector */}
          {selectedClient && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Estado:</span>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-11 flex-1 rounded-[14px] border-white/[0.09] bg-white/[0.04] text-sm" aria-label="Estado del vínculo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Action: primario de 48 */}
          <Button
            className="h-12 w-full rounded-[14px] bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-[15px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(59,123,255,0.95)] hover:opacity-90"
            disabled={!selectedClient || linking}
            onClick={handleLink}
          >
            {linking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {linking ? "Vinculando..." : "Vincular propiedad"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
