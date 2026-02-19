import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import alanAvatar from "@/assets/alan-avatar.png";
import { toast } from "sonner";

const Onboarding = () => {
  const { user, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name ?? "");
  const [agentCode, setAgentCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
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
    await refreshProfile();
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/5 px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <img src={alanAvatar} alt="Alan" className="mx-auto h-16 w-16" />
          <h1 className="text-2xl font-bold tracking-tight">¡Bienvenido a Alan! 👋</h1>
          <p className="text-sm text-muted-foreground">
            Completá tus datos para comenzar a usar el asistente.
          </p>
        </div>

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
            <Label htmlFor="agentCode">Código de agente</Label>
            <Input
              id="agentCode"
              value={agentCode}
              onChange={(e) => setAgentCode(e.target.value)}
              placeholder="Ej: RMX-1234"
              maxLength={20}
              required
            />
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Guardando..." : "Comenzar"}
        </Button>
      </form>
    </div>
  );
};

export default Onboarding;
