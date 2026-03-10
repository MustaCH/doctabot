import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { pin } = body;

    if (pin !== "7742") {
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
