import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlanOrb } from "@/components/AlanOrb";
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

const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// Rediseño Carbón & Vidrio (artboard Onboarding): label 12/600 y campos de 46 con radio 14 —
// el vidrio y el foco azul ya vienen de la primitiva Input.
const LABEL_CLS = "text-xs font-semibold text-[#C3CAD5]";
const INPUT_CLS = "h-[46px] text-[15px] md:text-[15px]";

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
        toast.success("Google Calendar conectado correctamente");
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
    const normalized = normalizeCode(inviteCode);
    if (!normalized) {
      toast.error("Ingresá el código de invitación");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("validate_invitation_code_v2", { input_code: normalized });
    setLoading(false);
    if (error) {
      toast.error("Error al verificar el código. Intentá de nuevo.");
      return;
    }
    if (data === "valid") {
      setStep(2);
      return;
    }
    if (data === "inactive") {
      toast.error("Este código ya no está vigente. Pedile uno nuevo a tu broker.");
      return;
    }
    // not_found
    toast.error("Código no reconocido. Verificá que sea exactamente el que te pasó tu broker.");
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
    1: "Código de acceso",
    2: "¡Bienvenido!",
    3: "Google Calendar",
    4: "Instalá la app",
  };
  const stepSubtitles: Record<1 | 2 | 3 | 4, string> = {
    1: "Esta plataforma es exclusiva para agentes de RE/MAX Docta. Ingresá el código que te dio tu broker.",
    2: "Completá tus datos para comenzar a usar el asistente.",
    3: "Conectá tu calendario para que Alan pueda crear eventos y recordatorios automáticamente.",
    4: "Elegí tu dispositivo para ver cómo instalar Alan.",
  };

  return (
    <div
      className="flex min-h-[calc(var(--app-height,100dvh)-var(--keyboard-inset,0px))] flex-col items-center justify-center bg-background px-7 safe-top safe-bottom"
      style={{ backgroundImage: "radial-gradient(ellipse 120% 45% at 50% 12%, rgba(76,141,255,0.22) 0%, rgba(76,141,255,0) 62%), radial-gradient(ellipse 100% 40% at 20% 100%, rgba(255,90,77,0.12) 0%, rgba(255,90,77,0) 60%)" }}
    >
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="space-y-3 text-center">
          <AlanOrb size="lg" aria-label="Alan" className="mx-auto" />
          <h1 className="text-[25px] font-bold leading-[1.1] tracking-[-0.03em]">{stepTitles[step]}</h1>
          <p className="text-sm leading-[1.55] text-[#A7AEBA] [text-wrap:pretty]">{stepSubtitles[step]}</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          {([1, 2, 3, 4] as const).map((s) => (
            <div key={s} className={`h-[5px] w-[34px] rounded-full transition-colors ${step >= s ? "bg-primary" : "bg-[rgba(91,147,255,0.22)]"}`} />
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div className="space-y-[9px]">
              <Label htmlFor="inviteCode" className={LABEL_CLS}>Código de invitación</Label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Ej: RMX7K2P"
                  maxLength={20}
                  className="h-[52px] bg-white/5 pl-11 font-mono text-[17px] font-medium uppercase tracking-[0.22em] md:text-[17px]"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  required
                />
              </div>
              {normalizedPreview && normalizedPreview !== inviteCode && (
                <p className="text-xs text-muted-foreground font-mono">
                  Se enviará: <span className="font-semibold text-foreground">{normalizedPreview}</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Si no tenés un código, contactá a tu broker.
              </p>
            </div>
            <Button type="submit" className="w-full text-[15px]" disabled={loading}>
              {loading ? "Verificando..." : "Verificar código"}
              {!loading && <ChevronRight className="ml-1 h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="w-full text-[13px] text-muted-foreground"
              onClick={() => signOut()}
            >
              Cerrar sesión
            </Button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div className="space-y-[9px]">
              <Label htmlFor="fullName" className={LABEL_CLS}>Nombre completo</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej: Juan Pérez"
                maxLength={100}
                required
                className={INPUT_CLS}
              />
            </div>
            <div className="space-y-[9px]">
              <Label htmlFor="agentCode" className={LABEL_CLS}>Código de asociado</Label>
              <Input
                id="agentCode"
                value={agentCode}
                onChange={(e) => setAgentCode(e.target.value)}
                placeholder="Ej: 420401222"
                maxLength={20}
                required
                className={INPUT_CLS}
              />
            </div>
            <Button type="submit" className="w-full text-[15px]" disabled={loading}>
              {loading ? "Guardando..." : "Siguiente"}
              {!loading && <ChevronRight className="ml-1 h-4 w-4" />}
            </Button>
          </form>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-[16px] border border-white/[0.09] bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-5 w-5 text-[hsl(var(--brand))]" strokeWidth={1.8} aria-hidden="true" />
                <span className="text-sm font-medium">Conectar calendario</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Al conectar tu Google Calendar, Alan podrá crear recordatorios y eventos de seguimiento automáticamente cuando lo necesites.
              </p>
              <Button
                type="button"
                className="w-full text-[15px]"
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
              size="md"
              className="w-full text-[13px] text-muted-foreground"
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
                  aria-pressed={selectedDevice === d.key}
                  className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-[16px] border p-3 text-xs font-medium transition-colors ${
                    selectedDevice === d.key
                      ? "border-[rgba(91,147,255,0.45)] bg-[rgba(91,147,255,0.12)] text-[hsl(var(--primary-soft-foreground))]"
                      : "border-white/[0.09] bg-white/5 text-muted-foreground hover:bg-white/[0.08]"
                  }`}
                >
                  {d.icon}
                  {d.label}
                </button>
              ))}
            </div>

            {selectedDevice && (
              <div className="animate-in fade-in slide-in-from-bottom-2 space-y-3 rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4">
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
              <Button variant="ghost" size="default" onClick={() => setStep(3)} className="text-[13px] text-muted-foreground">
                <ArrowLeft className="mr-1 h-4 w-4" /> Atrás
              </Button>
              <Button onClick={handleFinish} className="flex-1 text-[15px]">
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
