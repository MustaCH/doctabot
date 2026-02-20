import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, LogOut, Heart, Users, Calendar, CalendarCheck, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import alanAvatar from "@/assets/alan-avatar.png";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const Profile = () => {
  const { user, signOut, session } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [agentCode, setAgentCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Handle redirect back from Google OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendarStatus = params.get("calendar");
    if (calendarStatus === "connected") {
      toast.success("Google Calendar conectado ✅");
      setCalendarConnected(true);
      // Clean URL
      window.history.replaceState({}, "", "/profile");
    } else if (calendarStatus === "error") {
      toast.error("Error al conectar Google Calendar");
      window.history.replaceState({}, "", "/profile");
    }
  }, []);

  const checkCalendarConnection = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("google_calendar_tokens")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    setCalendarConnected(!!data);
  }, [user]);

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
    checkCalendarConnection();
  }, [user, checkCalendarConnection]);

  const handleConnectCalendar = async () => {
    if (!session?.access_token) return;
    setCalendarLoading(true);
    try {
      // Encode return URL in state so the callback can redirect back
      const returnUrl = `${window.location.origin}/profile`;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/google-calendar-auth?action=init`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ returnUrl }),
      });
      const { url } = await res.json();
      if (!url) throw new Error("No URL returned");

      // Full redirect — Google blocks popups
      window.location.href = url;
    } catch {
      toast.error("Error al iniciar conexión con Google Calendar");
      setCalendarLoading(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!session?.access_token) return;
    setCalendarLoading(true);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/google-calendar-auth`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setCalendarConnected(false);
      toast.success("Google Calendar desconectado");
    } catch {
      toast.error("Error al desconectar");
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

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/favorites")}
          >
            <Heart className="mr-2 h-4 w-4 fill-destructive text-destructive" />
            Favoritos
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/clients")}
          >
            <Users className="mr-2 h-4 w-4 text-primary" />
            Clientes
          </Button>
        </div>

        {/* Google Calendar */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            {calendarConnected
              ? <CalendarCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
              : <Calendar className="h-5 w-5 text-muted-foreground" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Google Calendar</p>
              <p className="text-xs text-muted-foreground">
                {calendarConnected ? "Conectado — Alan puede ver y crear eventos" : "No conectado"}
              </p>
            </div>
          </div>
          {calendarConnected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={handleDisconnectCalendar}
              disabled={calendarLoading}
            >
              {calendarLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Desconectar calendario
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
            >
              {calendarLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
              }
              Conectar Google Calendar
            </Button>
          )}
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
