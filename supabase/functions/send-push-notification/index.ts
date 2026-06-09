import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { requireString, requireUuid, optionalString, ValidationError } from "../_shared/validation.ts";

// ---- Web Push helpers (RFC 8030 / VAPID) ----

async function importVapidKeys(publicKeyB64: string, privateKeyB64: string) {
  const pubRaw = base64UrlDecode(publicKeyB64);
  const privRaw = base64UrlDecode(privateKeyB64);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    buildPkcs8(privRaw, pubRaw),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  return { privateKey, publicKeyRaw: pubRaw };
}

function buildPkcs8(privRaw: Uint8Array, pubRaw: Uint8Array): Uint8Array {
  // DER-encoded PKCS8 wrapper for EC P-256
  const header = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20,
  ]);
  const mid = new Uint8Array([0xa1, 0x44, 0x03, 0x42, 0x00]);
  const result = new Uint8Array(header.length + privRaw.length + mid.length + pubRaw.length);
  result.set(header, 0);
  result.set(privRaw, header.length);
  result.set(mid, header.length + privRaw.length);
  result.set(pubRaw, header.length + privRaw.length + mid.length);
  return result;
}

function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createVapidAuthHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: CryptoKey,
  vapidPublicKeyRaw: Uint8Array,
  subject: string
) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ aud, exp, sub: subject })));
  const unsigned = `${header}.${payload}`;

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    vapidPrivateKey,
    new TextEncoder().encode(unsigned)
  );

  // Convert DER signature to raw r||s format
  const derSig = new Uint8Array(sig);
  const rawSig = derToRaw(derSig);

  const token = `${unsigned}.${base64UrlEncode(rawSig)}`;
  const key = base64UrlEncode(vapidPublicKeyRaw);

  return `vapid t=${token},k=${key}`;
}

function derToRaw(der: Uint8Array): Uint8Array {
  // Check if it's already raw (64 bytes)
  if (der.length === 64) return der;
  
  // Parse DER sequence
  let offset = 2; // skip SEQUENCE tag and length
  
  // Parse r
  if (der[offset] !== 0x02) throw new Error("Invalid DER");
  offset++;
  const rLen = der[offset++];
  let rStart = offset;
  offset += rLen;
  
  // Parse s
  if (der[offset] !== 0x02) throw new Error("Invalid DER");
  offset++;
  const sLen = der[offset++];
  let sStart = offset;
  
  const raw = new Uint8Array(64);
  // Copy r (right-aligned, skip leading zeros)
  const rData = der.slice(rStart, rStart + rLen);
  const rPad = 32 - Math.min(rLen, 32);
  raw.set(rData.slice(Math.max(0, rLen - 32)), rPad);
  
  // Copy s
  const sData = der.slice(sStart, sStart + sLen);
  const sPad = 32 - Math.min(sLen, 32);
  raw.set(sData.slice(Math.max(0, sLen - 32)), 32 + sPad);
  
  return raw;
}

// Encrypt payload using Web Push encryption (aes128gcm)
async function encryptPayload(
  payload: string,
  p256dhKey: string,
  authSecret: string
) {
  const p256dhRaw = base64UrlDecode(p256dhKey);
  const authRaw = base64UrlDecode(authSecret);

  // Import subscriber public key
  const subscriberKey = await crypto.subtle.importKey(
    "raw",
    p256dhRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberKey },
    localKeyPair.privateKey,
    256
  );

  const localPubRaw = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);

  // HKDF-based key derivation per RFC 8291
  const ikm = new Uint8Array(sharedSecret);
  
  // auth_info = "WebPush: info" || 0x00 || ua_public || as_public
  const infoPrefix = new TextEncoder().encode("WebPush: info\0");
  const authInfo = new Uint8Array(infoPrefix.length + 65 + 65);
  authInfo.set(infoPrefix, 0);
  authInfo.set(new Uint8Array(p256dhRaw), infoPrefix.length);
  authInfo.set(new Uint8Array(localPubRaw), infoPrefix.length + 65);

  // PRK = HKDF-Extract(auth_secret, ecdh_secret)
  const authKey = await crypto.subtle.importKey("raw", authRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = await crypto.subtle.sign("HMAC", authKey, ikm);

  // IKM = HKDF-Expand(PRK, auth_info, 32)
  const ikm2 = await hkdfExpand(new Uint8Array(prk), authInfo, 32);

  // Salt (random 16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK2 = HKDF-Extract(salt, ikm2)
  const saltKey = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk2 = await crypto.subtle.sign("HMAC", saltKey, ikm2);

  // CEK = HKDF-Expand(PRK2, "Content-Encoding: aes128gcm" || 0x00 || 0x01, 16)
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0\x01");
  const cek = (await hkdfExpand(new Uint8Array(prk2), cekInfo, 16));

  // Nonce = HKDF-Expand(PRK2, "Content-Encoding: nonce" || 0x00 || 0x01, 12)
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0\x01");
  const nonce = await hkdfExpand(new Uint8Array(prk2), nonceInfo, 12);

  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = new Uint8Array([...new TextEncoder().encode(payload), 2]); // delimiter
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded);

  // Build aes128gcm header: salt(16) || rs(4) || idlen(1) || keyid(65) || ciphertext
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = 65;
  header.set(new Uint8Array(localPubRaw), 21);

  const body = new Uint8Array(header.length + ciphertext.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(ciphertext), header.length);

  return body;
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const input = new Uint8Array(info.length + 1);
  input.set(info, 0);
  input[info.length] = 1;
  const output = await crypto.subtle.sign("HMAC", key, input);
  return new Uint8Array(output).slice(0, length);
}

