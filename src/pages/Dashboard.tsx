import { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Zap, Users, MessageSquare, Building2, Phone, ChevronRight, Circle,
  Cake, Home, FileText, Pin, type LucideIcon
} from "lucide-react";
import { CLIENT_STATUS_META, type ClientStatus } from "@/lib/client-status";
import { useNavigate } from "react-router-dom";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";

interface Client {
  id: string;
  full_name: string;
  status: string;
  phone: string | null;
  email: string | null;
  last_contact_at: string | null;
  updated_at: string;
  is_client: boolean | null;
}

interface ClientEvent {
  id: string;
  client_id: string;
  event_type: string;
  title: string;
  event_date: string;
  recurrence: string;
  notes: string | null;
  clients: { full_name: string } | null;
}

interface PendingNote {
  id: string;
  content: string;
  is_done: boolean;
  created_at: string;
  client_id: string;
  client_name?: string;
}

interface DashboardData {
  totalProperties: number;
  totalClients: number;
  weeklyActions: number;
  totalConversations: number;
  clients: Client[];
  events: ClientEvent[];
  recentConversations: { id: string; title: string; updated_at: string }[];
  pendingNotes: PendingNote[];
}

const eventTypeIcon: Record<string, LucideIcon> = {
  birthday: Cake,
  purchase_anniversary: Home,
  contract_expiry: FileText,
  followup: Phone,
  custom: Pin,
};

const STALE_DAYS = 14;

// Chips de conteo de los títulos de sección (artboard Panel): neutro, rojo (tareas), ámbar (sin contacto).
const CHIP_TONES = {
  neutral: "bg-white/[0.07] text-[#A7AEBA]",
  hot: "border border-[rgba(255,90,77,0.32)] bg-[rgba(255,90,77,0.18)] text-[hsl(var(--hot))]",
  amber: "border border-[rgba(245,178,63,0.30)] bg-[rgba(245,178,63,0.16)] text-[hsl(var(--warm-soft-foreground))]",
} as const;

