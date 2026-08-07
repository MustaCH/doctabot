import { describe, it, expect } from "vitest";
import {
  OAUTH_STATE_TTL_MS,
  signOAuthState,
  verifyOAuthState,
  resolveReturnUrl,
  type OAuthStatePayload,
} from "./oauth-state";

const SECRET = "test-secret-para-hmac";
const NOW = 1_800_000_000_000; // epoch ms fijo para los tests

function makePayload(overrides: Partial<OAuthStatePayload> = {}): OAuthStatePayload {
  return {
    userId: "123e4567-e89b-12d3-a456-426614174000",
    returnUrl: "https://chat.doctabot.online/profile",
    nonce: "9f8b7c6d-0000-4000-8000-000000000001",
    exp: NOW + OAUTH_STATE_TTL_MS,
    ...overrides,
  };
}

describe("signOAuthState / verifyOAuthState", () => {
  it("round-trip: firma y verifica el payload completo", async () => {
    const payload = makePayload();
    const state = await signOAuthState(payload, SECRET);
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const verified = await verifyOAuthState(state, SECRET, NOW);
    expect(verified).toEqual(payload);
  });

  it("rechaza un state con firma de otro secret", async () => {
    const state = await signOAuthState(makePayload(), "otro-secret");
    expect(await verifyOAuthState(state, SECRET, NOW)).toBeNull();
  });

  it("rechaza un payload adulterado (firma no coincide)", async () => {
    const state = await signOAuthState(makePayload(), SECRET);
    const [, sig] = state.split(".");
    // Payload del atacante: mismo formato, otro userId, firma original.
    const evil = makePayload({ userId: "00000000-0000-4000-8000-00000000dead" });
    const evilB64 = btoa(JSON.stringify(evil)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyOAuthState(`${evilB64}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rechaza un state expirado", async () => {
    const state = await signOAuthState(makePayload({ exp: NOW - 1 }), SECRET);
    expect(await verifyOAuthState(state, SECRET, NOW)).toBeNull();
  });

  it("rechaza formatos inválidos (legado sin firmar, basura, vacío)", async () => {
    // Formato legado: btoa(JSON) sin firma — debe morir, no hay fallback.
    const legacy = btoa(JSON.stringify({ userId: "u", returnUrl: "https://evil.com" }));
    expect(await verifyOAuthState(legacy, SECRET, NOW)).toBeNull();
    // userId plano legado.
    expect(await verifyOAuthState("123e4567-e89b-12d3-a456-426614174000", SECRET, NOW)).toBeNull();
    expect(await verifyOAuthState("", SECRET, NOW)).toBeNull();
    expect(await verifyOAuthState("a.b.c", SECRET, NOW)).toBeNull();
    expect(await verifyOAuthState("no-base64!!.###", SECRET, NOW)).toBeNull();
  });

  it("rechaza payloads firmados con campos faltantes o inválidos", async () => {
    const cases = [
      { ...makePayload(), userId: "" },
      { ...makePayload(), nonce: "" },
      { ...makePayload(), exp: Number.NaN },
    ];
    for (const c of cases) {
      const state = await signOAuthState(c as OAuthStatePayload, SECRET);
      expect(await verifyOAuthState(state, SECRET, NOW)).toBeNull();
    }
  });

  it("no verifica nada con secret vacío", async () => {
    const state = await signOAuthState(makePayload(), SECRET);
    expect(await verifyOAuthState(state, "", NOW)).toBeNull();
  });
});

describe("resolveReturnUrl", () => {
  const ALLOWED = ["https://chat.doctabot.online", "https://doctabot.lovable.app"];
  const DEFAULT = "https://chat.doctabot.online/profile";

  it("acepta URLs de orígenes permitidos", () => {
    expect(resolveReturnUrl("https://chat.doctabot.online/onboarding", ALLOWED, DEFAULT))
      .toBe("https://chat.doctabot.online/onboarding");
    expect(resolveReturnUrl("https://doctabot.lovable.app/profile", ALLOWED, DEFAULT))
      .toBe("https://doctabot.lovable.app/profile");
  });

  it("acepta paths relativos resolviéndolos contra el origen por defecto", () => {
    expect(resolveReturnUrl("/onboarding", ALLOWED, DEFAULT))
      .toBe("https://chat.doctabot.online/onboarding");
  });

  it("acepta localhost para desarrollo", () => {
    expect(resolveReturnUrl("http://localhost:5173/profile", ALLOWED, DEFAULT))
      .toBe("http://localhost:5173/profile");
    expect(resolveReturnUrl("http://127.0.0.1:8080/onboarding", ALLOWED, DEFAULT))
      .toBe("http://127.0.0.1:8080/onboarding");
  });

  it("rechaza open redirects: otros dominios, protocol-relative, esquemas raros", () => {
    expect(resolveReturnUrl("https://evil.com/phish", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("//evil.com/phish", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("javascript:alert(1)", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("https://chat.doctabot.online.evil.com/x", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("data:text/html,hola", ALLOWED, DEFAULT)).toBe(DEFAULT);
  });

  it("rechaza open redirects por normalización de new URL(): backslash, tab y newline", () => {
    // new URL() normaliza "\" a "/" → "/\evil.com" parece path relativo pero resuelve a https://evil.com/
    expect(resolveReturnUrl("/\\evil.com", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("/\\/evil.com", ALLOWED, DEFAULT)).toBe(DEFAULT);
    // new URL() strippea tabs/newlines antes de parsear → "/\t/evil.com" se vuelve "//evil.com"
    expect(resolveReturnUrl("/\t/evil.com", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("/\n/evil.com", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("/\r/evil.com", ALLOWED, DEFAULT)).toBe(DEFAULT);
    // Variante absoluta con tab dentro del esquema/host también muere.
    expect(resolveReturnUrl("https://evil\t.com/x", ALLOWED, DEFAULT)).toBe(DEFAULT);
  });

  it("un path relativo legítimo sigue funcionando tras el doble cinturón", () => {
    expect(resolveReturnUrl("/profile?tab=calendar", ALLOWED, DEFAULT))
      .toBe("https://chat.doctabot.online/profile?tab=calendar");
  });

  it("vacío o basura → default", () => {
    expect(resolveReturnUrl("", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("   ", ALLOWED, DEFAULT)).toBe(DEFAULT);
    expect(resolveReturnUrl("no-es-una-url", ALLOWED, DEFAULT)).toBe(DEFAULT);
  });
});
