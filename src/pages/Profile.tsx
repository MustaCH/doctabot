import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  LogOut,
  Building2,
  Users,
  Loader2,
  AlertTriangle,
  BarChart3,
  RefreshCw,
  Newspaper,
  Bell,
  BellOff,
  Smartphone,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useSwUpdate } from "@/hooks/use-sw-update";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Switch } from "@/components/ui/switch";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS, AVATAR_TINTS } from "@/lib/contact-avatar";

const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const APP_VERSION = "1.8.7";

/* Estilos compartidos del rediseño (Carbón & Vidrio) */
const GLASS_CARD = "rounded-[16px] border border-white/[0.09] bg-white/5";
const GRADIENT_PRIMARY = "bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-white";
const INPUT_GLASS =
  "h-[46px] rounded-[14px] border-white/[0.09] bg-white/[0.04] px-[15px] text-[15px] md:text-[15px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-[rgba(91,147,255,0.45)] focus-visible:ring-[3px] focus-visible:ring-[rgba(91,147,255,0.12)] focus-visible:ring-offset-0";

const GoogleLogo = () => (
  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const NAV_TILES = [
  { to: "/properties", label: "Propiedades", Icon: Building2 },
  { to: "/clients", label: "Contactos", Icon: Users },
  { to: "/dashboard", label: "Control", Icon: BarChart3 },
  { to: "/changelog", label: "Novedades", Icon: Newspaper },
] as const;

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
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  /* Identidad: foto de Google si hay; si no, iniciales con el gradiente de AVATAR_COLORS. */
  const displayName: string = user?.user_metadata?.full_name || fullName || user?.email || "";
  const avatarUrl: string | undefined = user?.user_metadata?.avatar_url;
  const avatarIdx = getAvatarColorIndex(displayName);
  const tintRgb = avatarUrl ? "91,147,255" : AVATAR_TINTS[avatarIdx];

  /* Google: chip de estado */
  const googleStatus: "connected" | "missing-scope" | "disconnected" = !calendarConnected
    ? "disconnected"
    : hasGmailScope
      ? "connected"
      : "missing-scope";
  const googleChip = {
    connected: { label: "Conectado", cls: "border-[rgba(62,201,138,0.30)] bg-[rgba(62,201,138,0.14)] text-[#3EC98A]", dot: "bg-[#3EC98A]" },
    "missing-scope": { label: "Falta un permiso", cls: "border-[rgba(245,178,63,0.30)] bg-[rgba(245,178,63,0.14)] text-[#F5C46E]", dot: "bg-[#F5B23F]" },
    disconnected: { label: "Sin conectar", cls: "border-white/[0.10] bg-white/[0.06] text-muted-foreground", dot: "bg-muted-foreground" },
  }[googleStatus];
  const googleSubtitle =
    googleStatus === "connected"
      ? `Calendar y Gmail · ${user?.email ?? ""}`
      : googleStatus === "missing-scope"
        ? "Calendar conectado · Gmail sin permiso de envío"
        : "Conectá Calendar y Gmail para que Alan agende y mande emails por vos";

  /* Notificaciones: texto actual tal cual; los casos iOS/unsupported van en franja azul con ícono. */
  const pushBlockedText =
    pushCapability.status === "ios-needs-install" ? (
      <>Para recibir notificaciones en iPhone, agregá Alan a la pantalla de inicio (Compartir → "Agregar a inicio") y abrilo desde ahí.</>
    ) : pushCapability.status === "ios-too-old" ? (
      <>Tu iPhone tiene iOS {pushCapability.iosVersion ?? "desconocido"}. Las notificaciones web requieren iOS 16.4 o superior.</>
    ) : pushCapability.status === "unsupported" ? (
      <>Este navegador no soporta notificaciones push.</>
    ) : null;
  const pushSubtitle =
    pushCapability.status === "ios-needs-install"
      ? "No disponibles en Safari sin instalar"
      : pushCapability.status === "ios-too-old"
        ? "Requieren iOS 16.4 o superior"
        : pushBlockedText
          ? "No disponibles en este navegador"
          : pushEnabled
            ? "Recibirás notificaciones cuando Alan responda."
            : "Activá para recibir notificaciones de Alan.";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Header estándar: flecha atrás a la izquierda, cerrar sesión a la derecha */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
        <Button type="button" variant="ghost" size="icon" className="h-11 w-11" onClick={() => navigate("/")} aria-label="Volver al chat">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="flex-1 text-base font-semibold tracking-tight">Mi perfil</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-[12px] border border-white/[0.07] bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          onClick={handleSignOut}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </Button>
      </div>

      <div className="mx-auto w-full max-w-md px-4 pb-8 pt-4 md:max-w-3xl md:px-8 md:pt-6 safe-bottom">
        <div className="grid gap-4 md:grid-cols-2 md:items-start md:gap-5">
          {/* Columna izquierda: identidad, navegación, actualización */}
          <div className="space-y-3.5">
            {/* Tarjeta de identidad */}
            <section className="relative overflow-hidden rounded-[18px] border border-white/[0.09] bg-white/5 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(ellipse 90% 80% at 18% 0%, rgba(${tintRgb},0.24) 0%, rgba(${tintRgb},0) 60%)` }}
              />
              <div className="relative flex items-center gap-3.5 px-4 py-[18px]">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-full object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_14px_32px_-14px_rgba(0,0,0,0.9)]"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-[22px] font-bold tracking-[-0.02em] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.10)] ${AVATAR_COLORS[avatarIdx]}`}
                  >
                    {getInitials(displayName)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[19px] font-bold leading-[1.15] tracking-[-0.025em]">{displayName}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{user?.email}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,90,77,0.30)] bg-[rgba(255,90,77,0.14)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--hot))]">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
                      RE/MAX Docta
                    </span>
                    {agentCode && <span className="truncate text-[11px] text-muted-foreground/80">Asociado {agentCode}</span>}
                  </div>
                </div>
              </div>
            </section>

            {/* Navegación: 4 tiles en una fila */}
            <nav aria-label="Secciones" className="grid grid-cols-4 gap-2.5">
              {NAV_TILES.map(({ to, label, Icon }) => (
                <button
                  key={to}
                  type="button"
                  onClick={() => navigate(to)}
                  className={`relative flex min-h-[64px] flex-col items-center justify-center gap-2 px-1 pb-[11px] pt-[13px] transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${GLASS_CARD}`}
                >
                  {to === "/changelog" && updateAvailable && (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full bg-[hsl(var(--orb-attention))] shadow-[0_0_0_3px_rgba(255,184,107,0.18)]"
                      />
                      <span className="sr-only">Hay novedades</span>
                    </>
                  )}
                  <Icon className="h-5 w-5 text-[hsl(var(--brand))]" strokeWidth={1.8} aria-hidden="true" />
                  <span className="whitespace-nowrap text-[11px] font-medium tracking-[-0.01em] text-foreground/90">{label}</span>
                </button>
              ))}
            </nav>

            {/* Aviso de actualización */}
            {updateAvailable && (
              <div role="status" className="flex items-center gap-3 rounded-[16px] border border-[rgba(91,147,255,0.28)] bg-[rgba(91,147,255,0.10)] py-3 pl-3.5 pr-3">
                <RefreshCw className="h-[18px] w-[18px] shrink-0 text-[hsl(var(--primary-soft-foreground))]" strokeWidth={1.8} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">Hay una versión nueva</p>
                  <p className="mt-0.5 text-[11px] text-[hsl(var(--primary-soft-foreground))]">v{APP_VERSION} → nueva versión</p>
                </div>
                <button
                  type="button"
                  className={`flex h-9 shrink-0 items-center justify-center rounded-[12px] px-3.5 text-xs font-semibold shadow-[0_8px_20px_-10px_rgba(59,123,255,0.9)] transition-opacity hover:opacity-90 disabled:opacity-60 ${GRADIENT_PRIMARY}`}
                  onClick={async () => {
                    setUpdating(true);
                    await applyUpdate();
                  }}
                  disabled={updating}
                >
                  {updating ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Actualizando" /> : "Actualizar"}
                </button>
              </div>
            )}
          </div>

          {/* Columna derecha: conexiones */}
          <section aria-label="Conexiones" className={`overflow-hidden ${GLASS_CARD}`}>
            {/* Google */}
            <div className="border-b border-white/[0.06] px-3.5 py-[13px]">
              <div className="flex items-center gap-3">
                <GoogleLogo />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-[7px]">
                    <span className="text-sm font-semibold">Google</span>
                    <span className={`inline-flex items-center gap-[5px] rounded-full border px-2 py-0.5 text-[10px] font-semibold ${googleChip.cls}`}>
                      <span className={`h-[5px] w-[5px] rounded-full ${googleChip.dot}`} aria-hidden="true" />
                      {googleChip.label}
                    </span>
                  </div>
                  <p className="mt-[3px] truncate text-[11px] text-muted-foreground">{googleSubtitle}</p>
                </div>
                {calendarConnected ? (
                  <button
                    type="button"
                    className="flex h-9 shrink-0 items-center rounded-[12px] border border-[rgba(255,90,77,0.26)] bg-[rgba(255,90,77,0.10)] px-3 text-xs font-semibold text-[hsl(var(--hot))] transition-colors hover:bg-[rgba(255,90,77,0.16)] disabled:opacity-60"
                    onClick={handleDisconnectCalendar}
                    disabled={calendarLoading}
                  >
                    {calendarLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Cargando" /> : "Desconectar"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`flex h-9 shrink-0 items-center rounded-[12px] px-3 text-xs font-semibold shadow-[0_8px_20px_-10px_rgba(59,123,255,0.9)] transition-opacity hover:opacity-90 disabled:opacity-60 ${GRADIENT_PRIMARY}`}
                    onClick={handleConnectCalendar}
                    disabled={calendarLoading}
                  >
                    {calendarLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Cargando" /> : "Conectar"}
                  </button>
                )}
              </div>
              {calendarConnected && !hasGmailScope && (
                <div className="mt-[11px] flex items-center gap-2.5 rounded-[12px] border border-[rgba(245,178,63,0.24)] bg-[rgba(245,178,63,0.08)] px-3 py-2.5">
                  <AlertTriangle className="h-[15px] w-[15px] shrink-0 text-[hsl(var(--warm-soft-foreground))]" strokeWidth={1.9} aria-hidden="true" />
                  <p className="flex-1 text-xs leading-[1.45] text-foreground/80">Alan no puede mandar emails por vos hasta que reconectes.</p>
                  <button
                    type="button"
                    className="flex h-9 shrink-0 items-center rounded-[12px] border border-[rgba(245,178,63,0.34)] bg-[rgba(245,178,63,0.16)] px-[13px] text-xs font-semibold text-[hsl(var(--warm-soft-foreground))] transition-colors hover:bg-[rgba(245,178,63,0.24)] disabled:opacity-60"
                    onClick={handleConnectCalendar}
                    disabled={calendarLoading}
                  >
                    {calendarLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Cargando" /> : "Reconectar"}
                  </button>
                </div>
              )}
            </div>

            {/* Notificaciones */}
            <div className="px-3.5 py-[13px]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {pushEnabled ? (
                    <Bell className="h-5 w-5 shrink-0 text-[hsl(var(--brand))]" strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <BellOff className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Notificaciones</p>
                    <p className="mt-[3px] text-[11px] text-muted-foreground">{pushSubtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pushLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Cargando" />}
                  {/* El label envuelve al switch para que el área táctil sea ≥44 */}
                  <label className="flex h-11 min-w-11 cursor-pointer items-center justify-end has-[:disabled]:cursor-not-allowed">
                    <span className="sr-only">Activar notificaciones</span>
                    <Switch
                      checked={pushEnabled}
                      disabled={pushLoading || !pushSupported || !!pushBlockedText}
                      onCheckedChange={(checked) => {
                        if (checked) pushSubscribe();
                        else pushUnsubscribe();
                      }}
                      className="h-[27px] w-[46px] data-[state=checked]:bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] data-[state=unchecked]:bg-white/[0.08] [&>span]:h-[21px] [&>span]:w-[21px] [&>span]:bg-white [&>span]:data-[state=checked]:translate-x-[21px] [&>span]:data-[state=unchecked]:bg-muted-foreground"
                    />
                  </label>
                </div>
              </div>
              {pushBlockedText && (
                <div className="mt-[11px] flex gap-2.5 rounded-[12px] border border-[rgba(91,147,255,0.22)] bg-[rgba(91,147,255,0.08)] px-3 py-[11px]">
                  <Smartphone className="mt-px h-4 w-4 shrink-0 text-[hsl(var(--primary-soft-foreground))]" strokeWidth={1.8} aria-hidden="true" />
                  <p className="text-xs leading-[1.5] text-foreground/80">{pushBlockedText}</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Tus datos */}
        <form onSubmit={handleSave} className={`mt-3.5 p-3.5 md:max-w-md ${GLASS_CARD}`} aria-labelledby="profile-data-title">
          <p id="profile-data-title" className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">Tus datos</p>
          <div className="space-y-[11px]">
            <div className="space-y-[7px]">
              <Label htmlFor="fullName" className="text-xs font-medium text-foreground/70">Nombre completo</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej: Juan Pérez"
                maxLength={100}
                required
                className={INPUT_GLASS}
              />
            </div>
            <div className="space-y-[7px]">
              <Label htmlFor="agentCode" className="text-xs font-medium text-foreground/70">Código de asociado</Label>
              <div className="relative">
                <Input
                  id="agentCode"
                  value={agentCode}
                  onChange={(e) => setAgentCode(e.target.value)}
                  placeholder="Ej: 420401222"
                  maxLength={20}
                  required
                  aria-describedby="agentCode-hint"
                  className={`${INPUT_GLASS} min-[380px]:pr-[168px]`}
                />
                {/* Hint: adentro del input desde 380px; debajo en pantallas más angostas para no comerle lugar al código. */}
                <span id="agentCode-hint" className="mt-1.5 block text-[11px] text-muted-foreground/80 min-[380px]:pointer-events-none min-[380px]:absolute min-[380px]:right-[15px] min-[380px]:top-1/2 min-[380px]:mt-0 min-[380px]:-translate-y-1/2">
                  va en los links que compartís
                </span>
              </div>
            </div>
          </div>
          <Button
            type="submit"
            className={`mt-3.5 h-[46px] w-full rounded-[14px] text-sm font-semibold shadow-[0_14px_30px_-14px_rgba(59,123,255,0.95)] hover:opacity-90 ${GRADIENT_PRIMARY}`}
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </form>

        <p className="mt-3.5 text-center text-[11px] text-muted-foreground/70">Alan v{APP_VERSION}</p>
      </div>
    </div>
  );
};

export default Profile;
