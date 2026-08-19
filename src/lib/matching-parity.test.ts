// Test de paridad front↔back del matching (ticket 86aj9w5p3 / T3.4).
// Tras la unificación, ambos lados deben exponer LAS MISMAS funciones del núcleo
// compartido (identidad de referencia, no solo igualdad de comportamiento): si alguien
// vuelve a copiar una implementación local en cualquiera de los dos, este test falla.
import { describe, it, expect } from "vitest";
import * as front from "./property-matching";
import * as back from "../../supabase/functions/morning-matches/matching";
import * as core from "../../supabase/functions/_shared/matching-core";

describe("paridad front↔back (núcleo compartido)", () => {
  it("los primitivos son EL MISMO objeto en front, back y núcleo", () => {
    for (const fn of ["normalizePropertyType", "extractZoneFromTitle", "extractTypeFromTitle", "extractClientZonesFromNotes", "zonesMatch", "parseNumberWithSuffix", "minReasonsFor"] as const) {
      expect(front[fn], `front.${fn} no es el del núcleo`).toBe(core[fn]);
      expect(back[fn], `back.${fn} no es el del núcleo`).toBe(core[fn]);
    }
    expect(front.budgetCeilingFloor).toBe(core.budgetCeilingFloor);
    expect(front.BUDGET_MARGIN).toBe(core.BUDGET_MARGIN);
    expect(back.MIN_MATCH_REASONS).toBe(core.MIN_MATCH_REASONS);
  });

  it("los patrones de título son superset de los de notas (notas = lista conservadora)", () => {
    const titleSources = new Set(core.ZONE_PATTERNS_TITLE.map((r) => r.source));
    for (const r of core.ZONE_PATTERNS_NOTES) {
      expect(titleSources.has(r.source), `patrón de notas ausente en títulos: ${r.source}`).toBe(true);
    }
  });

  it("fix del dedup por emoji (T3.4): el tipo desde notas NO se duplica cuando ya hay reason estructurado", () => {
    // "🏗️" son 3 unidades UTF-16: substring(0,2) producía "🏗" y el dedup nunca matcheaba.
    const reasons = back.findMatchReasons(
      { id: "p1", zone: "Nueva Córdoba", price: null, currency: null, property_type: "Departamento", title: "Depto", locality: null, operation: null, address: null, m2_total: null, habitaciones: null, photo: null, url: null },
      { id: "c1", full_name: "Ana", preferred_zones: "Nueva Córdoba", budget_min: null, budget_max: null, budget_currency: null, property_type_interest: "departamento", client_type: "buyer", status: "hot", notes: "quiere un departamento luminoso" },
    );
    expect(reasons.filter((r) => r.startsWith("🏗️")).length).toBe(1);
  });

  it("comportamiento idéntico front↔back para el mismo caso buyer→propiedad", () => {
    const property = { zone: "Manantiales", price: 100000, currency: "USD", property_type: "Casa", title: "Casa 3 dorm", locality: "Córdoba" };
    const clientBase = {
      id: "c1", full_name: "Ana", phone: null, email: null,
      preferred_zones: "Manantiales", budget_min: null, budget_max: 110000, budget_currency: "USD",
      property_type_interest: "casa", status: "hot", client_type: "buyer", is_client: true,
      notes: null, last_contact_at: null,
    };
    const frontReasons = front.computeMatchReasons(property, clientBase, front.computeEffectiveZone(property), front.computeEffectiveTypeTokens(property));
    const backReasons = back.findMatchReasons(
      { id: "p1", ...property, operation: null, address: null, m2_total: null, habitaciones: null, photo: null, url: null },
      { id: "c1", full_name: "Ana", preferred_zones: "Manantiales", budget_min: null, budget_max: 110000, budget_currency: "USD", property_type_interest: "casa", client_type: "buyer", status: "hot", notes: null },
    );
    expect(frontReasons).toEqual(backReasons);
  });
});
