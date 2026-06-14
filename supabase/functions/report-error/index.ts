// report-error — endpoint público que el front usa para reportar errores del cliente.
// Ticket 86aj18r6x. Persiste en public.error_logs (source='frontend') y pingea n8n.
//
// verify_jwt=false a propósito: un error del front puede ocurrir pre-auth o con la
// sesión rota, y igual queremos verlo. No es un boundary de seguridad — solo loguea.
// Mitigaciones de abuso: payload capado, message obligatorio, sin efectos colaterales.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";

/** Extrae el `sub` (user id) del JWT sin verificar firma — solo para atribuir el log. */
function userIdFromAuthHeader(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return errorResponse("message requerido", 400);

  const context = typeof body.context === "string" ? body.context.slice(0, 300) : null;
  const stack = typeof body.stack === "string" ? body.stack.slice(0, 8000) : null;
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata
      : null;
  const userId = userIdFromAuthHeader(req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    // No deberíamos llegar acá en prod (env auto-inyectadas). Logueamos y 200 igual:
    // no tiene sentido devolver error al front por un fallo de reporte.
    console.error("[report-error] faltan SUPABASE_URL / SERVICE_ROLE_KEY");
    return jsonResponse({ ok: false }, 200);
  }

  const row = {
    source: "frontend",
    context,
    message: message.slice(0, 4000),
    stack,
    metadata,
    user_id: userId,
  };

  const tasks: Promise<unknown>[] = [
    fetch(`${supabaseUrl}/rest/v1/error_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    }).then((res) => {
      if (!res.ok) console.error(`[report-error] error_logs insert ${res.status}`);
    }),
  ];

  const n8nUrl = Deno.env.get("N8N_WEBHOOK_URL");
  if (n8nUrl) {
    tasks.push(
      fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "frontend_error",
          context,
          message: row.message.slice(0, 500),
          user_id: userId,
          timestamp: new Date().toISOString(),
        }),
      }).then(() => {}).catch(() => {}),
    );
  }

  await Promise.allSettled(tasks);
  return new Response(null, { status: 204, headers: corsHeaders });
});
