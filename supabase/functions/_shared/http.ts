import { corsHeaders } from "./cors.ts";

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

/** Loguea el error real server-side y devuelve un mensaje genérico y seguro. */
export function safeError(err: unknown, fn: string): string {
  console.error(`[${fn}]`, err);
  return "Error interno del servidor";
}
