// Observabilidad compartida — reporte de errores de edge functions.
// Ticket 86aj18r6x. Enfoque liviano: persiste el error en public.error_logs
// (vía PostgREST con service role) y, en paralelo, pingea N8N_WEBHOOK_URL.
//
// CONTRATO: es fire-and-forget y se llama DENTRO de un catch → NUNCA debe tirar.
// Cualquier fallo del propio reporte se traga con console.error. No usa supabase-js
// para no acoplar a cómo cada función crea su client; pega directo a PostgREST.

function errToParts(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || String(error), stack: error.stack ?? null };
  }
  if (typeof error === "string") return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error).slice(0, 2000), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/**
 * Reporta un error de edge function. Devuelve una Promise para poder `await`-earla
 * dentro de `EdgeRuntime.waitUntil(...)` si se quiere, pero está pensada como
 * fire-and-forget: no propaga excepciones.
 */
export async function reportEdgeError(params: {
  context: string; // nombre de la función / paso (ej. "chat", "morning-matches")
  error: unknown;
  metadata?: Record<string, unknown>;
  userId?: string | null;
}): Promise<void> {
  const { context, error, metadata, userId } = params;
  const { message, stack } = errToParts(error);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const row = {
    source: "edge",
    context,
    message: message.slice(0, 4000),
    stack: stack ? stack.slice(0, 8000) : null,
    metadata: metadata ?? null,
    user_id: userId ?? null,
  };

  const tasks: Promise<unknown>[] = [];

  // 1. Persistir en error_logs (PostgREST). Sin service key no se puede; se omite.
  if (supabaseUrl && serviceKey) {
    tasks.push(
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
        if (!res.ok) console.error(`[observability] error_logs insert ${res.status}`);
      }),
    );
  }

  // 2. Avisar a n8n/Overlord (canal que Nacho mira). Opcional: si no hay URL, no pasa nada.
  const n8nUrl = Deno.env.get("N8N_WEBHOOK_URL");
  if (n8nUrl) {
    tasks.push(
      fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "edge_error",
          context,
          message: row.message.slice(0, 500),
          user_id: userId ?? null,
          timestamp: new Date().toISOString(),
        }),
      }).then(() => {}),
    );
  }

  try {
    await Promise.allSettled(tasks);
  } catch (reportErr) {
    // Defensa extra: jamás romper el flujo del caller.
    console.error("[observability] reportEdgeError failed:", reportErr);
  }
}

/**
 * Versión fire-and-forget para usar dentro de un `catch` justo antes de hacer `return`.
 * Engancha el reporte a EdgeRuntime.waitUntil (si existe) para que no se corte cuando
 * la función devuelve la Response. Nunca tira.
 */
export function reportEdgeErrorBg(params: {
  context: string;
  error: unknown;
  metadata?: Record<string, unknown>;
  userId?: string | null;
}): void {
  const report = reportEdgeError(params);
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(report);
  else void report;
}
