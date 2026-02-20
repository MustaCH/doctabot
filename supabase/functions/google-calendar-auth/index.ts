import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-auth`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  // --- Step 1: Initiate OAuth — called from frontend with user's JWT ---
  if (req.method === "POST" && url.searchParams.get("action") === "init") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userId = data.claims.sub;

    // Get returnUrl from body to redirect back after OAuth
    let returnUrl = "";
    try {
      const body = await req.json();
      returnUrl = typeof body?.returnUrl === "string" ? body.returnUrl : "";
    } catch { /* no body is fine */ }

    // Encode userId + returnUrl in state
    const statePayload = btoa(JSON.stringify({ userId, returnUrl }));

    // Build Google OAuth URL
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent",
      state: statePayload,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ url: authUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // --- Step 2: OAuth Callback — Google redirects here with ?code= ---
  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    // Decode state
    let userId = "";
    let returnUrl = "";
    try {
      const parsed = JSON.parse(atob(stateRaw ?? ""));
      userId = parsed.userId ?? "";
      returnUrl = parsed.returnUrl ?? "";
    } catch {
      userId = stateRaw ?? ""; // Fallback for old plain userId state
    }

    const fallbackReturn = returnUrl || "https://doctabot.lovable.app/profile";

    if (errorParam || !code || !userId) {
      return Response.redirect(`${fallbackReturn}?calendar=error`, 302);
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange error:", err);
      return Response.redirect(`${fallbackReturn}?calendar=error`, 302);
    }

    const tokens = await tokenRes.json();
    const { access_token, refresh_token, expires_in, token_type, scope } = tokens;

    if (!access_token || !refresh_token) {
      console.error("Missing tokens in response:", tokens);
      return Response.redirect(`${fallbackReturn}?calendar=error`, 302);
    }

    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Save tokens to DB using service role (bypasses RLS since we trust userId from state)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: dbError } = await supabase
      .from("google_calendar_tokens")
      .upsert({
        user_id: userId,
        access_token,
        refresh_token,
        token_type: token_type ?? "Bearer",
        expires_at: expiresAt,
        scope,
      }, { onConflict: "user_id" });

    if (dbError) {
      console.error("DB error saving tokens:", dbError);
      return Response.redirect(`${fallbackReturn}?calendar=error`, 302);
    }

    return Response.redirect(`${fallbackReturn}?calendar=connected`, 302);
  }

  // --- Step 3: Disconnect — DELETE tokens ---
  if (req.method === "DELETE") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: delError } = await supabase.from("google_calendar_tokens").delete().eq("user_id", data.claims.sub);
    if (delError) {
      return new Response(JSON.stringify({ error: "Error al desconectar" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
