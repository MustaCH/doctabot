import { describe, it, expect } from "vitest";
import { buildMimeEmail, encodeHeaderValue } from "./google";

/** Decodifica el base64url que produce buildMimeEmail de vuelta a texto MIME. */
function decodeMime(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

describe("buildMimeEmail — anti header-injection (CRLF)", () => {
  it("CRLF en `to` no inyecta un header Bcc", () => {
    const mime = decodeMime(buildMimeEmail("victima@ejemplo.com\r\nBcc: atacante@evil.com", "Hola", "Cuerpo"));
    // El intento queda aplanado dentro del To (espacio), nunca como header propio.
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toContain("To: victima@ejemplo.com Bcc: atacante@evil.com");
  });

  it("CRLF en `subject` no corta el header", () => {
    const mime = decodeMime(buildMimeEmail("a@b.com", "Oferta\r\nBcc: atacante@evil.com", "Cuerpo"));
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toContain("Subject: Oferta Bcc: atacante@evil.com");
  });

  it("CRLF en `cc` no inyecta headers", () => {
    const mime = decodeMime(buildMimeEmail("a@b.com", "Hola", "Cuerpo", "c@d.com\nX-Inyectado: 1"));
    expect(mime).not.toMatch(/\r\nX-Inyectado:/);
    expect(mime).toContain("Cc: c@d.com X-Inyectado: 1");
  });

  it("email normal queda bien formado (To/Subject/cuerpo)", () => {
    const mime = decodeMime(buildMimeEmail("ana@ejemplo.com", "Visita confirmada", "Hola Ana,\n\nConfirmo la visita."));
    expect(mime).toContain("To: ana@ejemplo.com");
    expect(mime).toContain("Subject: Visita confirmada");
    expect(mime).toContain("Confirmo la visita.");
  });
});

describe("encodeHeaderValue", () => {
  it("ASCII puro pasa tal cual; no-ASCII va RFC 2047", () => {
    expect(encodeHeaderValue("Hello")).toBe("Hello");
    expect(encodeHeaderValue("mañana")).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });
});