const CountChip = ({ n, tone = "neutral" }: { n: number; tone?: keyof typeof CHIP_TONES }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${CHIP_TONES[tone]}`}>{n}</span>
);

const SectionHeader = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="mb-[11px] flex items-center gap-[9px]">
    <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
    {children}
  </div>
);

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const handleToggleNote = async (noteId: string) => {
    await supabase.from("client_notes").update({ is_done: true }).eq("id", noteId);
    setData(prev => prev ? {
      ...prev,
      pendingNotes: prev.pendingNotes.filter(n => n.id !== noteId),
    } : prev);
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [
      propsRes, clientsRes, convsRes, allClientsRes, eventsRes, notesRes,
      sentPropsRes, weekEventsRes, doneActionsRes,
    ] = await Promise.all([
      supabase.from("properties").select("id", { count: "exact", head: true }),
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase.from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(5),
      supabase.from("clients").select("id, full_name, status, phone, email, last_contact_at, updated_at, is_client").eq("user_id", user.id).order("updated_at", { ascending: false }),
      supabase.from("client_events").select("id, client_id, event_type, title, event_date, recurrence, notes, clients(full_name)").eq("user_id", user.id).order("event_date", { ascending: true }),
      supabase.from("client_notes").select("id, content, is_done, created_at, client_id").eq("user_id", user.id).eq("is_action", true).eq("is_done", false).order("created_at", { ascending: false }).limit(20),
      // Acciones de valor de los últimos 7 días (North Star): propiedades enviadas + eventos agendados + tareas-acción completadas
      supabase.from("client_properties").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "enviada").gte("updated_at", sevenDaysAgo),
      supabase.from("client_events").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", sevenDaysAgo),
      supabase.from("client_notes").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_action", true).eq("is_done", true).gte("completed_at", sevenDaysAgo),
    ]);
    const clientMap = new Map((allClientsRes.data as Client[] ?? []).map(c => [c.id, c.full_name]));
    const pendingNotes: PendingNote[] = ((notesRes.data as Omit<PendingNote, "client_name">[] | null) ?? []).map((n) => ({
      ...n,
      client_name: clientMap.get(n.client_id) ?? "Cliente",
    }));
    const weeklyActions = (sentPropsRes.count ?? 0) + (weekEventsRes.count ?? 0) + (doneActionsRes.count ?? 0);

    setData({
      totalProperties: propsRes.count ?? 0,
      totalClients: clientsRes.count ?? 0,
      weeklyActions,
      totalConversations: convsRes.data?.length ?? 0,
      clients: (allClientsRes.data as Client[]) ?? [],
      events: (eventsRes.data as unknown as ClientEvent[]) ?? [],
      recentConversations: convsRes.data ?? [],
      pendingNotes,
    });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const { pullDistance, refreshing } = usePullToRefresh({
    onRefresh: loadDashboard,
    scrollRef,
  });

  // Pipeline: group clients by status
  const pipeline = useMemo(() => {
    if (!data) return {};
    const groups: Record<string, Client[]> = {};
    for (const c of data.clients) {
      if (!c.is_client) continue;
      if (!groups[c.status]) groups[c.status] = [];
      groups[c.status].push(c);
    }
    return groups;
  }, [data]);

  // Upcoming events this week (next 7 days, considering recurrence)
  const upcomingEvents = useMemo(() => {
    if (!data) return [];
    const today = new Date();
    const weekLater = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    return data.events.map(ev => {
      const [year, month, day] = ev.event_date.split("-").map(Number);
      let nextOccurrence: Date;
      if (ev.recurrence === "yearly") {
        nextOccurrence = new Date(today.getFullYear(), month - 1, day);
        if (nextOccurrence < new Date(today.toISOString().slice(0, 10))) {
          nextOccurrence = new Date(today.getFullYear() + 1, month - 1, day);
        }
      } else if (ev.recurrence === "monthly") {
        nextOccurrence = new Date(today.getFullYear(), today.getMonth(), day);
        if (nextOccurrence < new Date(today.toISOString().slice(0, 10))) {
          nextOccurrence = new Date(today.getFullYear(), today.getMonth() + 1, day);
        }
      } else {
        nextOccurrence = new Date(year, month - 1, day);
      }
      return { ...ev, nextOccurrence, nextOccurrenceStr: nextOccurrence.toISOString().slice(0, 10) };
    }).filter(ev => {
      const todayStr = today.toISOString().slice(0, 10);
      const weekStr = weekLater.toISOString().slice(0, 10);
      return ev.nextOccurrenceStr >= todayStr && ev.nextOccurrenceStr <= weekStr;
    }).sort((a, b) => a.nextOccurrenceStr.localeCompare(b.nextOccurrenceStr));
  }, [data]);

  // Stale clients (no contact in 14+ days)
  const staleClients = useMemo(() => {
    if (!data) return [];
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    return data.clients
      .filter(c => c.is_client && (c.status === "hot" || c.status === "warm"))
      .filter(c => {
        const lastContact = c.last_contact_at ? new Date(c.last_contact_at) : new Date(c.updated_at);
        return lastContact < cutoff;
      })
      .sort((a, b) => {
        const aDate = a.last_contact_at ?? a.updated_at;
        const bDate = b.last_contact_at ?? b.updated_at;
        return aDate.localeCompare(bDate);
      })
      .slice(0, 10);
  }, [data]);

  const formatRelative = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return "hoy";
    if (diffDays === 1) return "ayer";
    if (diffDays < 7) return `hace ${diffDays}d`;
    if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)}sem`;
    return `hace ${Math.floor(diffDays / 30)}m`;
  };

  const formatEventDate = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (dateStr === today.toISOString().slice(0, 10)) return "Hoy";
    if (dateStr === tomorrow.toISOString().slice(0, 10)) return "Mañana";
    return d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
  };

  // Métricas con ícono arriba-izquierda y color token (artboard Panel): ámbar acciones, azul de
  // marca propiedades, verde éxito contactos, violeta conversaciones.
  const metricCards = data ? [
    { label: "Acciones · 7 días", value: data.weeklyActions, icon: Zap, color: "text-[hsl(var(--warm))]" },
    { label: "Propiedades", value: data.totalProperties, icon: Building2, color: "text-[hsl(var(--brand))]" },
    { label: "Contactos", value: data.totalClients, icon: Users, color: "text-[hsl(var(--success))]" },
    { label: "Conversaciones", value: data.totalConversations, icon: MessageSquare, color: "text-[hsl(var(--chart-violet))]" },
  ] : [];

  const pipelineOrder: ClientStatus[] = ["hot", "warm", "cold"];
  const todayStr = new Date().toISOString().slice(0, 10);
  // "miércoles 19 de agosto" — es-AR mete una coma después del día de la semana; el artboard no.
  const todayLabel = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Header estándar: flecha atrás + título 17/600 + subtítulo con la fecha */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => navigate(-1)} aria-label="Volver">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold leading-[1.15] tracking-[-0.02em]">Centro de control</h1>
          <p className="mt-[3px] text-[11px] leading-[1.2] text-muted-foreground">{todayLabel}</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-8 pt-4 space-y-4 safe-bottom">
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[88px] rounded-2xl bg-white/[0.06]" />)}
            </div>
            <Skeleton className="h-36 rounded-[14px] bg-white/[0.06]" />
            <Skeleton className="h-44 rounded-[14px] bg-white/[0.06]" />
          </div>
        ) : (
          <>
            {/* Métricas */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {metricCards.map(card => (
                <div key={card.label} className="rounded-2xl border border-white/[0.09] bg-white/5 px-[13px] py-[11px]">
                  <card.icon className={`h-[17px] w-[17px] ${card.color}`} strokeWidth={1.8} aria-hidden="true" />
                  <p className="mt-[9px] text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums">{card.value.toLocaleString("es-AR")}</p>
                  <p className="mt-[5px] text-[11px] text-muted-foreground">{card.label}</p>
                </div>
              ))}
            </div>

            {/* Esta semana */}
            <section>
              <SectionHeader title="Esta semana">
                {upcomingEvents.length > 0 && <CountChip n={upcomingEvents.length} />}
              </SectionHeader>

              {upcomingEvents.length === 0 ? (
                <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.04] px-[13px] py-4 text-center">
                  <p className="text-xs text-muted-foreground">Sin eventos esta semana</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {upcomingEvents.map(ev => {
                    const isToday = ev.nextOccurrenceStr === todayStr;
                    const EventIcon = eventTypeIcon[ev.event_type] ?? Pin;
                    return (
                      <div
                        key={ev.id}
                        className={`flex min-h-11 items-center gap-3 rounded-[14px] border px-[13px] py-2.5 ${
                          isToday
                            ? "border-[rgba(91,147,255,0.28)] bg-[rgba(91,147,255,0.10)]"
                            : "border-white/[0.09] bg-white/5"
                        }`}
                      >
                        <EventIcon
                          className={`h-[19px] w-[19px] shrink-0 ${isToday ? "text-[hsl(var(--primary-soft-foreground))]" : "text-[#A7AEBA]"}`}
                          strokeWidth={1.7}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#E4E8EE]">{ev.title}</p>
                          {ev.clients?.full_name && (
                            <p className="mt-[3px] text-[11px] text-muted-foreground">{ev.clients.full_name}</p>
                          )}
                        </div>
                        <span className={`shrink-0 text-xs ${isToday ? "font-semibold text-[hsl(var(--primary-soft-foreground))]" : "font-medium text-muted-foreground"}`}>
                          {formatEventDate(ev.nextOccurrenceStr)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Tareas pendientes */}
            {data!.pendingNotes.length > 0 && (
              <section>
                <SectionHeader title="Tareas pendientes">
                  <CountChip n={data!.pendingNotes.length} tone="hot" />
                </SectionHeader>

                <div className="divide-y divide-white/[0.06] overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.04]">
                  {data!.pendingNotes.map(note => (
                    <div key={note.id} className="flex items-start gap-[11px] px-[13px] py-2.5">
                      {/* Área táctil 44 con el círculo de 17 centrado (márgenes negativos para no inflar la fila) */}
                      <button
                        type="button"
                        onClick={() => handleToggleNote(note.id)}
                        aria-label={`Marcar como hecha: ${note.content}`}
                        className="-my-2.5 -ml-3 -mr-[15px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#7E8694] transition-colors hover:text-foreground"
                      >
                        <Circle className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/clients/${note.client_id}`)}
                        className="-my-2.5 min-w-0 flex-1 py-2.5 text-left"
                      >
                        <span className="block text-[13px] leading-[1.45] text-[#DDE1E8]">{note.content}</span>
                        <span className="mt-1 block text-[11px] text-[hsl(var(--primary-soft-foreground))]">{note.client_name}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Pipeline de clientes: 3 columnas con tinte token por estado */}
            <section>
              <SectionHeader title="Pipeline de clientes" />

              <div className="grid grid-cols-3 gap-2.5">
                {pipelineOrder.map(status => {
                  const config = CLIENT_STATUS_META[status];
                  const clients = pipeline[status] ?? [];
                  return (
                    <div
                      key={status}
                      className="rounded-[14px] border p-3"
                      style={{ background: config.bg, borderColor: config.border }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: config.dot }} />
                        <span className="truncate text-[11px] font-semibold" style={{ color: config.text }}>{config.plural}</span>
                      </div>
                      <p className="mt-2.5 text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums" style={{ color: config.text }}>
                        {clients.length}
                      </p>
                    </div>
                  );
                })}
              </div>

              <Button
                variant="ghost"
                size="md"
                className="mt-2 w-full text-xs text-muted-foreground"
                onClick={() => navigate("/clients")}
              >
                Ver todos los clientes <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </section>

            {/* Sin contacto reciente: chip ámbar, contenedor neutro */}
            {staleClients.length > 0 && (
              <section>
                <SectionHeader title="Sin contacto reciente">
                  <CountChip n={staleClients.length} tone="amber" />
                </SectionHeader>

                <div className="divide-y divide-white/[0.06] overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.04]">
                  {staleClients.map(c => {
                    const lastDate = c.last_contact_at ?? c.updated_at;
                    return (
                      <div key={c.id} className="flex items-center gap-3 px-[13px] py-2.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/clients/${c.id}`)}
                          className="-my-2.5 min-w-0 flex-1 py-2.5 text-left"
                        >
                          <span className="block truncate text-sm font-medium text-[#E4E8EE]">{c.full_name}</span>
                          <span className="mt-[3px] block text-[11px] text-muted-foreground">Último contacto: {formatRelative(lastDate)}</span>
                        </button>
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            aria-label={`Llamar a ${c.full_name}`}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgba(91,147,255,0.30)] bg-[rgba(91,147,255,0.16)] text-[hsl(var(--primary-soft-foreground))] transition-colors hover:bg-[rgba(91,147,255,0.24)]"
                          >
                            <Phone className="h-[15px] w-[15px]" strokeWidth={1.7} aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Conversaciones recientes */}
            <section>
              <SectionHeader title="Conversaciones recientes" />
              {data!.recentConversations.length === 0 ? (
                <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.04] px-[13px] py-4 text-center">
                  <p className="text-xs text-muted-foreground">Sin conversaciones aún</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data!.recentConversations.map(conv => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => navigate("/")}
                      className="flex min-h-11 w-full items-center justify-between rounded-[14px] border border-white/[0.09] bg-white/5 px-[13px] py-2.5 text-left transition-colors hover:bg-white/10 active:scale-[0.99]"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#E4E8EE]">{conv.title}</span>
                      <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">{formatRelative(conv.updated_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
