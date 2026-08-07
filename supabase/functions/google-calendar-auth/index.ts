import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  OAUTH_STATE_TTL_MS,
  resolveReturnUrl,
  signOAuthState,
  verifyOAuthState,
} from "../_shared/oauth-state.ts";

// Orígenes desde los que la app puede recibir el redirect post-OAuth.
// APP_URL (env) se suma a la lista si está definido.
const KNOWN_APP_ORIGINS = [
  "https://chat.doctabot.online",
  "https://doctabot.lovable.app",
];

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Redirect al returnUrl con `?calendar=connected|error`. Usa la API de URL en vez de concatenar
 * `?...` a mano: un returnUrl que ya trae query ("/profile?tab=x") rompía con doble `?`.
 * El returnUrl ya pasó por resolveReturnUrl, así que new URL() no puede tirar acá — igual hay
 * fallback defensivo al propio returnUrl.
 */
function redirectWithCalendarStatus(returnUrl: string, status: "connected" | "error"): Response {
  try {
    const u = new URL(returnUrl);
    u.searchParams.set("calendar", status);
    return Response.redirect(u.toString(), 302);
  } catch {
    return Response.redirect(returnUrl, 302);
  }
}

/** Página de error para el callback: no podemos confiar en returnUrl, así que no redirigimos. */
function oauthErrorPage(detail: string, appUrl: string): Response {
  const html = `<!DOCTYPE html>
<html lang="es-AR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Error al conectar Google</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f6f6f7; color: #1c1c1e; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 32px; max-width: 420px; text-align: center; }
    h1 { font-size: 1.2rem; margin: 0 0 12px; }
    p { margin: 0 0 20px; line-height: 1.5; color: #4a4a4c; }
    a { display: inline-block; background: #1c1c1e; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>No pudimos completar la conexión con Google</h1>
    <p>${detail}</p>
    <a href="${appUrl}">Volver a Alan</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

serve(async (req) => {
  console.log(`[gcal-auth] ${req.method} ${req.url}`);

  const pre = handleOptions(req);
  if (pre) return pre;

  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const OAUTH_STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET") ?? "";
  const APP_URL = (Deno.env.get("APP_URL") ?? "https://chat.doctabot.online").replace(/\/+$/, "");
  const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-auth`;

  const allowedOrigins = [...new Set([APP_URL, ...KNOWN_APP_ORIGINS])];
  const defaultReturnUrl = `${APP_URL}/profile`;

  const url = new URL(req.url);

  // --- Step 1: Initiate OAuth — called from frontend with user's JWT ---
  if (req.method === "POST" && url.searchParams.get("action") === "init") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    if (!OAUTH_STATE_SECRET) {
      console.error("[gcal-auth] OAUTH_STATE_SECRET no configurado — no se puede firmar el state");
      return jsonError("Configuración incompleta del servidor", 500);
    }

    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return jsonError("Unauthorized", 401);
    }

    const userId = user.id;

    // Get returnUrl from body to redirect back after OAuth (validado contra allowlist).
    let rawReturnUrl = "";
    try {
      const body = await req.json();
      rawReturnUrl = typeof body?.returnUrl === "string" ? body.returnUrl : "";
    } catch { /* no body is fine */ }
    const returnUrl = resolveReturnUrl(rawReturnUrl, allowedOrigins, defaultReturnUrl);

    // Nonce de un solo uso con TTL, persistido para que el callback lo consuma.
    const nonce = crypto.randomUUID();
    const exp = Date.now() + OAUTH_STATE_TTL_MS;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Limpieza best-effort de nonces vencidos.
    await admin.from("oauth_states").delete().lt("expires_at", new Date().toISOString());
    const { error: insertError } = await admin.from("oauth_states").insert({
      nonce,
      user_id: userId,
      expires_at: new Date(exp).toISOString(),
    });
    if (insertError) {
      console.error("[gcal-auth] Error guardando nonce:", insertError);
      return jsonError("No se pudo iniciar la conexión", 500);
    }

    // State firmado (HMAC-SHA256): el callback rechaza cualquier state no emitido acá.
    const statePayload = await signOAuthState({ userId, returnUrl, nonce, exp }, OAUTH_STATE_SECRET);

    // Build Google OAuth URL
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent",
      state: statePayload,
      hl: "en",
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ url: authUrl }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // --- Step 2: OAuth Callback — Google redirects here with ?code= ---
  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    if (!OAUTH_STATE_SECRET) {
      console.error("[gcal-auth] OAUTH_STATE_SECRET no configurado — no se puede verificar el state");
      return oauthErrorPage("El servidor no está configurado para completar la conexión. Avisale al administrador.", APP_URL);
    }

    // El state DEBE estar firmado por nosotros, no vencido y con nonce sin usar.
    // Sin excepciones ni fallbacks: un state inválido corta el flujo acá.
    const payload = await verifyOAuthState(stateRaw ?? "", OAUTH_STATE_SECRET);
    if (!payload) {
      console.warn("[gcal-auth] State inválido, mal firmado o vencido en callback");
      return oauthErrorPage(
        "El enlace de conexión es inválido o expiró. Volvé a la app e intentá conectar Google de nuevo.",
        APP_URL,
      );
    }

    const userId = payload.userId;
    // Re-validamos returnUrl por si cambia la allowlist entre emisión y callback.
    const returnUrl = resolveReturnUrl(payload.returnUrl, allowedOrigins, defaultReturnUrl);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Consumir el nonce (one-shot): DELETE ... RETURNING. Si no devuelve fila,
    // el state ya fue usado (o nunca lo emitimos) → rechazar.
    const { data: consumed, error: nonceError } = await supabase
      .from("oauth_states")
      .delete()
      .eq("nonce", payload.nonce)
      .eq("user_id", userId)
      .select("nonce, expires_at");

    if (nonceError) {
      console.error("[gcal-auth] Error consumiendo nonce:", nonceError);
      return oauthErrorPage("Ocurrió un error al validar la conexión. Intentá de nuevo desde la app.", APP_URL);
    }
    if (!consumed || consumed.length === 0) {
      console.warn("[gcal-auth] Nonce inexistente o ya usado:", payload.nonce);
      return oauthErrorPage(
        "Este enlace de conexión ya fue usado o expiró. Volvé a la app e intentá conectar Google de nuevo.",
        APP_URL,
      );
    }
    if (new Date(consumed[0].expires_at).getTime() <= Date.now()) {
      console.warn("[gcal-auth] Nonce vencido:", payload.nonce);
      return oauthErrorPage(
        "El enlace de conexión expiró. Volvé a la app e intentá conectar Google de nuevo.",
        APP_URL,
      );
    }

    // State válido: si Google devolvió error o no hay code, redirigimos con error.
    if (errorParam || !code) {
      return redirectWithCalendarStatus(returnUrl, "error");
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
      return redirectWithCalendarStatus(returnUrl, "error");
    }

    const tokens = await tokenRes.json();
    const { access_token, refresh_token, expires_in, token_type, scope } = tokens;

    if (!access_token || !refresh_token) {
      console.error("Missing tokens in response:", tokens);
      return redirectWithCalendarStatus(returnUrl, "error");
    }

    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Save tokens to DB using service role. El userId viene del state FIRMADO
    // por nosotros y con nonce one-shot verificado — no del input del request.
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
      return redirectWithCalendarStatus(returnUrl, "error");
    }

    return redirectWithCalendarStatus(returnUrl, "connected");
  }

  // --- Step 3: Disconnect — DELETE tokens ---
  if (req.method === "DELETE") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return jsonError("Unauthorized", 401);
    }

    const { error: delError } = await supabase.from("google_calendar_tokens").delete().eq("user_id", user.id);
    if (delError) {
      return jsonError("Error al desconectar", 500);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return jsonError("Not found", 404);
});
