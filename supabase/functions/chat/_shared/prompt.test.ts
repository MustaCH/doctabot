import { describe, it, expect } from "vitest";
import { buildAIMessages } from "./prompt";

describe("buildAIMessages", () => {
  it("mensaje de texto plano pasa sin cambios", () => {
    expect(buildAIMessages([{ role: "user", content: "hola" }])).toEqual([
      { role: "user", content: "hola" },
    ]);
  });

  it("imagen en base64 (turno en vivo) se manda como data URI", () => {
    const out = buildAIMessages([
      { role: "user", content: "mirá", attachments: [{ type: "image", base64: "AAAA", mimeType: "image/png" }] },
    ]);
    expect(out[0].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "text", text: "mirá" },
    ]);
  });

  it("imagen reconstruida desde Storage (reload) se manda como URL firmada", () => {
    const out = buildAIMessages([
      { role: "user", content: "mirá", attachments: [{ type: "image", url: "https://signed/url.png", mimeType: "image/png" }] },
    ]);
    expect(out[0].content[0]).toEqual({ type: "image_url", image_url: { url: "https://signed/url.png" } });
  });

  it("adjunto sin base64 ni url (ej. PDF) no agrega image_url; el texto va igual", () => {
    const out = buildAIMessages([
      { role: "user", content: "resumime esto", attachments: [{ type: "file", mimeType: "application/pdf", fileName: "x.pdf" }] },
    ]);
    expect(out[0].content).toEqual([{ type: "text", text: "resumime esto" }]);
  });

  it("imagen sin texto usa el prompt por defecto", () => {
    const out = buildAIMessages([
      { role: "user", content: "", attachments: [{ type: "image", base64: "AAAA", mimeType: "image/png" }] },
    ]);
    expect(out[0].content).toContainEqual({ type: "text", text: "Analizá esta imagen y describí lo que ves." });
  });
});
