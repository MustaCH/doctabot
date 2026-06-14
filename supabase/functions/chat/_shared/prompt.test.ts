import { describe, it, expect } from "vitest";
import { buildAIMessages, buildActiveClientBlock } from "./prompt";

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

describe("buildActiveClientBlock", () => {
  it("sin cliente (conversación no vinculada o sin conversationId) no inyecta nada", () => {
    expect(buildActiveClientBlock(null)).toBe("");
    expect(buildActiveClientBlock(undefined)).toBe("");
    expect(buildActiveClientBlock({})).toBe("");
    expect(buildActiveClientBlock({ full_name: "" })).toBe("");
  });

  it("conversación vinculada incluye el bloque con nombre, estado y tipo siempre", () => {
    const block = buildActiveClientBlock({ full_name: "María González", status: "hot", client_type: "buyer" });
    expect(block).toContain("CLIENTE ACTIVO EN ESTA CONVERSACIÓN");
    expect(block).toContain("María González");
    expect(block).toContain("hot");
    expect(block).toContain("buyer");
    // instrucción de no re-preguntar
    expect(block).toMatch(/NO vuelvas a preguntar/i);
  });

  it("solo incluye los campos no-null", () => {
    const block = buildActiveClientBlock({
      full_name: "Juan Pérez",
      status: "warm",
      client_type: "both",
      phone: "+5493511234567",
      preferred_zones: "Nueva Córdoba, Centro",
      budget_max: 120000,
      budget_currency: "USD",
      property_type_interest: "Departamento 2 amb",
    });
    expect(block).toContain("+5493511234567");
    expect(block).toContain("Nueva Córdoba, Centro");
    expect(block).toContain("USD");
    expect(block).toContain("Departamento 2 amb");
    // campos ausentes no aparecen
    expect(block).not.toContain("Email:");
    expect(block).not.toContain("Cumpleaños:");
    expect(block).not.toContain("Empresa");
  });

  it("renderiza presupuesto como rango cuando hay min y max", () => {
    const block = buildActiveClientBlock({ full_name: "Ana", budget_min: 80000, budget_max: 120000, budget_currency: "USD" });
    expect(block).toMatch(/Presupuesto: USD 80\.000.120\.000/);
  });
});
