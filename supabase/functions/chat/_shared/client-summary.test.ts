import { describe, it, expect } from "vitest";
import { sanitizeSummary, buildSummaryMessages, AI_SUMMARY_MAX_CHARS } from "./client-summary";

describe("sanitizeSummary", () => {
  it("strippea marcadores de formato del chat (no pueden viajar al system del turno siguiente)", () => {
    const s = sanitizeSummary("Vio el depto <<<PROPERTIES>>> y dijo ===MSG_BREAK=== que [REFERENCIA]le gusta[FIN REFERENCIA].");
    expect(s).not.toMatch(/<<<|===|REFERENCIA/);
    expect(s).toContain("Vio el depto");
    expect(s).toContain("le gusta");
  });

  it("colapsa espacios y aplica el tope de caracteres", () => {
    const s = sanitizeSummary("a  \n\n b" + "x".repeat(AI_SUMMARY_MAX_CHARS * 2));
    expect(s.startsWith("a b")).toBe(true);
    expect(s.length).toBe(AI_SUMMARY_MAX_CHARS);
  });

  it("null/undefined/vacío → string vacío", () => {
    expect(sanitizeSummary(null)).toBe("");
    expect(sanitizeSummary(undefined)).toBe("");
    expect(sanitizeSummary("   ")).toBe("");
  });
});

describe("buildSummaryMessages", () => {
  it("incluye nombre del cliente, resumen previo y el intercambio truncado", () => {
    const msgs = buildSummaryMessages({
      clientName: "Ana Pérez",
      prevSummary: "Busca depto en Nueva Córdoba.",
      userMessage: "u".repeat(5000),
      assistantMessage: "a".repeat(5000),
    });
    expect(msgs[0].content).toContain("Ana Pérez");
    expect(msgs[1].content).toContain("Busca depto en Nueva Córdoba.");
    expect(msgs[1].content.length).toBeLessThan(2000 + 3000 + 200); // truncado
  });

  it("sin resumen previo usa el placeholder explícito", () => {
    const msgs = buildSummaryMessages({ clientName: "Ana", prevSummary: null, userMessage: "hola", assistantMessage: "hola" });
    expect(msgs[1].content).toContain("(sin resumen previo)");
  });

  it("el system instruye devolver el anterior si no hay nada nuevo (anti-drift)", () => {
    const msgs = buildSummaryMessages({ clientName: "Ana", prevSummary: "x", userMessage: "hola", assistantMessage: "¡hola!" });
    expect(msgs[0].content).toMatch(/no aporta nada nuevo[\s\S]*resumen anterior/i);
  });
});
