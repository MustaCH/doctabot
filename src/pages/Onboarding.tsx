import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import alanAvatar from "@/assets/alan-avatar.png";
import { toast } from "sonner";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Monitor, Smartphone, Tablet, ChevronRight, ArrowLeft, KeyRound, CalendarCheck } from "lucide-react";

type Device = "iphone" | "android" | "desktop" | null;

const installInstructions: Record<Exclude<Device, null>, { title: string; steps: string[] }> = {
  iphone: {
    title: "iPhone / iPad (Safari)",
    steps: [
      "Abrí esta página en Safari.",
      "Tocá el ícono de compartir ⬆️ en la barra inferior.",
      "Desplazate hacia abajo y seleccioná \"Agregar a pantalla de inicio\".",
      "Confirmá tocando \"Agregar\".",
      "¡Listo! La app aparecerá como un ícono en tu pantalla.",
    ],
  },
  android: {
    title: "Android (Chrome)",
    steps: [
      "Abrí esta página en Chrome.",
      "Tocá el menú ⋮ en la esquina superior derecha.",
      "Seleccioná \"Instalar aplicación\" o \"Agregar a pantalla de inicio\".",
      "Confirmá la instalación.",
      "¡Listo! La app aparecerá como un ícono en tu pantalla.",
    ],
  },
  desktop: {
    title: "PC / Mac (Chrome o Edge)",
    steps: [
      "Abrí esta página en Chrome o Edge.",
      "Buscá el ícono de instalación en la barra de direcciones (⊕) o andá al menú.",
      "Seleccioná \"Instalar Alan\".",
      "¡Listo! La app se abrirá como una ventana independiente.",
    ],
  },
};

const SUPABASE_FUNCTIONS_URL = "https://pulaeosldsfcgyotolxa.supabase.co/functions/v1";

const Onboarding = () => {
  const { user, hasProfile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => {
    // If user already has profile (returning from OAuth), jump to step 3
    return 1;
  });
  const [inviteCode, setInviteCode] = useState("");
  // Normaliza agresivamente: mayúsculas y solo A-Z 0-9 (elimina espacios, invisibles, comillas, guiones)
  const normalizeCode = (raw: string) =>
    raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normalizedPreview = normalizeCode(inviteCode);
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name ?? "");
  const [agentCode, setAgentCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // On mount: if user already has profile (returned from OAuth redirect), skip to step 3
  useEffect(() => {
    if (hasProfile) {
      const calendarParam = searchParams.get("calendar");
      if (calendarParam === "connected") {
        toast.success("Google Calendar conectado correctamente ✅");
        setSearchParams({}, { replace: true });
        setStep(4);
      } else if (calendarParam === "error") {
        toast.error("Error al conectar Google Calendar. Intentá de nuevo.");
        setSearchParams({}, { replace: true });
        setStep(3);
      } else {
        setStep(3);
      }
    }
  }, [hasProfile]);

  // Step 1: validate invitation code
  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inviteCode.trim();
    if (!trimmed) {
      toast.error("Ingresá el código de invitación");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("validate_invitation_code", { input_code: trimmed });
    setLoading(false);
    if (error || !data) {
      toast.error("Código de invitación inválido. Consultá con tu broker.");
      return;
    }
    setStep(2);
  };

  // Step 2: save profile
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !agentCode.trim()) {
      toast.error("Completá todos los campos");
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("profiles").insert({
      user_id: user!.id,
      full_name: fullName.trim(),
      agent_code: agentCode.trim(),
    });
    if (error) {
      toast.error("Error al guardar el perfil. Intentá de nuevo.");
      setLoading(false);
      return;
    }
    setLoading(false);
    setStep(3);
  };

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
        body: JSON.stringify({ returnUrl: window.location.origin + "/onboarding" }),
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

  const handleFinish = async () => {
    localStorage.setItem("alan_onboarding_done", "true");
    await refreshProfile();
    navigate("/");
  };

  const deviceOptions: { key: Exclude<Device, null>; label: string; icon: React.ReactNode }[] = [
    { key: "iphone", label: "iPhone / iPad", icon: <Smartphone className="h-5 w-5" /> },
    { key: "android", label: "Android", icon: <Tablet className="h-5 w-5" /> },
    { key: "desktop", label: "PC / Mac", icon: <Monitor className="h-5 w-5" /> },
  ];

  const stepTitles: Record<1 | 2 | 3 | 4, string> = {
    1: "Código de acceso 🔑",
    2: "¡Bienvenido! 👋",
    3: "Google Calendar 📅",
    4: "Instalá la app 📲",
  };
  const stepSubtitles: Record<1 | 2 | 3 | 4, string> = {
    1: "Esta plataforma es exclusiva para agentes de RE/MAX Docta. Ingresá el código que te dio tu broker.",
    2: "Completá tus datos para comenzar a usar el asistente.",
    3: "Conectá tu calendario para que Alan pueda crear eventos y recordatorios automáticamente.",
    4: "Elegí tu dispositivo para ver cómo instalar Alan.",
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/5 px-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="space-y-3 text-center">
          <img src={alanAvatar} alt="Alan" className="mx-auto h-16 w-16" />
          <h1 className="text-2xl font-bold tracking-tight">{stepTitles[step]}</h1>
          <p className="text-sm text-muted-foreground">{stepSubtitles[step]}</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          {([1, 2, 3, 4] as const).map((s) => (
            <div key={s} className={`h-2 w-8 rounded-full transition-colors ${step >= s ? "bg-primary" : "bg-primary/30"}`} />
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inviteCode">Código de invitación</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Ej: DOCTA1"
                  maxLength={10}
                  className="pl-9 tracking-widest font-mono uppercase"
                  autoComplete="off"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Si no tenés un código, contactá a tu broker.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verificando..." : "Verificar código"}
              {!loading && <ChevronRight className="ml-1 h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs text-muted-foreground"
              onClick={() => signOut()}
            >
              Cerrar sesión
            </Button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleProfileSubmit} className="space-y-4">
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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Guardando..." : "Siguiente"}
              {!loading && <ChevronRight className="ml-1 h-4 w-4" />}
            </Button>
          </form>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Conectar calendario</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Al conectar tu Google Calendar, Alan podrá crear recordatorios y eventos de seguimiento automáticamente cuando lo necesites.
              </p>
              <Button
                type="button"
                className="w-full"
                onClick={handleConnectCalendar}
                disabled={calendarLoading}
              >
                {calendarLoading ? "Redirigiendo..." : "Conectar Google Calendar"}
                {!calendarLoading && <ChevronRight className="ml-1 h-4 w-4" />}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs text-muted-foreground"
              onClick={() => setStep(4)}
            >
              Omitir por ahora
            </Button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {deviceOptions.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setSelectedDevice(d.key)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all ${
                    selectedDevice === d.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {d.icon}
                  {d.label}
                </button>
              ))}
            </div>

            {selectedDevice && (
              <div className="animate-in fade-in slide-in-from-bottom-2 rounded-lg border bg-muted/50 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {installInstructions[selectedDevice].title}
                </h3>
                <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
                  {installInstructions[selectedDevice].steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep(3)} className="text-muted-foreground">
                <ArrowLeft className="mr-1 h-4 w-4" /> Atrás
              </Button>
              <Button onClick={handleFinish} className="flex-1">
                Comenzar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
