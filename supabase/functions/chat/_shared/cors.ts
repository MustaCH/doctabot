// CORS headers shared across the chat function
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const MAX_MESSAGE_LENGTH = 10000;

// Límites de adjuntos (base64 de imágenes en messages[].attachments). Evita costo/DoS por
// imágenes enormes: el límite de content NO cubre el base64 de los adjuntos.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;        // 10 MB por adjunto
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;  // 20 MB total por request

/** Bytes (aprox) representados por un string base64. */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Valida el tamaño de los adjuntos del request (suma de base64). Devuelve un mensaje de
 * error si algún adjunto o el total supera el tope, o null si está OK. Puro y testeable.
 */
export function validateAttachmentSizes(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  let total = 0;
  for (const m of messages as Array<{ attachments?: unknown }>) {
    const atts = m?.attachments;
    if (!Array.isArray(atts)) continue;
    for (const att of atts as Array<{ base64?: unknown }>) {
      const b64 = att?.base64;
      if (typeof b64 !== "string" || b64 === "") continue;
      const bytes = base64Bytes(b64);
      if (bytes > MAX_ATTACHMENT_BYTES) return "Un adjunto supera el tamaño máximo (10MB por archivo).";
      total += bytes;
    }
  }
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) return "Los adjuntos superan el tamaño máximo total (20MB).";
  return null;
}
