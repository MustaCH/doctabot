import { describe, it, expect } from "vitest";
import { findMatchReasons, type PropertyRow, type ClientRow } from "./matching";

/** Property/Client mínimos para los tests de matching de zona por notas. */
function property(overrides: Partial<PropertyRow>): PropertyRow {
  return {
    id: "p1", zone: null, price: null, currency: null, property_type: null,
    title: null, locality: null, operation: null, address: null,
    m2_total: null, habitaciones: null, url: null,
    ...overrides,
  };
}
function client(overrides: Partial<ClientRow>): ClientRow {
  return {
    id: "c1", full_name: "Cliente", preferred_zones: null,
    budget_min: null, budget_max: null, budget_currency: null,
    property_type_interest: null, client_type: "buyer", notes: null,
    ...overrides,
  };
}

describe("findMatchReasons — zona por notas no cruza municipios", () => {
  it("no marca coincidencia de zona por una stopword como 'del' (San Salvador vs Falda del Carmen)", () => {
    // Caso real del ticket: la propiedad es de Falda del Carmen; el cliente busca en San Salvador
    // y su nota contiene "del" (de "cerca del trabajo"). "del" NO debe matchear la zona.
    const prop = property({ zone: "Falda del Carmen" });
    const cli = client({ notes: "Busca en San Salvador, algo cerca del trabajo" });

    const reasons = findMatchReasons(prop, cli);

    expect(reasons.some((r) => r.startsWith("📍"))).toBe(false);
  });

  it("sigue matcheando cuando la nota contiene una palabra distintiva de la zona", () => {
    const prop = property({ zone: "Falda del Carmen" });
    const cli = client({ notes: "Le interesa Falda del Carmen puntualmente" });

    const reasons = findMatchReasons(prop, cli);

    expect(reasons.some((r) => r.startsWith("📍"))).toBe(true);
  });
});
