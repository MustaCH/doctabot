import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, Heart, Users, MessageSquare, TrendingUp, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Metrics {
  totalProperties: number;
  totalClients: number;
  totalFavorites: number;
  totalConversations: number;
  recentConversations: { id: string; title: string; updated_at: string }[];
}

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [propsRes, clientsRes, favsRes, convsRes] = await Promise.all([
        supabase.from("properties").select("id", { count: "exact", head: true }),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("favorites").select("id", { count: "exact", head: true }),
        supabase
          .from("conversations")
          .select("id, title, updated_at")
          .order("updated_at", { ascending: false })
          .limit(5),
      ]);
      setMetrics({
        totalProperties: propsRes.count ?? 0,
        totalClients: clientsRes.count ?? 0,
        totalFavorites: favsRes.count ?? 0,
        totalConversations: convsRes.data?.length ?? 0,
        recentConversations: convsRes.data ?? [],
      });
      setLoading(false);
    };
    load();
  }, [user]);

  const cards = metrics
    ? [
        { label: "Propiedades disponibles", value: metrics.totalProperties, icon: Search, color: "text-blue-500" },
        { label: "Clientes registrados", value: metrics.totalClients, icon: Users, color: "text-emerald-500" },
        { label: "Favoritos guardados", value: metrics.totalFavorites, icon: Heart, color: "text-rose-500" },
        { label: "Conversaciones", value: metrics.totalConversations, icon: MessageSquare, color: "text-violet-500" },
      ]
    : [];

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `hace ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `hace ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `hace ${diffD}d`;
    return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gradient-to-br from-primary/10 via-background to-accent/5">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 safe-top">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Metric cards */}
            <div className="grid grid-cols-2 gap-3">
              {cards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-border bg-card p-4 space-y-2 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <card.icon className={`h-4.5 w-4.5 ${card.color}`} />
                    <span className="text-xs text-muted-foreground">{card.label}</span>
                  </div>
                  <p className="text-2xl font-bold tracking-tight">{card.value.toLocaleString("es-AR")}</p>
                </div>
              ))}
            </div>

            {/* Recent conversations */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Conversaciones recientes</h2>
              </div>
              {metrics!.recentConversations.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Sin conversaciones aún</p>
              ) : (
                <div className="space-y-1.5">
                  {metrics!.recentConversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => navigate("/")}
                      className="w-full flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50 active:scale-[0.99]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{conv.title}</p>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">
                        {formatDate(conv.updated_at)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick summary */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2 shadow-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Resumen</h2>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Tenés <span className="font-semibold text-foreground">{metrics!.totalProperties.toLocaleString("es-AR")}</span> propiedades para ofrecer,{" "}
                <span className="font-semibold text-foreground">{metrics!.totalClients}</span> clientes registrados y{" "}
                <span className="font-semibold text-foreground">{metrics!.totalFavorites}</span> propiedades en favoritos.
                ¡Seguí así! 🚀
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
