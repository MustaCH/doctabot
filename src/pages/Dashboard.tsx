import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Search, Heart, Users, MessageSquare, CalendarDays,
  AlertTriangle, Clock, TrendingUp, Phone, ChevronRight, CheckCircle2, Circle
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Client {
  id: string;
  full_name: string;
  status: string;
  phone: string | null;
  email: string | null;
  last_contact_at: string | null;
  updated_at: string;
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
  totalFavorites: number;
  totalConversations: number;
  clients: Client[];
  events: ClientEvent[];
  recentConversations: { id: string; title: string; updated_at: string }[];
  pendingNotes: PendingNote[];
}

const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  prospect: { label: "Prospectos", color: "text-amber-700 dark:text-amber-400", bgColor: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800" },
  active: { label: "Activos", color: "text-emerald-700 dark:text-emerald-400", bgColor: "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800" },
  inactive: { label: "Inactivos", color: "text-slate-600 dark:text-slate-400", bgColor: "bg-slate-100 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700" },
  closed: { label: "Cerrados", color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800" },
};

const eventTypeEmoji: Record<string, string> = {
  birthday: "🎂",
  purchase_anniversary: "🏠",
  contract_expiry: "📄",
  followup: "📞",
  custom: "📌",
};

const STALE_DAYS = 14;

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [propsRes, clientsRes, favsRes, convsRes, allClientsRes, eventsRes, notesRes] = await Promise.all([
        supabase.from("properties").select("id", { count: "exact", head: true }),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("favorites").select("id", { count: "exact", head: true }),
        supabase.from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(5),
        supabase.from("clients").select("id, full_name, status, phone, email, last_contact_at, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }),
        supabase.from("client_events").select("id, client_id, event_type, title, event_date, recurrence, notes, clients(full_name)").eq("user_id", user.id).order("event_date", { ascending: true }),
        supabase.from("client_notes").select("id, content, is_done, created_at, client_id").eq("user_id", user.id).eq("is_action", true).eq("is_done", false).order("created_at", { ascending: false }).limit(20),
      ]);
      setData({
        totalProperties: propsRes.count ?? 0,
        totalClients: clientsRes.count ?? 0,
        totalFavorites: favsRes.count ?? 0,
        totalConversations: convsRes.data?.length ?? 0,
        clients: (allClientsRes.data as Client[]) ?? [],
        events: (eventsRes.data as unknown as ClientEvent[]) ?? [],
        recentConversations: convsRes.data ?? [],
      });
      setLoading(false);
    };
    load();
  }, [user]);

  // Pipeline: group clients by status
  const pipeline = useMemo(() => {
    if (!data) return {};
    const groups: Record<string, Client[]> = {};
    for (const c of data.clients) {
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
      .filter(c => c.status === "active" || c.status === "prospect")
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

  const metricCards = data ? [
    { label: "Propiedades", value: data.totalProperties, icon: Search, color: "text-primary" },
    { label: "Clientes", value: data.totalClients, icon: Users, color: "text-emerald-600" },
    { label: "Favoritos", value: data.totalFavorites, icon: Heart, color: "text-accent" },
    { label: "Conversaciones", value: data.totalConversations, icon: MessageSquare, color: "text-violet-500" },
  ] : [];

  const pipelineOrder = ["prospect", "active", "inactive", "closed"];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3 safe-top">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <TrendingUp className="h-5 w-5 text-primary" />
        <h1 className="text-base font-bold tracking-tight">Centro de Control</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5 pt-4">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        ) : (
          <>
            {/* Metric cards */}
            <div className="grid grid-cols-4 gap-2">
              {metricCards.map(card => (
                <div key={card.label} className="rounded-xl border border-border bg-card p-3 text-center shadow-sm">
                  <card.icon className={`h-4 w-4 mx-auto mb-1 ${card.color}`} />
                  <p className="text-xl font-bold tracking-tight">{card.value.toLocaleString("es-AR")}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{card.label}</p>
                </div>
              ))}
            </div>

            {/* Upcoming events this week */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Esta semana</h2>
                  {upcomingEvents.length > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{upcomingEvents.length}</Badge>
                  )}
                </div>
              </div>

              {upcomingEvents.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground">Sin eventos esta semana 🎉</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {upcomingEvents.map(ev => {
                    const isToday = ev.nextOccurrenceStr === new Date().toISOString().slice(0, 10);
                    return (
                      <div
                        key={ev.id}
                        className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                          isToday
                            ? "border-primary/30 bg-primary/5 shadow-sm"
                            : "border-border bg-card"
                        }`}
                      >
                        <span className="text-lg">{eventTypeEmoji[ev.event_type] ?? "📌"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{ev.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {ev.clients?.full_name}
                          </p>
                        </div>
                        <span className={`text-xs font-medium shrink-0 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                          {formatEventDate(ev.nextOccurrenceStr)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Client Pipeline */}
            <section className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-600" />
                <h2 className="text-sm font-semibold">Pipeline de Clientes</h2>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {pipelineOrder.map(status => {
                  const config = statusConfig[status];
                  const clients = pipeline[status] ?? [];
                  return (
                    <div
                      key={status}
                      className={`rounded-xl border p-3 space-y-2 ${config.bgColor}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
                        <span className={`text-lg font-bold ${config.color}`}>{clients.length}</span>
                      </div>
                      {clients.length > 0 && (
                        <div className="space-y-0.5">
                          {clients.slice(0, 3).map(c => (
                            <p key={c.id} className="text-[11px] text-foreground/70 truncate">
                              {c.full_name}
                            </p>
                          ))}
                          {clients.length > 3 && (
                            <p className="text-[10px] text-muted-foreground">
                              +{clients.length - 3} más
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground h-8"
                onClick={() => navigate("/clients")}
              >
                Ver todos los clientes <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </section>

            {/* Stale contacts alert */}
            {staleClients.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <h2 className="text-sm font-semibold">Sin contacto reciente</h2>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-amber-300 text-amber-600">
                    {staleClients.length}
                  </Badge>
                </div>

                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 divide-y divide-amber-100 dark:divide-amber-900/30 overflow-hidden">
                  {staleClients.map(c => {
                    const lastDate = c.last_contact_at ?? c.updated_at;
                    return (
                      <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.full_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Último contacto: {formatRelative(lastDate)}
                          </p>
                        </div>
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Recent conversations */}
            <section className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Conversaciones recientes</h2>
              </div>
              {data!.recentConversations.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Sin conversaciones aún</p>
              ) : (
                <div className="space-y-1.5">
                  {data!.recentConversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => navigate("/")}
                      className="w-full flex items-center justify-between rounded-xl border border-border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-accent/50 active:scale-[0.99]"
                    >
                      <p className="text-sm font-medium truncate flex-1 min-w-0">{conv.title}</p>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-3">
                        {formatRelative(conv.updated_at)}
                      </span>
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
