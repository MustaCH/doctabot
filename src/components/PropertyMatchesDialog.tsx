import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Phone, Mail, UserPlus } from "lucide-react";
import type { MatchedClient } from "@/hooks/use-property-matches";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: MatchedClient[];
  loading: boolean;
  propertyTitle?: string;
  onLinkClient?: (clientId: string, clientName: string) => void;
}

const statusLabels: Record<string, string> = {
  prospect: "Prospecto",
  active: "Activo",
  closed: "Cerrado",
  inactive: "Inactivo",
};

export function PropertyMatchesDialog({
  open,
  onOpenChange,
  matches,
  loading,
  propertyTitle,
  onLinkClient,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Clientes compatibles
          </DialogTitle>
          {propertyTitle && (
            <p className="text-xs text-muted-foreground truncate">
              {propertyTitle}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">
                No se encontraron clientes compatibles
              </p>
              <p className="text-xs text-muted-foreground/70 max-w-xs">
                Asegurate de que tus clientes tengan configuradas las zonas preferidas, presupuesto y tipo de propiedad buscada.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                {matches.length} cliente{matches.length !== 1 ? "s" : ""} compatible{matches.length !== 1 ? "s" : ""}
              </p>
              {matches.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-border bg-card p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {c.full_name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {statusLabels[c.status] ?? c.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {c.client_type === "buyer" ? "Comprador" : c.client_type === "seller" ? "Vendedor" : c.client_type}
                        </span>
                      </div>
                    </div>
                    {onLinkClient && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs shrink-0"
                        onClick={() => onLinkClient(c.id, c.full_name)}
                      >
                        <UserPlus className="h-3 w-3" />
                        Vincular
                      </Button>
                    )}
                  </div>

                  {/* Contact info */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="h-3 w-3" />
                        {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate"
                      >
                        <Mail className="h-3 w-3" />
                        {c.email}
                      </a>
                    )}
                  </div>

                  {/* Match reasons */}
                  <div className="flex flex-wrap gap-1">
                    {c.matchReasons.map((r, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 font-normal"
                      >
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
