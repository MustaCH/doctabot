// Firma y verificación del `state` de OAuth (Google Calendar/Gmail).
//
// El state viaja por el navegador del usuario y vuelve por un callback GET
// público, así que NUNCA se puede confiar en su contenido sin verificar:
// - Se firma con HMAC-SHA256 (Web Crypto) usando un secret de entorno.
// - Formato: `base64url(JSON payload) + "." + base64url(firma)`.
// - El payload incluye un nonce de un solo uso (persistido en `oauth_states`)
//   y una expiración corta (TTL) verificada acá.
//
// Este módulo es puro (sin Deno.* ni Supabase) para poder testearlo con Vitest.

export interface OAuthStatePayload {
  userId: string;
  returnUrl: string;
  nonce: string;
  /** Expiración en epoch millis. */
  exp: number;
}

/** TTL del state: 10 minutos. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

/** Firma el payload y devuelve el state listo para mandarle a Google. */
export async function signOAuthState(payload: OAuthStatePayload, secret: string): Promise<string> {
  if (!secret) throw new Error("OAuth state secret vacío");
  const payloadB64 = bytesToBase64url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  return `${payloadB64}.${bytesToBase64url(new Uint8Array(sig))}`;
}

/**
 * Verifica firma y expiración del state. Devuelve el payload si es válido,
 * o `null` si está malformado, mal firmado o vencido.
 * (El one-shot del nonce se verifica aparte, contra la tabla `oauth_states`.)
 */
export async function verifyOAuthState(
  state: string,
  secret: string,
  now: number = Date.now(),
): Promise<OAuthStatePayload | null> {
  if (!secret || typeof state !== "string") return null;
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let sigBytes: Uint8Array;
  let payloadJson: string;
  try {
    sigBytes = base64urlToBytes(parts[1]);
    payloadJson = decoder.decode(base64urlToBytes(parts[0]));
  } catch {
    return null;
  }

  // crypto.subtle.verify hace la comparación en tiempo constante.
  const key = await hmacKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as unknown as BufferSource,
    encoder.encode(parts[0]),
  );
  if (!valid) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.userId !== "string" || p.userId.length === 0) return null;
  if (typeof p.nonce !== "string" || p.nonce.length === 0) return null;
  if (typeof p.returnUrl !== "string") return null;
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp)) return null;
  if (p.exp <= now) return null;

  return { userId: p.userId, returnUrl: p.returnUrl, nonce: p.nonce, exp: p.exp };
}

/**
 * Valida `returnUrl` contra una allowlist de orígenes y devuelve una URL segura.
 * Acepta:
 * - vacío → `defaultUrl`
 * - path relativo ("/profile") → se resuelve contra el origen de `defaultUrl`
 * - URL absoluta http(s) cuyo origen esté en `allowedOrigins`
 * - localhost / 127.0.0.1 (cualquier puerto) para desarrollo
 * Cualquier otra cosa (otros dominios, protocolos raros, "//evil.com") → `defaultUrl`.
 */
export function resolveReturnUrl(
  raw: string,
  allowedOrigins: string[],
  defaultUrl: string,
): string {
  const fallback = defaultUrl;
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const candidate = raw.trim();

  // Open redirect por normalización de new URL(): los backslashes se convierten en "/" y los
  // tabs/newlines se STRIPPEAN antes de parsear → "/\evil.com", "/\t/evil.com" o "/\n/evil.com"
  // pasan el guard de path relativo pero resuelven a https://evil.com/. Cinturón 1: cualquier
  // candidato con esos caracteres se rechaza de plano (ninguna URL legítima los necesita).
  if (/[\\\t\n\r]/.test(candidate)) return fallback;

  const originAllowed = (origin: string): boolean => {
    const normalized = allowedOrigins.map((o) => o.replace(/\/+$/, ""));
    return normalized.includes(origin);
  };

  // Path relativo (pero no protocol-relative "//host").
  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    try {
      const fallbackOrigin = new URL(fallback).origin;
      const resolved = new URL(candidate, fallbackOrigin);
      // Cinturón 2: aunque parezca relativo, el origen RESUELTO tiene que seguir siendo el del
      // fallback o estar en la allowlist — si la resolución "escapó" a otro host, fallback.
      if (resolved.origin !== fallbackOrigin && !originAllowed(resolved.origin)) return fallback;
      return resolved.toString();
    } catch {
      return fallback;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return fallback;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;

  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocalhost) return parsed.toString();

  if (originAllowed(parsed.origin)) return parsed.toString();

  return fallback;
}
