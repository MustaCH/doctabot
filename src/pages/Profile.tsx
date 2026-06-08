import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, LogOut, Building2, Users, CalendarCheck, CalendarX, Loader2, Mail, AlertTriangle, BarChart3, RefreshCw, Newspaper, Bell, BellOff } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import alanAvatar from "@/assets/alan-avatar.png";
import { useSwUpdate } from "@/hooks/use-sw-update";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Switch } from "@/components/ui/switch";

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
  const { enabled: pushEnabled, loading: pushLoading, supported: pushSupported, capability: pushCapability, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications();

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
            Contactos
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

        {/* Google connection - compact, not in grid */}
        <div className="md:max-w-sm">
          {/* Google Calendar */}
          <div className="rounded-lg border bg-card p-3">
            {calendarConnected ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <svg className="h-5 w-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    <span className="text-xs text-muted-foreground">Calendar + Gmail</span>
                    <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-destructive hover:text-destructive h-7 px-2 ml-auto"
                    onClick={handleDisconnectCalendar}
                    disabled={calendarLoading}
                  >
                    {calendarLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Desconectar"}
                  </Button>
                </div>
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
        </div>

        {/* Push Notifications */}
        <div className="md:max-w-sm">
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {pushEnabled ? (
                  <Bell className="h-4 w-4 text-primary" />
                ) : (
                  <BellOff className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">Notificaciones</span>
              </div>
              <div className="flex items-center gap-2">
                {pushLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                <Switch
                  checked={pushEnabled}
                  disabled={pushLoading || !pushSupported}
                  onCheckedChange={(checked) => {
                    if (checked) pushSubscribe();
                    else pushUnsubscribe();
                  }}
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {pushCapability.status === "ios-needs-install" ? (
                <>Para recibir notificaciones en iPhone, agregá Alan a la pantalla de inicio (Compartir → "Agregar a inicio") y abrilo desde ahí.</>
              ) : pushCapability.status === "ios-too-old" ? (
                <>Tu iPhone tiene iOS {pushCapability.iosVersion ?? "desconocido"}. Las notificaciones web requieren iOS 16.4 o superior.</>
              ) : pushCapability.status === "unsupported" ? (
                <>Este navegador no soporta notificaciones push.</>
              ) : pushEnabled ? (
                "Recibirás notificaciones cuando Alan responda."
              ) : (
                "Activá para recibir notificaciones de Alan."
              )}
            </p>
          </div>
        </div>


        {/* Profile fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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

        <p className="text-center text-[11px] text-muted-foreground">v1.8.7</p>
      </form>
    </div>
  );
};

export default Profile;
