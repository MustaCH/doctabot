// Regla determinista de HONESTIDAD DE BÚSQUEDA (incidente "172 que se ajustan perfectamente"):
// claims sobre resultados de search_properties que los filtros realmente aplicados
// (applied_filters) no respaldan → rejected (dato_inventado). Precisión > recall.
import { describe, it, expect } from "vitest";
import { unsupportedSearchClaimVerdict } from "./supervisor-rules";

describe("unsupportedSearchClaimVerdict", () => {
  const filtersDefault = { only_active: true, docta_first: true, limit: 5 };

  it("claim superlativo ('se ajustan perfectamente') con búsqueda ejecutada → rejected dato_inventado", () => {
    const v = unsupportedSearchClaimVerdict(
      "Encontré 172 propiedades que se ajustan perfectamente a lo que buscás.",
      ["search_properties"],
      filtersDefault,
    );
    expect(v?.verdict).toBe("rejected");
    expect(v?.category).toBe("dato_inventado");
    expect(v?.reason).toMatch(/applied_filters/);
  });

  it("'100% de coincidencia' y 'resultados garantizados' → rejected (ningún filtro los respalda)", () => {
    expect(
      unsupportedSearchClaimVerdict("Estas opciones tienen 100% de coincidencia con el pedido.", ["search_properties"], filtersDefault)?.verdict,
    ).toBe("rejected");
    expect(
      unsupportedSearchClaimVerdict("Son resultados totalmente garantizados para tu cliente.", ["search_properties"], filtersDefault)?.verdict,
    ).toBe("rejected");
  });

  it("claim de vigencia ('publicaciones vigentes') SIN respaldo de only_active → rejected", () => {
    const v = unsupportedSearchClaimVerdict(
      "Todas las publicaciones están vigentes al día de hoy.",
      ["search_properties"],
      { only_active: false },
    );
    expect(v?.verdict).toBe("rejected");
    expect(v?.reason).toMatch(/only_active/);
  });

  it("m2: con eco NULL la regla de vigencia NO se evalúa (evita falsos positivos; el default real es only_active=true)", () => {
    expect(
      unsupportedSearchClaimVerdict("Todas las publicaciones están vigentes.", ["search_properties"], null),
    ).toBeNull();
    // El claim superlativo sigue rechazándose aun sin eco: ningún filtro puede respaldarlo.
    expect(
      unsupportedSearchClaimVerdict("Se ajustan perfectamente a lo que pediste.", ["search_properties"], null)?.verdict,
    ).toBe("rejected");
  });

  it("claim de vigencia CON only_active=true en applied_filters → null (respaldado)", () => {
    expect(
      unsupportedSearchClaimVerdict(
        "Te muestro 5 publicaciones activas de un total de 40.",
        ["search_properties"],
        { only_active: true },
      ),
    ).toBeNull();
  });

  it("sin search_properties en el turno → null (no hay resultados de búsqueda que evaluar)", () => {
    expect(
      unsupportedSearchClaimVerdict("Se ajustan perfectamente a lo que pediste.", ["list_clients"], filtersDefault),
    ).toBeNull();
    expect(unsupportedSearchClaimVerdict("", ["search_properties"], filtersDefault)).toBeNull();
  });

  it("presentación honesta (conteo con filtros aplicados) → null", () => {
    expect(
      unsupportedSearchClaimVerdict(
        "Te muestro 5 de 172 que coinciden con los filtros aplicados (venta, Nueva Córdoba, hasta USD 120.000). ¿Refinamos?",
        ["search_properties"],
        filtersDefault,
      ),
    ).toBeNull();
  });
});
