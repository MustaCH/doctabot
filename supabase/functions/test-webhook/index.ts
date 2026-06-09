import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { requireString, ValidationError } from "../_shared/validation.ts";

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body = await req.json();
    const pin = requireString(body.pin, "pin");

    // PIN read from env (reuses the SUPER_ADMIN_PIN secret, same as admin-stats).
    // No hardcoded value: if the secret is unset, access is denied.
    const ADMIN_PIN = Deno.env.get("SUPER_ADMIN_PIN") ?? "";
    if (!ADMIN_PIN || pin !== ADMIN_PIN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const N8N_WEBHOOK_URL = Deno.env.get("N8N_WEBHOOK_URL");
    if (!N8N_WEBHOOK_URL) {
      return new Response(JSON.stringify({ error: "N8N_WEBHOOK_URL not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const testPayload = {
      type: "test_notification",
      conversation_id: null,
      user_id: "test-user-id",
      user_message: "Este es un mensaje de prueba del sistema de supervisión de Alan.",
      alan_response: "Esta es una respuesta de prueba.",
      verdict: "error",
      reason: "Notificación de prueba enviada desde el Super Admin Panel.",
      score: 0,
      retry_count: 0,
      timestamp: new Date().toISOString(),
    };

    const webhookRes = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
    });

    const responseText = await webhookRes.text();

    return new Response(JSON.stringify({
      success: webhookRes.ok,
      status: webhookRes.status,
      response: responseText.slice(0, 500),
      payload_sent: testPayload,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400);
    return errorResponse(safeError(err, "test-webhook"), 500);
  }
});
