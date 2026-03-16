import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, UserPlus, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const clientTypeLabel: Record<string, string> = {
  buyer: "🔍 Comprador",
  seller: "🏠 Vendedor",
  both: "↔️ Ambos",
};

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
        .order("full_name");
      setClients((data as Client[]) ?? []);

      // Check which clients already have this property linked
      const { data: linked } = await supabase
        .from("client_properties")
        .select("client_id")
        .eq("property_id", propertyId)
        .eq("user_id", user.id);
      setAlreadyLinked(new Set((linked ?? []).map((l: any) => l.client_id)));

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
            <p className="text-xs text-muted-foreground truncate mt-1">{propertyTitle}</p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Search clients */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Client list */}
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
                    disabled={isLinked}
                    onClick={() => setSelectedClient(isSelected ? null : c.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b border-border last:border-b-0 ${
                      isLinked
                        ? "opacity-50 cursor-not-allowed bg-muted/50"
                        : isSelected
                        ? "bg-primary/10"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{c.full_name}</p>
                      <p className="text-xs text-muted-foreground">{clientTypeLabel[c.client_type] ?? c.client_type}</p>
                    </div>
                    {isLinked ? (
                      <span className="text-xs text-muted-foreground shrink-0">Ya vinculada</span>
                    ) : isSelected ? (
                      <Check className="h-4 w-4 text-primary shrink-0" />
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
                <SelectTrigger className="h-9 text-xs flex-1">
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

          {/* Action */}
          <Button
            className="w-full"
            disabled={!selectedClient || linking}
            onClick={handleLink}
          >
            {linking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            {linking ? "Vinculando..." : "Vincular propiedad"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
