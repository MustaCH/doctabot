import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, LogOut, Building2, Users, CalendarCheck, CalendarX, Loader2, Mail, AlertTriangle, BarChart3, RefreshCw, Newspaper } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import alanAvatar from "@/assets/alan-avatar.png";
import { useSwUpdate } from "@/hooks/use-sw-update";

const SUPABASE_FUNCTIONS_URL = "https://pulaeosldsfcgyotolxa.supabase.co/functions/v1";

const Profile = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [agentCode, setAgentCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [hasGmailScope, setHasGmailScope] = useState(true);
  const { updateAvailable, applyUpdate } = useSwUpdate();
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      const [profileRes, calendarRes] = await Promise.all([
        supabase.from("profiles").select("full_name, agent_code").eq("user_id", user.id).maybeSingle(),
        supabase.from("google_calendar_tokens").select("id, scope").eq("user_id", user.id).maybeSingle(),
      ]);
      if (profileRes.data) {
        setFullName(profileRes.data.full_name);
        setAgentCode(profileRes.data.agent_code);
      }
      setCalendarConnected(!!calendarRes.data);
      if (calendarRes.data) {
        const scope = calendarRes.data.scope ?? "";
        setHasGmailScope(scope.includes("gmail.send"));
      }
      setLoading(false);
    };
    loadProfile();
  }, [user]);

  // Handle redirect back from Google OAuth
  useEffect(() => {
    const calendarParam = searchParams.get("calendar");
    if (calendarParam === "connected") {
      setCalendarConnected(true);
      // Re-fetch to check new scopes
      if (user) {
        supabase.from("google_calendar_tokens").select("scope").eq("user_id", user.id).maybeSingle().then(({ data }) => {
          if (data) setHasGmailScope((data.scope ?? "").includes("gmail.send"));
        });
      }
      toast.success("Google Calendar conectado correctamente ✅");
      navigate("/profile", { replace: true });
    } else if (calendarParam === "error") {
      toast.error("Error al conectar Google Calendar. Intentá de nuevo.");
      navigate("/profile", { replace: true });
    }
  }, [searchParams, navigate]);

  const handleConnectCalendar = async () => {
    if (!user) return;
    setCalendarLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/google-calendar-auth?action=init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ returnUrl: window.location.origin + "/profile" }),
      });
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
      } else {
        toast.error("No se pudo iniciar la conexión.");
        setCalendarLoading(false);
      }
    } catch {
      toast.error("Error al conectar. Intentá de nuevo.");
      setCalendarLoading(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!user) return;
    setCalendarLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/google-calendar-auth`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setCalendarConnected(false);
        toast.success("Google Calendar desconectado");
      } else {
        toast.error("Error al desconectar.");
      }
    } catch {
      toast.error("Error al desconectar. Intentá de nuevo.");
    }
    setCalendarLoading(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !agentCode.trim()) {
      toast.error("Completá todos los campos");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        agent_code: agentCode.trim(),
      })
      .eq("user_id", user!.id);
    setSaving(false);
    if (error) {
      toast.error("Error al guardar. Intentá de nuevo.");
      return;
    }
    toast.success("Perfil actualizado");
    navigate("/");
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center bg-gradient-to-br from-primary/10 via-background to-accent/5 px-4 py-6 md:px-12 md:py-10">
      <form onSubmit={handleSave} className="w-full max-w-sm md:max-w-3xl lg:max-w-5xl space-y-6 md:space-y-8">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Mi perfil</h1>
        </div>

        {/* Avatar & email */}
        <div className="flex items-center gap-3 md:gap-4">
          <img
            src={user?.user_metadata?.avatar_url || alanAvatar}
            alt="Avatar"
            className="h-12 w-12 md:h-16 md:w-16 rounded-full"
          />
          <div className="min-w-0">
            <p className="truncate text-sm md:text-base font-medium">{user?.user_metadata?.full_name || user?.email}</p>
            <p className="truncate text-xs md:text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        {updateAvailable && (
          <Button
            type="button"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={async () => {
              setUpdating(true);
              await applyUpdate();
            }}
            disabled={updating}
          >
            {updating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {updating ? "Actualizando..." : "🆕 Nueva versión disponible — Actualizar"}
          </Button>
        )}

        {/* Navigation grid - 2 cols on mobile, 4 cols on desktop */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate("/properties")}
          >
            <Building2 className="mr-2 h-4 w-4 text-primary" />
            Propiedades
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate("/clients")}
          >
            <Users className="mr-2 h-4 w-4 text-primary" />
            Clientes
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate("/dashboard")}
          >
            <BarChart3 className="mr-2 h-4 w-4 text-primary" />
            Dashboard
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate("/changelog")}
          >
            <Newspaper className="mr-2 h-4 w-4 text-primary" />
            Novedades
          </Button>
        </div>

        {/* Two-column layout on desktop for calendar + form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* Google Calendar */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Google Workspace</p>
              {calendarConnected && (
                <span className="text-xs text-green-600 font-medium">Conectado ✅</span>
              )}
            </div>
            {calendarConnected ? (
              <div className="space-y-2">
                {!hasGmailScope && (
                  <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 shrink-0" />
                    <p className="text-xs text-muted-foreground flex-1">Faltan permisos de Gmail</p>
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-xs shrink-0"
                      onClick={handleConnectCalendar}
                      disabled={calendarLoading}
                    >
                      {calendarLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reconectar"}
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive h-7 px-2"
                  onClick={handleDisconnectCalendar}
                  disabled={calendarLoading}
                >
                  {calendarLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarX className="h-3 w-3 mr-1" />}
                  Desconectar
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs h-8"
                onClick={handleConnectCalendar}
                disabled={calendarLoading}
              >
                {calendarLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <CalendarCheck className="h-3 w-3 mr-1" />
                )}
                Conectar con Google
              </Button>
            )}
          </div>

          {/* Profile fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej: Juan Pérez"
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agentCode">Código de asociado</Label>
              <Input
                id="agentCode"
                value={agentCode}
                onChange={(e) => setAgentCode(e.target.value)}
                placeholder="Ej: 420401222"
                maxLength={20}
                required
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <Button type="submit" className="w-full md:w-auto md:min-w-[200px]" disabled={saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full md:w-auto text-destructive hover:text-destructive"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">v1.4.0</p>
      </form>
    </div>
  );
};

export default Profile;
