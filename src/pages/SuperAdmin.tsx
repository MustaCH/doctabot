import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Shield, Database, Users, Heart, MessageSquare, Home,
  RefreshCw, Search, ChevronLeft, ChevronRight, Loader2,
} from "lucide-react";

const ADMIN_PIN = "7742";

interface PlatformStats {
  properties: number;
  users: number;
  conversations: number;
  messages: number;
  favorites: number;
  clients: number;
}

interface PropertyRow {
  id: string;
  title: string | null;
  operation: string | null;
  price: number | null;
  currency: string | null;
  zone: string | null;
  property_type: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string;
  agent_code: string;
  created_at: string;
}

interface ConversationRow {
  id: string;
  title: string;
  user_id: string;
  conversation_type: string | null;
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE = 25;

const SuperAdmin = () => {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  const handlePin = () => {
    if (pin === ADMIN_PIN) {
      setAuthed(true);
      setPinError(false);
    } else {
      setPinError(true);
    }
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
            type="password"
            placeholder="PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handlePin()}
            className={pinError ? "border-destructive" : ""}
            autoFocus
          />
          {pinError && <p className="text-xs text-destructive text-center">PIN incorrecto</p>}
          <Button className="w-full" onClick={handlePin}>Acceder</Button>
        </div>
      </div>
    );
  }

  return <AdminDashboard />;
};

function AdminDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  const loadStats = useCallback(async () => {
    setLoading(true);
    const [props, profiles, convs, msgs, favs, clients] = await Promise.all([
      supabase.from("properties").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("conversations").select("id", { count: "exact", head: true }),
      supabase.from("messages").select("id", { count: "exact", head: true }),
      supabase.from("favorites").select("id", { count: "exact", head: true }),
      supabase.from("clients").select("id", { count: "exact", head: true }),
    ]);
    setStats({
      properties: props.count ?? 0,
      users: profiles.count ?? 0,
      conversations: convs.count ?? 0,
      messages: msgs.count ?? 0,
      favorites: favs.count ?? 0,
      clients: clients.count ?? 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const statCards = stats
    ? [
        { label: "Propiedades", value: stats.properties, icon: Home, color: "text-blue-500" },
        { label: "Usuarios", value: stats.users, icon: Users, color: "text-emerald-500" },
        { label: "Conversaciones", value: stats.conversations, icon: MessageSquare, color: "text-violet-500" },
        { label: "Mensajes", value: stats.messages, icon: MessageSquare, color: "text-amber-500" },
        { label: "Favoritos", value: stats.favorites, icon: Heart, color: "text-rose-500" },
        { label: "Clientes", value: stats.clients, icon: Users, color: "text-cyan-500" },
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
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="properties">Propiedades</TabsTrigger>
            <TabsTrigger value="users">Usuarios</TabsTrigger>
            <TabsTrigger value="conversations">Conversaciones</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {loading ? (
              <LoadingSpinner />
            ) : (
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
            <ScrapingStatus />
          </TabsContent>

          <TabsContent value="properties">
            <PropertiesTable />
          </TabsContent>

          <TabsContent value="users">
            <UsersTable />
          </TabsContent>

          <TabsContent value="conversations">
            <ConversationsTable />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ScrapingStatus() {
  const [lastProperty, setLastProperty] = useState<{ created_at: string; updated_at: string } | null>(null);
  const [totalToday, setTotalToday] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data: latest } = await supabase
        .from("properties")
        .select("created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();
      setLastProperty(latest);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", todayStart.toISOString());
      setTotalToday(count ?? 0);
    };
    load();
  }, []);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Estado del Scraping</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Última actualización:</span>{" "}
          <span className="font-medium">{lastProperty ? fmt(lastProperty.updated_at) : "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Propiedades actualizadas hoy:</span>{" "}
          <span className="font-medium">{totalToday.toLocaleString("es-AR")}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">El scraping se ejecuta diariamente a las 00:30hs de forma automática.</p>
    </div>
  );
}

function PropertiesTable() {
  const [data, setData] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("properties")
      .select("id, title, operation, price, currency, zone, property_type, address, created_at, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (search.trim()) {
      query = query.or(`title.ilike.%${search}%,address.ilike.%${search}%,zone.ilike.%${search}%`);
    }

    const { data: rows, count } = await query;
    setData(rows ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por título, dirección o zona..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="max-w-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString("es-AR")} resultados</span>
      </div>
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Operación</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Zona</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Actualizado</TableHead>
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

function UsersTable() {
  const [data, setData] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: rows } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, agent_code, created_at")
        .order("created_at", { ascending: false });
      setData(rows ?? []);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="mt-4">
      {loading ? <LoadingSpinner /> : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Código Agente</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Registrado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="text-xs font-medium">{u.full_name}</TableCell>
                  <TableCell className="text-xs">{u.agent_code}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{u.user_id.slice(0, 8)}...</TableCell>
                  <TableCell className="text-xs">{new Date(u.created_at).toLocaleDateString("es-AR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ConversationsTable() {
  const [data, setData] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: rows, count } = await supabase
        .from("conversations")
        .select("id, title, user_id, conversation_type, created_at, updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      setData(rows ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    };
    load();
  }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4 space-y-3">
      <span className="text-xs text-muted-foreground">{total.toLocaleString("es-AR")} conversaciones</span>
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Última actividad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-[200px] truncate text-xs">{c.title}</TableCell>
                    <TableCell className="text-xs">{c.conversation_type ?? "general"}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{c.user_id.slice(0, 8)}...</TableCell>
                    <TableCell className="text-xs">{new Date(c.updated_at).toLocaleDateString("es-AR")}</TableCell>
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

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2">
      <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs text-muted-foreground">
        {page + 1} / {totalPages}
      </span>
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
