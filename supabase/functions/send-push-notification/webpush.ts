// Web Push crypto (RFC 8030 / VAPID + RFC 8291/8188 aes128gcm).
// Extraído de index.ts para poder unit-testear el round-trip de encriptación
// (ver webpush.test.ts). Usa solo Web Crypto estándar → corre en Deno y en Node.

export async function importVapidKeys(publicKeyB64: string, privateKeyB64: string) {
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

export function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createVapidAuthHeader(
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
  const rStart = offset;
  offset += rLen;

  // Parse s
  if (der[offset] !== 0x02) throw new Error("Invalid DER");
  offset++;
  const sLen = der[offset++];
  const sStart = offset;

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
export async function encryptPayload(
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

  // CEK = HKDF-Expand(PRK2, "Content-Encoding: aes128gcm" || 0x00, 16)
  // NB: hkdfExpand ya appendea el 0x01 final del HKDF-Expand. El info NO debe
  // incluirlo (igual que authInfo arriba). Incluirlo acá duplicaba el 0x01 y
  // producía un CEK/NONCE inválido → el browser no podía descifrar el push.
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const cek = (await hkdfExpand(new Uint8Array(prk2), cekInfo, 16));

  // Nonce = HKDF-Expand(PRK2, "Content-Encoding: nonce" || 0x00, 12)
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
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

export async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const input = new Uint8Array(info.length + 1);
  input.set(info, 0);
  input[info.length] = 1;
  const output = await crypto.subtle.sign("HMAC", key, input);
  return new Uint8Array(output).slice(0, length);
}