// ---- Main handler ----

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body = await req.json();
    
    // Allow clients to fetch the VAPID public key to stay in sync
    if (body.action === "get_vapid_key") {
      const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
      return new Response(JSON.stringify({ vapid_public_key: vapidPublicKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user_id = requireUuid(body.user_id, "user_id");
    const title = requireString(body.title, "title", { maxLength: 200 });
    const pushBody = optionalString(body.body, "body", { maxLength: 500 }) ?? "";
    const url = optionalString(body.url, "url", { maxLength: 500 }) ?? "/";

    const triggerSource = typeof body.trigger_source === "string"
      ? body.trigger_source.slice(0, 64)
      : null;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", user_id);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKeyB64 = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const { privateKey, publicKeyRaw } = await importVapidKeys(vapidPublicKey, vapidPrivateKeyB64);

    const payload = JSON.stringify({ title, body: pushBody || "", url: url || "/" });
    let sent = 0;
    const deliveryLogs: Array<{
      user_id: string;
      endpoint_preview: string;
      status: "sent" | "failed" | "pruned";
      http_status: number | null;
      error_message: string | null;
      pruned: boolean;
      trigger_source: string | null;
    }> = [];

    for (const sub of subs) {
      const endpointPreview = sub.endpoint.slice(0, 80);
      try {
        const encrypted = await encryptPayload(payload, sub.p256dh, sub.auth);
        const authHeader = await createVapidAuthHeader(
          sub.endpoint,
          vapidPublicKey,
          privateKey,
          publicKeyRaw,
          "mailto:alan@remax-docta.com"
        );

        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
          },
          body: encrypted,
        });

        if (res.ok || res.status === 201) {
          sent++;
          deliveryLogs.push({
            user_id,
            endpoint_preview: endpointPreview,
            status: "sent",
            http_status: res.status,
            error_message: null,
            pruned: false,
            trigger_source: triggerSource,
          });
        } else {
          const respText = await res.text();
          const isVapidMismatch =
            res.status === 400 && /VapidPk|BadJwtToken/i.test(respText);
          const shouldPrune =
            res.status === 410 || res.status === 404 || isVapidMismatch;
          if (shouldPrune) {
            await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
            console.log(
              `Removed dead subscription ${sub.id} (status=${res.status}, endpoint=${endpointPreview}…): ${respText}`
            );
            deliveryLogs.push({
              user_id,
              endpoint_preview: endpointPreview,
              status: "pruned",
              http_status: res.status,
              error_message: respText.slice(0, 500),
              pruned: true,
              trigger_source: triggerSource,
            });
          } else {
            console.error(`Push failed for ${sub.id}: ${res.status} ${respText}`);
            deliveryLogs.push({
              user_id,
              endpoint_preview: endpointPreview,
              status: "failed",
              http_status: res.status,
              error_message: respText.slice(0, 500),
              pruned: false,
              trigger_source: triggerSource,
            });
          }
        }
      } catch (err) {
        console.error(`Push error for ${sub.id}:`, err);
        deliveryLogs.push({
          user_id,
          endpoint_preview: endpointPreview,
          status: "failed",
          http_status: null,
          error_message: (err as Error)?.message?.slice(0, 500) ?? "unknown error",
          pruned: false,
          trigger_source: triggerSource,
        });
      }
    }

    if (deliveryLogs.length > 0) {
      const { error: logErr } = await supabaseAdmin
        .from("push_delivery_logs")
        .insert(deliveryLogs);
      if (logErr) {
        console.error("Failed to insert push_delivery_logs:", logErr.message);
      }
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400);
    return errorResponse(safeError(err, "send-push-notification"), 500);
  }
});
