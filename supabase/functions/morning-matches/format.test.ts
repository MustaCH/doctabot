import { describe, it, expect } from "vitest";
import { formatPropertyLine, buildClientSearchSummary } from "./format";
import type { PropertyRow, ClientRow } from "./matching";

function property(overrides: Partial<PropertyRow>): PropertyRow {
  return {
    id: "p1", zone: null, price: null, currency: null, property_type: null,
    title: null, locality: null, operation: null, address: null,
    m2_total: null, habitaciones: null, photo: null, url: null,
    ...overrides,
  };
}
function client(overrides: Partial<ClientRow>): ClientRow {
  return {
    id: "c1", full_name: "Cliente", preferred_zones: null,
    budget_min: null, budget_max: null, budget_currency: null,
    property_type_interest: null, client_type: "buyer", status: null, notes: null,
    ...overrides,
  };
}

describe("formatPropertyLine — foto principal", () => {
  it("incluye la foto principal como imagen markdown cuando hay photo", () => {
    const line = formatPropertyLine(property({
      title: "Depto en Nueva Córdoba",
      photo: "https://cdn.example.com/foto.jpg",
    }));
    expect(line).toContain("![Depto en Nueva Córdoba](https://cdn.example.com/foto.jpg)");
  });

  it("no incluye línea de imagen cuando photo es null", () => {
    const line = formatPropertyLine(property({ title: "Depto", photo: null }));
    expect(line).not.toContain("![");
  });
});

describe("formatPropertyLine — dormitorios (no ambientes ni 'hab.')", () => {
  it("muestra 'dormitorios' en plural y nunca 'hab.'", () => {
    const line = formatPropertyLine(property({ m2_total: 80, habitaciones: 2 }));
    expect(line).toContain("2 dormitorios");
    expect(line).not.toContain("hab.");
  });

  it("usa singular 'dormitorio' cuando es 1", () => {
    const line = formatPropertyLine(property({ habitaciones: 1 }));
    expect(line).toContain("1 dormitorio");
    expect(line).not.toContain("1 dormitorios");
  });

  it("omite los dormitorios cuando es 0 (ej. terreno)", () => {
    const line = formatPropertyLine(property({ m2_total: 300, habitaciones: 0 }));
    expect(line).not.toContain("dormitorio");
  });
});

describe("buildClientSearchSummary — calificación frío/templado/caliente", () => {
  it("agrega la calificación del cliente al resumen", () => {
    const summary = buildClientSearchSummary(client({
      property_type_interest: "departamento",
      preferred_zones: "Nueva Córdoba",
      budget_max: 120000,
      status: "hot",
    }));
    expect(summary).toContain("🔥 Caliente");
  });

  it("mapea warm→Templado y cold→Frío", () => {
    expect(buildClientSearchSummary(client({ preferred_zones: "Centro", status: "warm" })))
      .toContain("☀️ Templado");
    expect(buildClientSearchSummary(client({ preferred_zones: "Centro", status: "cold" })))
      .toContain("❄️ Frío");
  });

  it("no agrega calificación cuando status es null", () => {
    const summary = buildClientSearchSummary(client({ preferred_zones: "Centro", status: null }));
    expect(summary).not.toContain("🔥");
    expect(summary).not.toContain("☀️");
    expect(summary).not.toContain("❄️");
  });
});
