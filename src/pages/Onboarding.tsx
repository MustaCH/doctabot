import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import alanAvatar from "@/assets/alan-avatar.png";
import { toast } from "sonner";
import { Monitor, Smartphone, Tablet, ChevronRight, ArrowLeft } from "lucide-react";

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

const Onboarding = () => {
  const { user, refreshProfile } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name ?? "");
  const [agentCode, setAgentCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device>(null);

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
    setStep(2);
  };

  const handleFinish = async () => {
    await refreshProfile();
  };

  const deviceOptions: { key: Exclude<Device, null>; label: string; icon: React.ReactNode }[] = [
    { key: "iphone", label: "iPhone / iPad", icon: <Smartphone className="h-5 w-5" /> },
    { key: "android", label: "Android", icon: <Tablet className="h-5 w-5" /> },
    { key: "desktop", label: "PC / Mac", icon: <Monitor className="h-5 w-5" /> },
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/5 px-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="space-y-3 text-center">
          <img src={alanAvatar} alt="Alan" className="mx-auto h-16 w-16" />
          <h1 className="text-2xl font-bold tracking-tight">
            {step === 1 ? "¡Bienvenido! 👋" : "Instalá la app 📲"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {step === 1
              ? "Completá tus datos para comenzar a usar el asistente."
              : "Elegí tu dispositivo para ver cómo instalar Alan."}
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          <div className={`h-2 w-8 rounded-full transition-colors ${step === 1 ? "bg-primary" : "bg-primary/30"}`} />
          <div className={`h-2 w-8 rounded-full transition-colors ${step === 2 ? "bg-primary" : "bg-primary/30"}`} />
        </div>

        {step === 1 ? (
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
        ) : (
          <div className="space-y-4">
            {/* Device selector */}
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

            {/* Instructions */}
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
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="text-muted-foreground">
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
