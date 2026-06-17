import { describe, it, expect } from "vitest";
import { buildAIMessages, buildActiveClientBlock, SYSTEM_PROMPT } from "./prompt";
import { ALAN_CONTEXT_FACTS } from "./alan-facts";

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

// Regresión del bug 86aj1n43n (Alan re-saluda en turnos multi-tool). El fix vive como
// regla canónica en alan-facts.ts (la evalúa el supervisor) + prosa instruccional en el
// system prompt (CLAUDE.md regla 3: una sola fuente para el "qué", prosa para el "cómo").
// Estos tests fallan si se revierte cualquiera de las dos: blindan la PRESENCIA de la regla,
// no el comportamiento del modelo (que es probabilístico — eso se valida con repro manual).
describe("regla de continuidad en turnos multi-herramienta (no re-saludar)", () => {
  it("el system prompt instruye a no volver a saludar tras ejecutar una herramienta", () => {
    expect(SYSTEM_PROMPT).toContain("CONTINUIDAD DENTRO DE UN MISMO TURNO");
    expect(SYSTEM_PROMPT).toMatch(/NUNCA vuelvas a saludar/i);
    expect(SYSTEM_PROMPT).toMatch(/saludá una sola vez/i);
  });

  it("la regla canónica de continuidad está en alan-facts (la que evalúa el supervisor)", () => {
    expect(ALAN_CONTEXT_FACTS).toMatch(/continuidad en turnos multi-herramienta/i);
    expect(ALAN_CONTEXT_FACTS).toMatch(/saluda una sola vez/i);
    expect(ALAN_CONTEXT_FACTS).toMatch(/nunca vuelve a saludar/i);
  });
});

// Regresión del bug 86aj1pd8g (Alan pide datos del cliente sin verificar contactos primero).
// En una conversación nueva ("buscá para Armando") la conversación todavía NO está vinculada,
// así que el bloque CLIENTE ACTIVO no se inyecta y el modelo debe hacer el lookup él mismo y
// REUTILIZAR los criterios guardados del cliente como base de la búsqueda. Blindan la presencia
// de la regla (qué), no el comportamiento del modelo (probabilístico → repro manual).
describe("regla de apertura 'para [cliente]': reutilizar criterios guardados (86aj1pd8g)", () => {
  it("la regla canónica de reutilización de criterios está en alan-facts", () => {
    expect(ALAN_CONTEXT_FACTS).toMatch(/reutiliza.*criterios guardados/i);
    expect(ALAN_CONTEXT_FACTS).toMatch(/preferred_zones/);
    expect(ALAN_CONTEXT_FACTS).toMatch(/solo pide los criterios que realmente faltan/i);
  });

  it("el system prompt instruye a reutilizar los criterios del cliente y pedir solo lo que falta", () => {
    expect(SYSTEM_PROMPT).toMatch(/reutiliz[aá].*criterios guardados/i);
    expect(SYSTEM_PROMPT).toMatch(/ped[ií] solo lo que falte/i);
  });
});

// Regresión del bug 86aj1pd9z (mensaje huérfano: Alan narra el ida y vuelta interno de las
// herramientas — ambigüedad de save_property_to_client, reintentos — como si fuera un intercambio
// que el usuario vio). Con la supresión de preámbulos (86aj1n43n) el usuario solo ve la ronda
// final, que referencia pasos ocultos. La regla manda no narrar ese proceso interno y guardar por
// property_id exacto tras una búsqueda (evita la rama de ambigüedad).
describe("regla de proceso interno de herramientas: no narrarlo al usuario (86aj1pd9z)", () => {
  it("la regla canónica de no narrar el proceso interno está en alan-facts", () => {
    expect(ALAN_CONTEXT_FACTS).toMatch(/proceso de trabajo interno/i);
    expect(ALAN_CONTEXT_FACTS).toMatch(/el sistema me pidió que especifique/i); // anti-ejemplo explícito
    expect(ALAN_CONTEXT_FACTS).toMatch(/property_id exacto/i);
  });

  it("el system prompt instruye a no narrar el ida y vuelta interno", () => {
    expect(SYSTEM_PROMPT).toMatch(/proceso de trabajo interno/i);
    expect(SYSTEM_PROMPT).toMatch(/el sistema me pidió que especifique/i);
  });

  it("el system prompt instruye a guardar por property_id exacto tras una búsqueda", () => {
    expect(SYSTEM_PROMPT).toMatch(/property_id exacto/i);
  });
});
