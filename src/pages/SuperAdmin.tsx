import React, { useEffect, useState, useCallback } from "react";
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
  BarChart3, Flame, Thermometer, Snowflake,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";

const ADMIN_PIN = "7742";
const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-stats`;

async function adminFetch(pin: string, action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  agent_code: string; created_at: string;
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
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  const handlePin = () => {
    if (pin === ADMIN_PIN) { setAuthed(true); setPinError(false); }
    else setPinError(true);
  };

  if (!authed) {
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
          />
          {pinError && <p className="text-xs text-destructive text-center">PIN incorrecto</p>}
          <Button className="w-full" onClick={handlePin}>Acceder</Button>
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
                    <TableCell className="text-xs font-medium">{u.full_name}</TableCell>
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
