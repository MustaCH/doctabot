import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Phone, Mail, FileText } from "lucide-react";
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
                  <Badge variant={statusVariant[client.status] ?? "secondary"}>
                    {statusLabel[client.status] ?? client.status}
                  </Badge>
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
    </div>
  );
};

export default Clients;
