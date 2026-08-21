import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Phone, Mail, UserPlus, MapPin, DollarSign, Home, Clock } from "lucide-react";
import type { MatchedClient } from "@/hooks/use-property-matches";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "@/lib/contact-avatar";
import { ClientStatusChip } from "@/components/ClientStatusChip";
import { CLIENT_TYPE_LABEL } from "@/lib/client-status";

// Diálogo "Clientes compatibles" del explorador de propiedades (ticket 86ak3z09d): cada cliente
// es una fila de vidrio con avatar de AVATAR_COLORS, ClientStatusChip, las razones de match como
// chips de vidrio y el botón Vincular de 44. Hereda el fondo de vidrio de DialogContent.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: MatchedClient[];
  loading: boolean;
  propertyTitle?: string;
  onLinkClient?: (clientId: string, clientName: string) => void;
}

function formatBudget(min: number | null, max: number | null, cur: string | null) {
  const sym = cur ?? "USD";
  if (min && max) return `${sym} ${min.toLocaleString("es-AR")} – ${max.toLocaleString("es-AR")}`;
  if (min) return `Desde ${sym} ${min.toLocaleString("es-AR")}`;
  if (max) return `Hasta ${sym} ${max!.toLocaleString("es-AR")}`;
  return null;
}

function formatLastContact(date: string | null): string | null {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  if (days < 30) return `Hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? "Hace 1 mes" : `Hace ${months} meses`;
}

const GLASS_ROW = "rounded-[16px] border border-white/[0.09] bg-white/5 p-3";
const CONTACT_LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-1.5 -mx-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";

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
            <p className="text-xs text-muted-foreground truncate pr-8">
              {propertyTitle}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`${GLASS_ROW} flex items-center gap-3`}>
                  <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
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
                Se requieren al menos 2 criterios coincidentes (zona, presupuesto o tipo de propiedad). Asegurate de que tus clientes tengan estos campos configurados.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-muted-foreground mb-3">
                {matches.length} cliente{matches.length !== 1 ? "s" : ""} compatible{matches.length !== 1 ? "s" : ""}
              </p>
              {matches.map((c) => {
                const budget = formatBudget(c.budget_min, c.budget_max, c.budget_currency);
                const lastContact = formatLastContact(c.last_contact_at);
                return (
                  <div key={c.id} data-testid="match-row" className={`${GLASS_ROW} space-y-2.5`}>
                    {/* Cabecera: avatar + nombre + chips; Vincular a la derecha */}
                    <div className="flex items-center gap-3">
                      <div
                        aria-hidden="true"
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_COLORS[getAvatarColorIndex(c.full_name)]}`}
                      >
                        {getInitials(c.full_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{c.full_name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <ClientStatusChip status={c.status} />
                          {c.client_type && (
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {CLIENT_TYPE_LABEL[c.client_type] ?? c.client_type}
                            </span>
                          )}
                        </div>
                      </div>
                      {onLinkClient && (
                        <button
                          type="button"
                          className="flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] px-3.5 text-xs font-semibold text-white shadow-[0_8px_20px_-10px_rgba(59,123,255,0.9)] transition-opacity hover:opacity-90"
                          onClick={() => onLinkClient(c.id, c.full_name)}
                        >
                          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                          Vincular
                        </button>
                      )}
                    </div>

                    {/* Qué busca */}
                    {(c.preferred_zones || budget || c.property_type_interest) && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {c.preferred_zones && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-[hsl(var(--brand))]" aria-hidden="true" />
                            {c.preferred_zones}
                          </span>
                        )}
                        {budget && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3 text-[hsl(var(--brand))]" aria-hidden="true" />
                            {budget}
                          </span>
                        )}
                        {c.property_type_interest && (
                          <span className="flex items-center gap-1">
                            <Home className="h-3 w-3 text-[hsl(var(--brand))]" aria-hidden="true" />
                            {c.property_type_interest}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Último contacto */}
                    {lastContact && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
                        Último contacto: {lastContact}
                      </div>
                    )}

                    {/* Contacto (links con área táctil ≥44) */}
                    {(c.phone || c.email) && (
                      <div className="flex flex-wrap gap-x-3">
                        {c.phone && (
                          <a href={`tel:${c.phone}`} className={CONTACT_LINK}>
                            <Phone className="h-3 w-3" aria-hidden="true" />
                            {c.phone}
                          </a>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} className={`${CONTACT_LINK} min-w-0`}>
                            <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{c.email}</span>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Razones del match: chips de vidrio */}
                    {c.matchReasons.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {c.matchReasons.map((r, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center rounded-full border border-white/[0.09] bg-white/[0.06] px-2 py-0.5 text-[10px] text-foreground/80"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
