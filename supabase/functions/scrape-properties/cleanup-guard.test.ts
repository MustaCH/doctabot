// Guardarraíl del cleanup del scraper: abortar el delete masivo ante corridas sospechosas
// (errores de página o % de borrado por encima del umbral). Ver cleanup-guard.ts.
import { describe, it, expect } from "vitest";
import { shouldAbortCleanup, CLEANUP_MAX_DELETE_RATIO, CLEANUP_MAX_PAGE_ERROR_RATIO } from "./cleanup-guard";

describe("shouldAbortCleanup", () => {
  it("sin filas a borrar nunca aborta (aunque haya errores)", () => {
    expect(shouldAbortCleanup({ pageErrors: 5, staleCount: 0, totalCount: 1000 }).abort).toBe(false);
  });

  it("sin totalPages conocido, cualquier error de página aborta (criterio binario conservador)", () => {
    const r = shouldAbortCleanup({ pageErrors: 2, staleCount: 10, totalCount: 1000 });
    expect(r.abort).toBe(true);
    expect(r.reason).toMatch(/error/);
  });

  it("m4: errores de página ≤5% del total NO abortan (la corrida sigue siendo representativa)", () => {
    expect(shouldAbortCleanup({ pageErrors: 2, staleCount: 10, totalCount: 1000, totalPages: 100 }).abort).toBe(false);
  });

  it("m4: errores de página >5% del total abortan con el detalle proporcional", () => {
    const r = shouldAbortCleanup({ pageErrors: 6, staleCount: 10, totalCount: 1000, totalPages: 100 });
    expect(r.abort).toBe(true);
    expect(r.reason).toMatch(/6 de 100/);
  });

  it("m4: el umbral de errores es configurable (maxPageErrorRatio)", () => {
    expect(shouldAbortCleanup({ pageErrors: 6, staleCount: 10, totalCount: 1000, totalPages: 100, maxPageErrorRatio: 0.10 }).abort).toBe(false);
  });

  it("m4: el default exportado de tolerancia de páginas es 5%", () => {
    expect(CLEANUP_MAX_PAGE_ERROR_RATIO).toBe(0.05);
  });

  it("ratio por encima del umbral default (30%) → aborta con el detalle", () => {
    const r = shouldAbortCleanup({ pageErrors: 0, staleCount: 400, totalCount: 1000 });
    expect(r.abort).toBe(true);
    expect(r.reason).toMatch(/400 de 1000/);
  });

  it("ratio por debajo del umbral y corrida limpia → no aborta", () => {
    expect(shouldAbortCleanup({ pageErrors: 0, staleCount: 200, totalCount: 1000 }).abort).toBe(false);
  });

  it("umbral configurable: con maxRatio 0.5 un 40% pasa", () => {
    expect(shouldAbortCleanup({ pageErrors: 0, staleCount: 400, totalCount: 1000, maxRatio: 0.5 }).abort).toBe(false);
  });

  it("el default exportado es 30%", () => {
    expect(CLEANUP_MAX_DELETE_RATIO).toBe(0.30);
  });
});
