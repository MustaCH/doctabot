// Authentication: validates JWT and loads agent profile
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

export interface AuthResult {
  userId: string;
  agentName: string | null;
  agentCode: string | null;
}

export async function authenticateRequest(
  req: Request,
  supabaseUrl: string,
  supabase: any
): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, agent_code")
    .eq("user_id", user.id)
    .single();

  return {
    userId: user.id,
    agentName: profile?.full_name ?? null,
    agentCode: profile?.agent_code ?? null,
  };
}
