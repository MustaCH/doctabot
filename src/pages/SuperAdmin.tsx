import React, { useEffect, useState, useCallback, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Shield, Database, Users, Heart, MessageSquare, Home,
  RefreshCw, Search, ChevronLeft, ChevronRight, Loader2, Play, Eye, X,
  Download, UserCheck, TrendingUp, CheckCircle, XCircle, AlertTriangle,
  BarChart3, Flame, Thermometer, Snowflake, FileDown, Send,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-stats`;

async function adminFetch(pin: string, action: string, extra: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ pin, action, ...extra }),
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

function downloadCSV(rows: Record<string, unknown>[] | unknown[], filename: string) {
  const typedRows = rows as Record<string, unknown>[];
  if (!typedRows.length) return;
  const keys = Object.keys(typedRows[0]);
  const csv = [
    keys.join(","),
    ...typedRows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface PlatformStats {
  properties: number; users: number; conversations: number;
  messages: number; favorites: number; clients: number;
}

interface PropertyRow {
  id: string; title: string | null; operation: string | null;
  price: number | null; currency: string | null; zone: string | null;
  property_type: string | null; address: string | null;
  created_at: string; updated_at: string;
}

interface ProfileRow {
  id: string; user_id: string; full_name: string;
  agent_code: string; created_at: string; is_super_admin?: boolean;
}

interface ConversationRow {
  id: string; title: string; user_id: string; user_name: string;
  conversation_type: string | null; created_at: string; updated_at: string;
}

interface FavoriteRow {
  id: string; user_id: string; property_id: string; user_name: string;
  property_title: string; property_zone: string | null;
  property_price: number | null; property_currency: string | null;
  created_at: string;
}

interface ClientRow {
  id: string; full_name: string; email: string | null; phone: string | null;
  status: string; notes: string | null; user_id: string; agent_name: string;
  created_at: string;
}

interface MessageRow {
  id: string; role: string; content: string; created_at: string;
}

const PAGE_SIZE = 25;

const SuperAdmin = () => {
  const { user, loading: authLoading } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [pinValidated, setPinValidated] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [validating, setValidating] = useState(false);

  // Server-side role check (RLS on user_roles blocks public access, so we use the RPC).
  useEffect(() => {
    if (!user) { setIsSuperAdmin(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "super_admin",
      });
      if (!cancelled) setIsSuperAdmin(!error && data === true);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Validate PIN against the edge function (which checks SUPER_ADMIN_PIN secret).
  const handlePin = async () => {
    if (!pin.trim()) return;
    setValidating(true);
    setPinError(false);
    try {
      await adminFetch(pin, "stats");
      setPinValidated(true);
    } catch {
      setPinError(true);
    } finally {
      setValidating(false);
    }
  };

  if (authLoading || isSuperAdmin === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isSuperAdmin) return <Navigate to="/" replace />;

  if (!pinValidated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-xs space-y-4 rounded-xl border border-border bg-card p-6 shadow-lg">
          <div className="flex items-center justify-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-bold">Super Admin</h1>
          </div>
          <p className="text-xs text-center text-muted-foreground">Ingresá el PIN de acceso</p>
          <Input
            type="password" placeholder="PIN" value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handlePin()}
            className={pinError ? "border-destructive" : ""} autoFocus
            disabled={validating}
          />
          {pinError && <p className="text-xs text-destructive text-center">PIN incorrecto</p>}
          <Button className="w-full" onClick={handlePin} disabled={validating}>
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Acceder"}
          </Button>
        </div>
      </div>
    );
  }

  return <AdminDashboard pin={pin} />;
};

function AdminDashboard({ pin }: { pin: string }) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  const loadStats = useCallback(async () => {
    setLoading(true);
    try { setStats(await adminFetch(pin, "stats")); } catch {}
    setLoading(false);
  }, [pin]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Helper to navigate to conversations filtered by user
  const [prefilterUserId, setPrefilterUserId] = useState<string | null>(null);
  const goToUserConversations = (userId: string) => {
    setPrefilterUserId(userId);
    setTab("conversations");
  };

  const statCards = stats
    ? [
        { label: "Propiedades", value: stats.properties, icon: Home, color: "text-blue-500" },
        { label: "Usuarios", value: stats.users, icon: Users, color: "text-emerald-500" },
        { label: "Conversaciones", value: stats.conversations, icon: MessageSquare, color: "text-violet-500" },
        { label: "Mensajes", value: stats.messages, icon: MessageSquare, color: "text-amber-500" },
        { label: "Favoritos", value: stats.favorites, icon: Heart, color: "text-rose-500" },
        { label: "Clientes", value: stats.clients, icon: UserCheck, color: "text-cyan-500" },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Super Admin Panel</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={loadStats}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v !== "conversations") setPrefilterUserId(null); }}>
          <TabsList className="w-full grid grid-cols-8">
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="supervisor">Supervisor</TabsTrigger>
            <TabsTrigger value="reports">Reportes</TabsTrigger>
            <TabsTrigger value="properties">Propiedades</TabsTrigger>
            <TabsTrigger value="users">Usuarios</TabsTrigger>
            <TabsTrigger value="conversations">Conversaciones</TabsTrigger>
            <TabsTrigger value="favorites">Favoritos</TabsTrigger>
            <TabsTrigger value="clients">Clientes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {loading ? <LoadingSpinner /> : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                {statCards.map((c) => (
                  <div key={c.label} className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
                    <div className="flex items-center gap-2">
                      <c.icon className={`h-4 w-4 ${c.color}`} />
                      <span className="text-xs text-muted-foreground">{c.label}</span>
                    </div>
                    <p className="text-2xl font-bold">{c.value.toLocaleString("es-AR")}</p>
                  </div>
                ))}
              </div>
            )}
            <ActivityCharts pin={pin} />
            <ScrapingStatus pin={pin} />
            <PushTestPanel pin={pin} />
            <PushDeliveryPanel pin={pin} />
            <MorningMatchesPanel />
          </TabsContent>

          <TabsContent value="properties"><PropertiesTable pin={pin} /></TabsContent>
          <TabsContent value="users"><UsersTable pin={pin} onViewConversations={goToUserConversations} /></TabsContent>
          <TabsContent value="conversations"><ConversationsTable pin={pin} initialUserId={prefilterUserId} /></TabsContent>
          <TabsContent value="favorites"><FavoritesTable pin={pin} /></TabsContent>
          <TabsContent value="clients"><ClientsTable pin={pin} /></TabsContent>
          <TabsContent value="supervisor"><SupervisorPanel pin={pin} /></TabsContent>
          <TabsContent value="reports"><ReportsPanel pin={pin} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ==================== ACTIVITY CHARTS ==================== */
function ActivityCharts({ pin }: { pin: string }) {
  const [data, setData] = useState<{ date: string; usuarios: number; mensajes: number; conversaciones: number; propiedades: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminFetch(pin, "time-stats");
        // Build 30-day array
        const days: typeof data = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          days.push({
            date: key.slice(5), // MM-DD
            usuarios: res.users[key] ?? 0,
            mensajes: res.messages[key] ?? 0,
            conversaciones: res.conversations[key] ?? 0,
            propiedades: res.properties[key] ?? 0,
          });
        }
        setData(days);
      } catch {}
      setLoading(false);
    })();
  }, [pin]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Actividad (últimos 30 días)</h2>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="mensajes" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="conversaciones" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="usuarios" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="propiedades" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ==================== SCRAPING STATUS ==================== */
interface ScrapingLog {
  id: string;
  batch_id: string;
  message: string;
  level: string;
  current_page: number | null;
  total_pages: number | null;
  properties_count: number | null;
  created_at: string;
}

function ScrapingStatus({ pin }: { pin: string }) {
  const [lastProperty, setLastProperty] = useState<{ created_at: string; updated_at: string } | null>(null);
  const [totalToday, setTotalToday] = useState(0);
  const [totalProperties, setTotalProperties] = useState(0);
  const [lastBatchTimestamp, setLastBatchTimestamp] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);
  const [logs, setLogs] = useState<ScrapingLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(() => {
    adminFetch(pin, "scraping-status").then((data) => {
      setLastProperty(data.lastProperty);
      setTotalToday(data.totalToday);
      setTotalProperties(data.totalProperties ?? 0);
      setLastBatchTimestamp(data.lastBatchTimestamp ?? null);
    }).catch(() => {});
  }, [pin]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Poll logs while scraping is active
  useEffect(() => {
    if (!scraping || !activeBatchId) return;
    const interval = setInterval(async () => {
      try {
        const res = await adminFetch(pin, "scraping-logs-live", { batchId: activeBatchId });
        setLogs(res.data ?? []);
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [scraping, activeBatchId, pin]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const triggerScraping = async () => {
    setScraping(true);
    setScrapeResult(null);
    setLogs([]);
    setShowLogs(true);
    const batchId = new Date().toISOString();
    setActiveBatchId(batchId);
    try {
      const res = await adminFetch(pin, "trigger-scraping");
      const parts = [`✅ ${res.upserted ?? 0} actualizadas`];
      if (res.deleted > 0) parts.push(`🗑️ ${res.deleted} obsoletas eliminadas`);
      if (res.errors > 0) parts.push(`⚠️ ${res.errors} errores`);
      if (!res.is_last_batch) parts.push(`⏭️ Lote parcial (siguiente en proceso)`);
      setScrapeResult(parts.join(" · "));
      // Final fetch of logs
      const logsRes = await adminFetch(pin, "scraping-logs-live", { batchId: res.batch_timestamp ?? activeBatchId });
      setLogs(logsRes.data ?? []);
      setActiveBatchId(res.batch_timestamp ?? activeBatchId);
      loadStatus();
    } catch {
      setScrapeResult("❌ Error al ejecutar el scraping");
    }
    setScraping(false);
  };

  // Load latest logs on mount
  useEffect(() => {
    adminFetch(pin, "scraping-logs-live").then((res) => {
      if (res.data?.length > 0) {
        setLogs(res.data);
        setActiveBatchId(res.data[0].batch_id);
      }
    }).catch(() => {});
  }, [pin]);

  // Calculate progress from logs
  const latestPageLog = [...logs].reverse().find(l => l.current_page != null && l.total_pages != null);
  const progress = latestPageLog && latestPageLog.total_pages
    ? Math.round((latestPageLog.current_page! / latestPageLog.total_pages) * 100)
    : 0;
  const isFinished = logs.some(l => l.message.includes("🏁") || l.level === "success");

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const logLevelColor = (level: string) => {
    switch (level) {
      case "error": return "text-destructive";
      case "warning": return "text-yellow-500";
      case "success": return "text-green-500";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Estado del Scraping</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowLogs(!showLogs)} className="text-xs">
            <Eye className="h-3.5 w-3.5 mr-1" />
            {showLogs ? "Ocultar logs" : "Ver logs"}
          </Button>
          <Button size="sm" variant="outline" onClick={triggerScraping} disabled={scraping}>
            {scraping ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            {scraping ? "Ejecutando..." : "Ejecutar ahora"}
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      {(scraping || (logs.length > 0 && showLogs)) && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {isFinished
                ? "✅ Completado"
                : scraping
                  ? `Procesando... ${latestPageLog ? `Página ${latestPageLog.current_page}/${latestPageLog.total_pages}` : ""}`
                  : "Último scraping"
              }
            </span>
            <span>{isFinished ? "100" : progress}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isFinished ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${isFinished ? 100 : progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Última actualización:</span>{" "}
          <span className="font-medium">{lastProperty ? fmt(lastProperty.updated_at) : "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Actualizadas hoy:</span>{" "}
          <span className="font-medium">{totalToday.toLocaleString("es-AR")}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Total activas:</span>{" "}
          <span className="font-medium">{totalProperties.toLocaleString("es-AR")}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Último lote:</span>{" "}
          <span className="font-medium">{lastBatchTimestamp ? fmt(lastBatchTimestamp) : "—"}</span>
        </div>
      </div>

      {/* Live logs */}
      {showLogs && logs.length > 0 && (
        <div className="rounded-lg border border-border bg-background/50 p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.map((log) => (
            <div key={log.id} className={`flex gap-2 ${logLevelColor(log.level)}`}>
              <span className="text-muted-foreground/60 shrink-0">
                {new Date(log.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span>{log.message}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {scrapeResult && <p className="text-xs font-medium">{scrapeResult}</p>}
      <p className="text-xs text-muted-foreground">El scraping se ejecuta diariamente. Las propiedades no vistas en el último lote se eliminan automáticamente.</p>
    </div>
  );
}

/* ==================== PUSH TEST PANEL ==================== */
interface PushSubscriber {
  user_id: string;
  full_name: string;
  subscription_count: number;
}

function PushTestPanel({ pin }: { pin: string }) {
  const [subscribers, setSubscribers] = useState<PushSubscriber[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; sent?: number; status?: number; message?: string } | null>(null);

  const loadSubscribers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(pin, "push-subscribers");
      const list: PushSubscriber[] = res.users ?? [];
      setSubscribers(list);
      if (list.length > 0 && !selectedUserId) setSelectedUserId(list[0].user_id);
    } catch {
      setSubscribers([]);
    }
    setLoading(false);
  }, [pin, selectedUserId]);

  useEffect(() => { loadSubscribers(); }, [loadSubscribers]);

  const sendTest = async () => {
    if (!selectedUserId) return;
    setSending(true);
    setResult(null);
    try {
      const res = await adminFetch(pin, "test-push", { targetUserId: selectedUserId });
      setResult({
        ok: res.ok,
        sent: res.result?.sent,
        status: res.status,
        message: res.ok
          ? `Enviada a ${res.result?.sent ?? 0} dispositivo(s)`
          : `Error HTTP ${res.status}: ${res.result?.error ?? "Falló el envío"}`,
      });
      // Reload in case dead subs were pruned
      setTimeout(loadSubscribers, 500);
    } catch (err) {
      setResult({ ok: false, message: "Error de red" });
    }
    setSending(false);
  };

  const selectedSub = subscribers.find((s) => s.user_id === selectedUserId);

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Probar notificaciones push</h2>
        </div>
        <Button size="sm" variant="ghost" onClick={loadSubscribers} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : subscribers.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No hay usuarios con suscripciones push activas. Cuando un usuario active las notificaciones desde su Perfil aparecerá acá.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Usuario destinatario</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={sending}
            >
              {subscribers.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.full_name} ({s.subscription_count} {s.subscription_count === 1 ? "dispositivo" : "dispositivos"})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {selectedSub ? `${selectedSub.subscription_count} suscripción(es) activa(s)` : ""}
            </p>
            <Button size="sm" onClick={sendTest} disabled={sending || !selectedUserId}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              {sending ? "Enviando..." : "Enviar prueba"}
            </Button>
          </div>

          {result && (
            <div
              className={`rounded-md border p-2.5 text-xs ${
                result.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              {result.message}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ==================== MORNING MATCHES ==================== */
function MorningMatchesPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ matches: number; error?: string } | null>(null);

  const runMatches = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/morning-matches`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ matches: 0, error: "Error de conexión" });
    }
    setRunning(false);
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Morning Matches</h2>
        </div>
        <Button size="sm" variant="outline" onClick={runMatches} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          {running ? "Ejecutando..." : "Ejecutar ahora"}
        </Button>
      </div>

      {result && (
        <div className={`rounded-lg border p-3 text-sm ${result.error ? "border-destructive bg-destructive/10" : "border-green-500/30 bg-green-500/10"}`}>
          {result.error ? (
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <span>{result.error}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>
                {result.matches > 0
                  ? `✅ Se generaron ${result.matches} grupo${result.matches > 1 ? "s" : ""} de matches y se notificó a los agentes.`
                  : "No se encontraron nuevos matches para notificar."}
              </span>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        El matching se ejecuta automáticamente todos los días a las 9:00 AM (ART). Cruza propiedades nuevas con los intereses de los clientes y notifica matches por chat y push.
      </p>
    </div>
  );
}


/* ==================== PROPERTIES TABLE ==================== */
function PropertiesTable({ pin }: { pin: string }) {
  const [data, setData] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(pin, "properties", { page, pageSize: PAGE_SIZE, search });
      setData(res.data); setTotal(res.total);
    } catch {}
    setLoading(false);
  }, [pin, page, search]);

  useEffect(() => { load(); }, [load]);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por título, dirección o zona..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="max-w-sm" />
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString("es-AR")} resultados</span>
        <Button variant="outline" size="sm" onClick={() => downloadCSV(data, "propiedades")}>
          <Download className="h-3.5 w-3.5 mr-1.5" />CSV
        </Button>
      </div>
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead><TableHead>Operación</TableHead>
                  <TableHead>Precio</TableHead><TableHead>Zona</TableHead>
                  <TableHead>Tipo</TableHead><TableHead>Actualizado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[200px] truncate text-xs">{p.title ?? "—"}</TableCell>
                    <TableCell className="text-xs">{p.operation ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {p.price ? `${p.currency ?? "$"} ${p.price.toLocaleString("es-AR")}` : "Consultar"}
                    </TableCell>
                    <TableCell className="text-xs">{p.zone ?? "—"}</TableCell>
                    <TableCell className="text-xs">{p.property_type ?? "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(p.updated_at).toLocaleDateString("es-AR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

/* ==================== USERS TABLE ==================== */
function UsersTable({ pin, onViewConversations }: { pin: string; onViewConversations: (userId: string) => void }) {
  const [data, setData] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(pin, "users", { page, pageSize: PAGE_SIZE, search });
      setData(res.data); setTotal(res.total);
    } catch {}
    setLoading(false);
  }, [pin, page, search]);

  useEffect(() => { load(); }, [load]);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nombre o código de agente..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="max-w-sm" />
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString("es-AR")} usuarios</span>
        <Button variant="outline" size="sm" onClick={() => downloadCSV(data, "usuarios")}>
          <Download className="h-3.5 w-3.5 mr-1.5" />CSV
        </Button>
      </div>
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead><TableHead>Código Agente</TableHead>
                  <TableHead>User ID</TableHead><TableHead>Registrado</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-xs font-medium">
                      {u.full_name}
                      {u.is_super_admin && (
                        <Badge className="ml-2 bg-violet-500/15 text-violet-600 border-violet-500/30 hover:bg-violet-500/20 text-[10px] py-0">
                          <Shield className="h-2.5 w-2.5 mr-0.5" />SuperAdmin
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{u.agent_code}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{u.user_id.slice(0, 8)}...</TableCell>
                    <TableCell className="text-xs">{new Date(u.created_at).toLocaleDateString("es-AR")}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        title="Ver conversaciones" onClick={() => onViewConversations(u.user_id)}>
                        <MessageSquare className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

/* ==================== CONVERSATIONS TABLE ==================== */
function ConversationsTable({ pin, initialUserId }: { pin: string; initialUserId: string | null }) {
  const [data, setData] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [filterUserId, setFilterUserId] = useState<string | null>(initialUserId);
  const [allUsers, setAllUsers] = useState<{ id: string; name: string }[]>([]);

  // Sync external filter
  useEffect(() => { setFilterUserId(initialUserId); setPage(0); }, [initialUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(pin, "conversations", {
        page, pageSize: PAGE_SIZE,
        ...(filterUserId ? { userId: filterUserId } : {}),
      });
      setData(res.data); setTotal(res.total);
      const newUsers = (res.data as ConversationRow[]).map(c => ({ id: c.user_id, name: c.user_name }));
      setAllUsers(prev => {
        const map = new Map(prev.map(u => [u.id, u.name]));
        newUsers.forEach(u => map.set(u.id, u.name));
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
      });
    } catch {}
    setLoading(false);
  }, [pin, page, filterUserId]);

  useEffect(() => { load(); }, [load]);

  const openMessages = async (convId: string) => {
    setSelectedConv(convId); setLoadingMessages(true);
    try {
      const res = await adminFetch(pin, "messages", { conversationId: convId });
      setMessages(res.data);
    } catch { setMessages([]); }
    setLoadingMessages(false);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground">{total.toLocaleString("es-AR")} conversaciones</span>
        <div className="flex items-center gap-2 ml-auto">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <select className="text-xs bg-card border border-border rounded-md px-2 py-1.5 text-foreground"
            value={filterUserId ?? ""}
            onChange={(e) => { setFilterUserId(e.target.value || null); setPage(0); }}>
            <option value="">Todos los usuarios</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => downloadCSV(data, "conversaciones")}>
            <Download className="h-3.5 w-3.5 mr-1.5" />CSV
          </Button>
        </div>
      </div>

      {selectedConv && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Mensajes — {data.find(c => c.id === selectedConv)?.title ?? "Conversación"}
            </h3>
            <Button variant="ghost" size="icon" onClick={() => { setSelectedConv(null); setMessages([]); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {loadingMessages ? <LoadingSpinner /> : (
            <div className="max-h-96 overflow-y-auto space-y-2">
              {messages.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Sin mensajes</p>
              ) : messages.map((m) => (
                <div key={m.id} className={`rounded-lg p-3 text-xs ${m.role === "user" ? "bg-primary/10 ml-8" : "bg-muted mr-8"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold capitalize">{m.role === "user" ? "Usuario" : "Alan"}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(m.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? <LoadingSpinner /> : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead><TableHead>Usuario</TableHead>
                  <TableHead>Tipo</TableHead><TableHead>Última actividad</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow key={c.id} className={selectedConv === c.id ? "bg-muted/50" : ""}>
                    <TableCell className="max-w-[200px] truncate text-xs">{c.title}</TableCell>
                    <TableCell className="text-xs font-medium">{c.user_name}</TableCell>
                    <TableCell className="text-xs">{c.conversation_type ?? "general"}</TableCell>
                    <TableCell className="text-xs">{new Date(c.updated_at).toLocaleDateString("es-AR")}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openMessages(c.id)} className="h-7 w-7">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

/* ==================== FAVORITES TABLE ==================== */
function FavoritesTable({ pin }: { pin: string }) {
  const [data, setData] = useState<FavoriteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await adminFetch(pin, "favorites", { page, pageSize: PAGE_SIZE });
        setData(res.data); setTotal(res.total);
      } catch {}
      setLoading(false);
    })();
  }, [pin, page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{total.toLocaleString("es-AR")} favoritos</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCSV(data, "favoritos")}>
          <Download className="h-3.5 w-3.5 mr-1.5" />CSV
        </Button>
      </div>
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Propiedad</TableHead><TableHead>Zona</TableHead>
                  <TableHead>Precio</TableHead><TableHead>Agente</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-[200px] truncate text-xs">{f.property_title}</TableCell>
                    <TableCell className="text-xs">{f.property_zone ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {f.property_price ? `${f.property_currency ?? "$"} ${f.property_price.toLocaleString("es-AR")}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{f.user_name}</TableCell>
                    <TableCell className="text-xs">{new Date(f.created_at).toLocaleDateString("es-AR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

/* ==================== CLIENTS TABLE ==================== */
function ClientsTable({ pin }: { pin: string }) {
  const [data, setData] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await adminFetch(pin, "clients", { page, pageSize: PAGE_SIZE });
        setData(res.data); setTotal(res.total);
      } catch {}
      setLoading(false);
    })();
  }, [pin, page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{total.toLocaleString("es-AR")} clientes</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCSV(data, "clientes")}>
          <Download className="h-3.5 w-3.5 mr-1.5" />CSV
        </Button>
      </div>
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead><TableHead>Email</TableHead>
                  <TableHead>Teléfono</TableHead><TableHead>Estado</TableHead>
                  <TableHead>Agente</TableHead><TableHead>Creado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs font-medium">{c.full_name}</TableCell>
                    <TableCell className="text-xs">{c.email ?? "—"}</TableCell>
                    <TableCell className="text-xs">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{c.status}</TableCell>
                    <TableCell className="text-xs">{c.agent_name}</TableCell>
                    <TableCell className="text-xs">{new Date(c.created_at).toLocaleDateString("es-AR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

/* ==================== SUPERVISOR PANEL ==================== */
interface SupervisorLogRow {
  id: string; conversation_id: string | null; user_id: string | null;
  user_message: string; alan_response: string; verdict: string;
  rejection_reason: string | null; score: number | null;
  retry_count: number; latency_ms: number | null; created_at: string;
  user_name: string;
}

interface SupervisorStats {
  total: number; approved: number; rejected: number; errors: number;
  avgScore: number; daily: Record<string, { approved: number; rejected: number; error: number }>;
}

function SupervisorPanel({ pin }: { pin: string }) {
  const [stats, setStats] = useState<SupervisorStats | null>(null);
  const [logs, setLogs] = useState<SupervisorLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [verdictFilter, setVerdictFilter] = useState("");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try { setStats(await adminFetch(pin, "supervisor-stats")); } catch {}
    setLoading(false);
  }, [pin]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await adminFetch(pin, "supervisor-logs", {
        page, pageSize: PAGE_SIZE,
        ...(verdictFilter ? { verdict: verdictFilter } : {}),
      });
      setLogs(res.data); setTotal(res.total);
    } catch {}
    setLogsLoading(false);
  }, [pin, page, verdictFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const approvalRate = stats && stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0;

  const chartData = (() => {
    if (!stats?.daily) return [];
    const days: { date: string; aprobados: number; rechazados: number; errores: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = stats.daily[key] ?? { approved: 0, rejected: 0, error: 0 };
      days.push({ date: key.slice(5), aprobados: entry.approved, rechazados: entry.rejected, errores: entry.error });
    }
    return days;
  })();

  const verdictBadge = (verdict: string) => {
    switch (verdict) {
      case "approved": return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20"><CheckCircle className="h-3 w-3 mr-1" />Aprobado</Badge>;
      case "rejected": return <Badge className="bg-rose-500/15 text-rose-600 border-rose-500/30 hover:bg-rose-500/20"><XCircle className="h-3 w-3 mr-1" />Rechazado</Badge>;
      default: return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 hover:bg-amber-500/20"><AlertTriangle className="h-3 w-3 mr-1" />Error</Badge>;
    }
  };

  return (
    <div className="mt-4 space-y-6">
      {loading ? <LoadingSpinner /> : stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
            <span className="text-xs text-muted-foreground">Total evaluaciones</span>
            <p className="text-2xl font-bold">{stats.total.toLocaleString("es-AR")}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
            <span className="text-xs text-muted-foreground">Tasa aprobación</span>
            <p className="text-2xl font-bold text-emerald-600">{approvalRate}%</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
            <span className="text-xs text-muted-foreground">Score promedio</span>
            <p className="text-2xl font-bold">{stats.avgScore}/10</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
            <span className="text-xs text-muted-foreground">Errores supervisor</span>
            <p className="text-2xl font-bold text-amber-600">{stats.errors}</p>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <h2 className="text-sm font-semibold">Evaluaciones (últimos 30 días)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="aprobados" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rechazados" stroke="hsl(0, 84%, 60%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="errores" stroke="hsl(38, 92%, 50%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground">{total.toLocaleString("es-AR")} logs</span>
          <select className="text-xs bg-card border border-border rounded-md px-2 py-1.5 text-foreground"
            value={verdictFilter} onChange={(e) => { setVerdictFilter(e.target.value); setPage(0); }}>
            <option value="">Todos</option>
            <option value="approved">Aprobados</option>
            <option value="rejected">Rechazados</option>
            <option value="error">Errores</option>
          </select>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => downloadCSV(logs, "supervisor-logs")}>
            <Download className="h-3.5 w-3.5 mr-1.5" />CSV
          </Button>
        </div>

        {logsLoading ? <LoadingSpinner /> : (
          <>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead><TableHead>Usuario</TableHead>
                    <TableHead>Veredicto</TableHead><TableHead>Score</TableHead>
                    <TableHead>Reintentos</TableHead><TableHead>Latencia</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <React.Fragment key={l.id}>
                      <TableRow className={expandedLog === l.id ? "bg-muted/50" : ""}>
                        <TableCell className="text-xs">
                          {new Date(l.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{l.user_name}</TableCell>
                        <TableCell>{verdictBadge(l.verdict)}</TableCell>
                        <TableCell className="text-xs font-mono">{l.score ?? "—"}</TableCell>
                        <TableCell className="text-xs">{l.retry_count}</TableCell>
                        <TableCell className="text-xs">{l.latency_ms ? `${l.latency_ms}ms` : "—"}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => setExpandedLog(expandedLog === l.id ? null : l.id)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandedLog === l.id && (
                        <TableRow>
                          <TableCell colSpan={7} className="p-4 bg-muted/30">
                            <div className="space-y-3 text-xs">
                              <div>
                                <p className="font-semibold mb-1">Mensaje del usuario:</p>
                                <p className="whitespace-pre-wrap bg-card rounded p-2 border border-border">{l.user_message.slice(0, 500)}</p>
                              </div>
                              <div>
                                <p className="font-semibold mb-1">Respuesta de Alan:</p>
                                <p className="whitespace-pre-wrap bg-card rounded p-2 border border-border max-h-40 overflow-y-auto">{l.alan_response.slice(0, 1000)}</p>
                              </div>
                              {l.rejection_reason && (
                                <div>
                                  <p className="font-semibold mb-1 text-rose-600">Motivo de rechazo:</p>
                                  <p className="bg-rose-500/10 rounded p-2 border border-rose-500/20">{l.rejection_reason}</p>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

/* ==================== REPORTS PANEL ==================== */
interface UserReport {
  user_id: string; full_name: string; messages: number; conversations: number;
  clients: number; favorites: number; lastActivity: string | null;
  avgMessagesPerConv: number; clientsByStatus: Record<string, number>;
}

interface EngagementData {
  daily: { date: string; messages: number; activeUsers: number }[];
  avgConvLength: number; totalActiveUsers: number;
  totalMessages: number; totalConversations: number;
}

const PIE_COLORS = ["hsl(0, 84%, 60%)", "hsl(38, 92%, 50%)", "hsl(210, 70%, 55%)"];

function ReportsPanel({ pin }: { pin: string }) {
  const [userReports, setUserReports] = useState<UserReport[]>([]);
  const [clientDistribution, setClientDistribution] = useState<Record<string, number>>({});
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [supervisorStats, setSupervisorStats] = useState<SupervisorStats | null>(null);
  const [loading, setLoading] = useState(true);

  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [ur, eng, sup] = await Promise.all([
          adminFetch(pin, "user-reports"),
          adminFetch(pin, "engagement-report"),
          adminFetch(pin, "supervisor-stats"),
        ]);
        setUserReports(ur.users ?? []);
        setClientDistribution(ur.clientDistribution ?? {});
        setEngagement(eng);
        setSupervisorStats(sup);
      } catch {}
      setLoading(false);
    })();
  }, [pin]);

  const exportPDF = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const element = reportRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentWidth = pdfWidth - margin * 2;

      // Title
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text("Reporte de Uso y Engagement — DoctaBot", margin, 18);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Generado: ${new Date().toLocaleString("es-AR")}`, margin, 24);
      pdf.line(margin, 26, pdfWidth - margin, 26);

      const titleOffset = 30;
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = contentWidth / imgWidth;
      const scaledHeight = imgHeight * ratio;

      // Multi-page support
      let yPosition = 0;
      const availableHeight = pdfHeight - titleOffset - margin;
      let pageNum = 0;

      while (yPosition < scaledHeight) {
        if (pageNum > 0) {
          pdf.addPage();
        }

        const sourceY = yPosition / ratio;
        const sourceH = Math.min((availableHeight) / ratio, imgHeight - sourceY);
        const destH = sourceH * ratio;

        // Create a cropped canvas for this page
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = imgWidth;
        pageCanvas.height = sourceH;
        const ctx = pageCanvas.getContext("2d")!;
        ctx.drawImage(canvas, 0, sourceY, imgWidth, sourceH, 0, 0, imgWidth, sourceH);

        const pageImgData = pageCanvas.toDataURL("image/png");
        pdf.addImage(pageImgData, "PNG", margin, pageNum === 0 ? titleOffset : margin, contentWidth, destH);

        yPosition += availableHeight;
        pageNum++;
      }

      pdf.save(`reporte-doctabot-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("Error exporting PDF:", err);
    }
    setExporting(false);
  };

  if (loading) return <LoadingSpinner />;

  const approvalRate = supervisorStats && supervisorStats.total > 0
    ? Math.round((supervisorStats.approved / supervisorStats.total) * 100) : 0;

  const statusLabel: Record<string, string> = { hot: "🔥 Caliente", warm: "🌡️ Tibio", cold: "❄️ Frío" };
  const statusColor: Record<string, string> = { hot: "text-red-500", warm: "text-amber-500", cold: "text-blue-500" };

  const pieData = Object.entries(clientDistribution).map(([key, value]) => ({
    name: statusLabel[key] ?? key, value,
  }));

  const csvUserData = userReports.map(u => ({
    Nombre: u.full_name, Mensajes: u.messages, Conversaciones: u.conversations,
    Clientes: u.clients, Favoritos: u.favorites, "Promedio msg/conv": u.avgMessagesPerConv,
    "Última actividad": u.lastActivity ? new Date(u.lastActivity).toLocaleDateString("es-AR") : "—",
  }));

  return (
    <div className="mt-4 space-y-6">
      {/* Export Button */}
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={exportPDF} disabled={exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileDown className="h-3.5 w-3.5 mr-1.5" />}
          {exporting ? "Generando PDF..." : "Exportar PDF"}
        </Button>
      </div>

      <div ref={reportRef} className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
          <span className="text-xs text-muted-foreground">Usuarios activos (30d)</span>
          <p className="text-2xl font-bold">{engagement?.totalActiveUsers ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
          <span className="text-xs text-muted-foreground">Mensajes (30d)</span>
          <p className="text-2xl font-bold">{engagement?.totalMessages?.toLocaleString("es-AR") ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
          <span className="text-xs text-muted-foreground">Tasa aprobación</span>
          <p className="text-2xl font-bold text-emerald-600">{approvalRate}%</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
          <span className="text-xs text-muted-foreground">Score promedio</span>
          <p className="text-2xl font-bold">{supervisorStats?.avgScore ?? 0}/10</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-1 shadow-sm">
          <span className="text-xs text-muted-foreground">Prom. msg/conv</span>
          <p className="text-2xl font-bold">{engagement?.avgConvLength ?? 0}</p>
        </div>
      </div>

      {/* Engagement Chart */}
      {engagement && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Engagement (últimos 30 días)</h2>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={engagement.daily}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="messages" fill="url(#barGradient)" name="Mensajes" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="activeUsers" stroke="hsl(var(--chart-3))" strokeWidth={2} name="Usuarios activos" dot={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Client Distribution + Supervisor Summary side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Client Distribution */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <h2 className="text-sm font-semibold">Distribución de clientes</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={35}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {Object.entries(clientDistribution).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <span className={statusColor[key] ?? "text-muted-foreground"}>
                    {statusLabel[key] ?? key}
                  </span>
                  <span className="font-bold">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Supervisor Summary */}
        {supervisorStats && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
            <h2 className="text-sm font-semibold">Calidad del Agente IA</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">{approvalRate}%</div>
                <div className="text-xs text-muted-foreground">Aprobación</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{supervisorStats.avgScore}/10</div>
                <div className="text-xs text-muted-foreground">Score</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{supervisorStats.total.toLocaleString("es-AR")}</div>
                <div className="text-xs text-muted-foreground">Evaluaciones</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-600">{supervisorStats.errors}</div>
                <div className="text-xs text-muted-foreground">Errores</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* User Usage Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Uso por usuario</h2>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead className="text-right">Mensajes</TableHead>
                <TableHead className="text-right">Conversaciones</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
                <TableHead className="text-right">Favoritos</TableHead>
                <TableHead className="text-right">Prom. msg/conv</TableHead>
                <TableHead>Última actividad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {userReports.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell className="text-xs font-medium">{u.full_name}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{u.messages.toLocaleString("es-AR")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{u.conversations}</TableCell>
                  <TableCell className="text-xs text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="font-mono">{u.clients}</span>
                      {u.clientsByStatus.hot ? <Flame className="h-3 w-3 text-red-500" /> : null}
                      {u.clientsByStatus.warm ? <Thermometer className="h-3 w-3 text-amber-500" /> : null}
                      {u.clientsByStatus.cold ? <Snowflake className="h-3 w-3 text-blue-500" /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">{u.favorites}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{u.avgMessagesPerConv}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.lastActivity ? new Date(u.lastActivity).toLocaleDateString("es-AR") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      </div>
    </div>
  );
}

/* ==================== SHARED ==================== */
function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2">
      <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
      <Button variant="ghost" size="icon" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default SuperAdmin;
