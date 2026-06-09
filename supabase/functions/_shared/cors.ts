// CORS unificado para todas las edge functions.
// La lista de headers es superset de las variantes que había inline.
// Methods es superset (GET/POST/DELETE) para cubrir también las funciones de calendar.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

/** Si el request es preflight (OPTIONS), devuelve la Response; si no, null. */
export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return null;
}
