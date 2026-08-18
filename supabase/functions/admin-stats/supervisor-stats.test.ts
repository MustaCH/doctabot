// Tests de computeScoreStats (ticket 86aj9w5kq): el avgScore del panel admin tiene que
// promediar SOLO scores LLM 1-10, separando los rechazos deterministas (score fijo 2-3).
import { describe, it, expect } from "vitest";
import { computeScoreStats, DETERMINISTIC_REASON } from "./supervisor-stats";

describe("computeScoreStats", () => {
  it("separa rechazos deterministas (prefijo nuevo y templates legacy) del promedio LLM", () => {
    const rows = [
      { score: 8, rejection_reason: null }, // approved LLM
      { score: 6, rejection_reason: "Respuesta incompleta" }, // rejected LLM
      { score: 2, rejection_reason: "[determinista] Afirmó una acción de escritura (email) que NO se ejecutó" },
      { score: 2, rejection_reason: 'Afirmó una acción de escritura (email) que NO se ejecutó: posible "guardado fantasma" (tool emitida como texto o alucinada).' }, // legacy sin prefijo
      { score: 3, rejection_reason: "Claim de vigencia ('activas') sin respaldo del filtro only_active en applied_filters." }, // legacy
    ];
    const stats = computeScoreStats(rows);
    expect(stats.avgScore).toBe(7); // (8+6)/2 — los deterministas no arrastran el promedio
    expect(stats.sampleSize).toBe(2);
    expect(stats.deterministicRejected).toBe(3);
  });

  it("excluye score null (unevaluated) y score 0 (error) como antes", () => {
    const stats = computeScoreStats([
      { score: null, rejection_reason: "Supervisor no pudo evaluar (sin tool call)" },
      { score: 0, rejection_reason: "Supervisor API error" },
      { score: 9, rejection_reason: null },
    ]);
    expect(stats.avgScore).toBe(9);
    expect(stats.sampleSize).toBe(1);
    expect(stats.deterministicRejected).toBe(0);
  });

  it("sin scores LLM → avgScore 0, no NaN", () => {
    const stats = computeScoreStats([
      { score: 2, rejection_reason: "[determinista] Pedido de lectura de datos sin ejecutar la tool" },
    ]);
    expect(stats.avgScore).toBe(0);
    expect(stats.sampleSize).toBe(0);
    expect(stats.deterministicRejected).toBe(1);
  });

  it("DETERMINISTIC_REASON no matchea reasons LLM comunes", () => {
    for (const reason of ["Respuesta correcta y accionable", "Inventó un precio", "Formato de draft roto", ""]) {
      expect(DETERMINISTIC_REASON.test(reason)).toBe(false);
    }
  });
});
