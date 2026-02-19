import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import alanAvatar from "@/assets/alan-avatar.png";

const Profile = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [agentCode, setAgentCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("full_name, agent_code")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setFullName(data.full_name);
        setAgentCode(data.agent_code);
      }
      setLoading(false);
    };
    loadProfile();
  }, [user]);

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
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/5 px-6">
      <form onSubmit={handleSave} className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">Mi perfil</h1>
        </div>

        {/* Avatar & email */}
        <div className="flex items-center gap-3">
          <img
            src={user?.user_metadata?.avatar_url || alanAvatar}
            alt="Avatar"
            className="h-12 w-12 rounded-full"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user?.user_metadata?.full_name || user?.email}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
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

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="w-full text-destructive hover:text-destructive"
          onClick={handleSignOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Cerrar sesión
        </Button>
      </form>
    </div>
  );
};

export default Profile;
