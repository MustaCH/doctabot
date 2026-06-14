// Error tracking del front (ticket 86aj18r6x). Enfoque liviano: postea a la edge
// function report-error, que persiste en error_logs + pingea n8n. Sin SaaS externo.
//
// Robustez: nunca debe tirar (se llama desde handlers globales y un ErrorBoundary).
// Throttle + dedupe para no floodear si un error se dispara en loop de render.
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const REPORT_URL = `${SUPABASE_URL}/functions/v1/report-error`;
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 30_000;
const DEDUPE_MS = 10_000;

let windowStart = 0;
let windowCount = 0;
const recentSignatures = new Map<string, number>();

function nowMs(): number {
  return Date.now();
}

function shouldSend(signature: string): boolean {
  const t = nowMs();
  // Dedupe: misma firma dentro de DEDUPE_MS → no reenviar.
  const last = recentSignatures.get(signature);
  if (last && t - last < DEDUPE_MS) return false;
  recentSignatures.set(signature, t);
  // Limpieza barata del mapa.
  if (recentSignatures.size > 50) {
    for (const [k, v] of recentSignatures) {
      if (t - v > DEDUPE_MS) recentSignatures.delete(k);
    }
  }
  // Throttle por ventana.
  if (t - windowStart > WINDOW_MS) {
    windowStart = t;
    windowCount = 0;
  }
  if (windowCount >= MAX_PER_WINDOW) return false;
  windowCount++;
  return true;
}

export async function reportFrontendError(params: {
  context: string;
  error: unknown;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { context, error, metadata } = params;
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
    const stack = error instanceof Error ? error.stack ?? null : null;
    if (!message) return;

    const signature = `${context}:${message}`.slice(0, 200);
    if (!shouldSend(signature)) return;

    // Token de sesión (si hay) para atribuir el error al usuario; si no, anon key.
    let token = ANON_KEY;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) token = data.session.access_token;
    } catch {
      /* sin sesión: queda anon */
    }

    await fetch(REPORT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        context: context.slice(0, 300),
        message: message.slice(0, 4000),
        stack: stack ? stack.slice(0, 8000) : undefined,
        metadata: {
          ...metadata,
          url: typeof location !== "undefined" ? location.pathname : undefined,
          ua: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        },
      }),
      keepalive: true, // que sobreviva si la página se está descargando
    });
  } catch {
    // Tragar: el reporte de errores jamás puede romper la app.
  }
}

/** Instala handlers globales para errores no capturados y promesas rechazadas. */
export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    void reportFrontendError({
      context: "window.onerror",
      error: event.error ?? event.message,
      metadata: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void reportFrontendError({
      context: "unhandledrejection",
      error: event.reason,
    });
  });
}
