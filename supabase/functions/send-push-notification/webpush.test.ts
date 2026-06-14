import { describe, it, expect } from "vitest";
import { encryptPayload, base64UrlEncode } from "./webpush";

// --- Decryptor independiente RFC 8291 + RFC 8188 (el lado "navegador") ---
// Implementado per-spec con UN solo 0x01 en HKDF-Expand. Sirve de oráculo:
// si encryptPayload cifra mal, AES-GCM-decrypt falla (tag mismatch).

async function hmac(keyRaw: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// HKDF-Expand de un solo bloque: T(1) = HMAC(prk, info || 0x01)
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

async function decryptWebPush(
  body: Uint8Array,
  subscriberPrivate: CryptoKey,
  uaPublicRaw: Uint8Array,
  authRaw: Uint8Array,
): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublicRaw = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  const asPublic = await crypto.subtle.importKey("raw", asPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: asPublic }, subscriberPrivate, 256),
  );

  // RFC 8291: combinar con auth_secret
  const prkKey = await hmac(authRaw, shared);
  const keyInfo = concat(new TextEncoder().encode("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // RFC 8188: derivar CEK y NONCE
  const prk = await hmac(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext),
  );

  // strip padding: 0x00* finales y el delimitador 0x02
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  if (end > 0 && plain[end - 1] === 2) end--;
  return new TextDecoder().decode(plain.slice(0, end));
}

describe("webpush encryptPayload", () => {
  it("produce un payload aes128gcm que el subscriber puede descifrar (round-trip)", async () => {
    // Keypair del subscriber (navegador) + auth secret
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const uaPublicAB = await crypto.subtle.exportKey("raw", kp.publicKey);
    const uaPublicRaw = new Uint8Array(uaPublicAB);
    const auth = crypto.getRandomValues(new Uint8Array(16));

    const p256dh = base64UrlEncode(uaPublicAB);
    const authB64 = base64UrlEncode(auth.buffer);

    const message = JSON.stringify({ title: "Alan", body: "Nuevos matches", url: "/?c=abc" });
    const body = await encryptPayload(message, p256dh, authB64);

    const decrypted = await decryptWebPush(body, kp.privateKey, uaPublicRaw, auth);
    expect(decrypted).toBe(message);
  });
});
