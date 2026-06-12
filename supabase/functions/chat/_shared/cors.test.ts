import { describe, it, expect } from "vitest";
import { base64Bytes, validateAttachmentSizes, MAX_ATTACHMENT_BYTES } from "./cors";

// Genera un string base64 que representa ~`bytes` bytes (4 chars base64 ≈ 3 bytes).
function b64OfBytes(bytes: number): string {
  return "A".repeat(Math.ceil((bytes * 4) / 3));
}

describe("base64Bytes", () => {
  it("estima los bytes de un base64 (con y sin padding)", () => {
    expect(base64Bytes("AAAA")).toBe(3);      // 4 chars, sin padding → 3 bytes
    expect(base64Bytes("AAA=")).toBe(2);
    expect(base64Bytes("AA==")).toBe(1);
  });
});

describe("validateAttachmentSizes", () => {
  it("acepta requests sin adjuntos o pequeños", () => {
    expect(validateAttachmentSizes([{ content: "hola" }])).toBeNull();
    expect(validateAttachmentSizes([{ attachments: [{ base64: b64OfBytes(1024) }] }])).toBeNull();
    expect(validateAttachmentSizes("no es array")).toBeNull();
  });

  it("rechaza un adjunto individual que supera el tope por archivo", () => {
    const huge = b64OfBytes(MAX_ATTACHMENT_BYTES + 1024);
    const err = validateAttachmentSizes([{ attachments: [{ base64: huge }] }]);
    expect(err).toMatch(/adjunto/i);
  });

  it("rechaza cuando la suma de adjuntos supera el tope total", () => {
    // 3 adjuntos de 9MB c/u = 27MB > 20MB total, ninguno supera el de 10MB por archivo.
    const nine = b64OfBytes(9 * 1024 * 1024);
    const err = validateAttachmentSizes([
      { attachments: [{ base64: nine }, { base64: nine }] },
      { attachments: [{ base64: nine }] },
    ]);
    expect(err).toMatch(/total/i);
  });

  it("ignora adjuntos sin base64 (reconstruidos con url)", () => {
    expect(validateAttachmentSizes([{ attachments: [{ url: "https://signed/x.png" }] }])).toBeNull();
  });
});
