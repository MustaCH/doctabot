import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  hasProfile: boolean;
  agentCode: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const [agentCode, setAgentCode] = useState<string | null>(null);

  const checkProfile = useCallback(async (userId: string): Promise<{ exists: boolean; code: string | null }> => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, agent_code")
        .eq("user_id", userId)
        .maybeSingle();
      return { exists: !!data, code: data?.agent_code ?? null };
    } catch {
      return { exists: false, code: null };
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      const result = await checkProfile(user.id);
      setHasProfile(result.exists);
      setAgentCode(result.code);
    }
  }, [user, checkProfile]);

  useEffect(() => {
    let mounted = true;

    // Set up auth listener first
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Use setTimeout to avoid Supabase deadlock with async in listener
          setTimeout(async () => {
            if (!mounted) return;
            const result = await checkProfile(session.user.id);
            if (mounted) {
              setHasProfile(result.exists);
              setAgentCode(result.code);
              setLoading(false);
            }
          }, 0);
        } else {
          setHasProfile(false);
          setAgentCode(null);
          setLoading(false);
        }
      }
    );

    // Then get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        const result = await checkProfile(session.user.id);
        if (mounted) {
          setHasProfile(result.exists);
          setAgentCode(result.code);
        }
      }
      if (mounted) setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [checkProfile]);

  const signInWithGoogle = async () => {
    await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, hasProfile, agentCode, signInWithGoogle, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
