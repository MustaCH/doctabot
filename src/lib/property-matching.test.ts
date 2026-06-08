import { describe, it, expect } from "vitest";
import {
  normalizePropertyType,
  extractZoneFromTitle,
  extractTypeFromTitle,
  zonesMatch,
  parseNumberWithSuffix,
  findPropertyMatches,
  type ClientForMatch,
  type PropertyForMatch,
} from "./property-matching";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeClient(overrides: Partial<ClientForMatch> = {}): ClientForMatch {
  return {
    id: "c1",
    full_name: "Cliente Test",
    phone: null,
    email: null,
    preferred_zones: null,
    budget_min: null,
    budget_max: null,
    budget_currency: null,
    property_type_interest: null,
    status: "warm",
    client_type: "buyer",
    notes: null,
    last_contact_at: null,
    ...overrides,
  };
}

function makeProperty(overrides: Partial<PropertyForMatch> = {}): PropertyForMatch {
  return {
    zone: null,
    price: null,
    currency: null,
    property_type: null,
    title: null,
    locality: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizePropertyType
// ---------------------------------------------------------------------------

describe("normalizePropertyType", () => {
  it("maps a simple type to itself", () => {
    expect(normalizePropertyType("departamento")).toEqual(["departamento"]);
    expect(normalizePropertyType("casa")).toEqual(["casa"]);
  });

  it("expands ph into its synonyms", () => {
    expect(normalizePropertyType("ph")).toEqual(["ph", "duplex", "triplex"]);
  });

  it("treats duplex and ph as equivalent", () => {
    expect(normalizePropertyType("duplex")).toEqual(["duplex", "ph"]);
  });

  it("treats lote and terreno as equivalent", () => {
    expect(normalizePropertyType("lote")).toEqual(["terreno", "lote"]);
    expect(normalizePropertyType("terreno")).toEqual(["terreno", "lote"]);
  });

  it("normalizes underscores and casing in slugs", () => {
    expect(normalizePropertyType("DEPARTAMENTO_2_AMBIENTES")).toContain("departamento");
  });

  it("falls back to the cleaned input when nothing is recognized", () => {
    expect(normalizePropertyType("fabrica")).toEqual(["fabrica"]);
  });
});

// ---------------------------------------------------------------------------
// extractZoneFromTitle
// ---------------------------------------------------------------------------

describe("extractZoneFromTitle", () => {
  it("finds a known neighbourhood in the title", () => {
    expect(extractZoneFromTitle("Hermoso departamento en Nueva Córdoba")).toBe("nueva córdoba");
    expect(extractZoneFromTitle("Casa en Arguello")).toBe("arguello");
  });

  it("returns null when no known zone is present", () => {
    expect(extractZoneFromTitle("Propiedad sin barrio reconocible")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractTypeFromTitle
// ---------------------------------------------------------------------------

describe("extractTypeFromTitle", () => {
  it("detects duplex (and its ph synonym)", () => {
    const tokens = extractTypeFromTitle("Dúplex a estrenar");
    expect(tokens).toContain("duplex");
    expect(tokens).toContain("ph");
  });

  it("detects abbreviations like depto", () => {
    expect(extractTypeFromTitle("Depto 2 ambientes")).toContain("departamento");
  });

  it("detects lote/terreno", () => {
    const tokens = extractTypeFromTitle("Lote en venta");
    expect(tokens).toContain("lote");
    expect(tokens).toContain("terreno");
  });

  it("returns an empty array when no type keyword is present", () => {
    expect(extractTypeFromTitle("Oportunidad única")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// zonesMatch
// ---------------------------------------------------------------------------

describe("zonesMatch", () => {
  it("matches identical zones ignoring case/whitespace", () => {
    expect(zonesMatch("Nueva Córdoba", " nueva córdoba ")).toBe(true);
  });

  it("matches by substring containment", () => {
    expect(zonesMatch("nueva cordoba", "cordoba")).toBe(true);
  });

  it("does not match unrelated zones", () => {
    expect(zonesMatch("arguello", "villa allende")).toBe(false);
  });

  it("ignores short tokens (< 4 chars) for partial matching", () => {
    expect(zonesMatch("abc", "xyz")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseNumberWithSuffix
// ---------------------------------------------------------------------------

describe("parseNumberWithSuffix", () => {
  it("applies the k suffix (thousands)", () => {
    expect(parseNumberWithSuffix("110", "k")).toBe(110000);
  });

  it("applies the m suffix (millions)", () => {
    expect(parseNumberWithSuffix("2", "m")).toBe(2000000);
  });

  it("is case-insensitive on the suffix", () => {
    expect(parseNumberWithSuffix("50", "K")).toBe(50000);
  });

  it("strips thousands separators when there is no suffix", () => {
    expect(parseNumberWithSuffix("110.000")).toBe(110000);
    expect(parseNumberWithSuffix("90000")).toBe(90000);
  });
});

// ---------------------------------------------------------------------------
// findPropertyMatches (integration)
// ---------------------------------------------------------------------------

describe("findPropertyMatches", () => {
  it("matches on zone + type + budget (3 reasons)", () => {
    const property = makeProperty({
      zone: "Nueva Córdoba",
      property_type: "departamento",
      price: 95000,
      currency: "USD",
    });
    const client = makeClient({
      preferred_zones: "Nueva Córdoba",
      property_type_interest: "departamento",
      budget_max: 100000,
    });

    const result = findPropertyMatches(property, [client]);
    expect(result).toHaveLength(1);
    expect(result[0].matchReasons).toHaveLength(3);
  });

  it("never matches a seller", () => {
    const property = makeProperty({
      zone: "Nueva Córdoba",
      property_type: "departamento",
      price: 95000,
    });
    const client = makeClient({
      client_type: "seller",
      preferred_zones: "Nueva Córdoba",
      property_type_interest: "departamento",
      budget_max: 100000,
    });

    expect(findPropertyMatches(property, [client])).toHaveLength(0);
  });

  it("excludes a client when a mandatory zone preference does not match", () => {
    // Even though type + budget would match, a non-matching zone preference
    // discards the client entirely.
    const property = makeProperty({
      zone: "Centro",
      property_type: "departamento",
      price: 95000,
    });
    const client = makeClient({
      preferred_zones: "Arguello",
      property_type_interest: "departamento",
      budget_max: 100000,
    });

    expect(findPropertyMatches(property, [client])).toHaveLength(0);
  });

  it("requires at least 2 reasons (budget alone is not enough)", () => {
    const property = makeProperty({ price: 95000 });
    const client = makeClient({ budget_max: 100000 });

    expect(findPropertyMatches(property, [client])).toHaveLength(0);
  });

  it("includes prices up to 30% above budget_max but not beyond", () => {
    const base = {
      zone: "Centro",
      currency: "USD" as const,
    };
    const client = makeClient({ preferred_zones: "Centro", budget_max: 100000 });

    // Exactly +30% → included (zone + budget = 2 reasons)
    const atLimit = findPropertyMatches(makeProperty({ ...base, price: 130000 }), [client]);
    expect(atLimit).toHaveLength(1);
    expect(atLimit[0].matchReasons).toHaveLength(2);

    // Just over +30% → budget reason drops, only zone remains (< 2) → excluded
    const overLimit = findPropertyMatches(makeProperty({ ...base, price: 130001 }), [client]);
    expect(overLimit).toHaveLength(0);
  });

  it("does not count budget when currencies differ", () => {
    const client = makeClient({
      preferred_zones: "Centro",
      budget_max: 100000,
      budget_currency: "USD",
    });

    // Same currency → zone + budget = 2 reasons → match
    const sameCurrency = findPropertyMatches(
      makeProperty({ zone: "Centro", price: 90000, currency: "USD" }),
      [client]
    );
    expect(sameCurrency).toHaveLength(1);

    // Different currency → budget reason drops, only zone (< 2) → excluded
    const diffCurrency = findPropertyMatches(
      makeProperty({ zone: "Centro", price: 90000, currency: "ARS" }),
      [client]
    );
    expect(diffCurrency).toHaveLength(0);
  });

  it("sorts matches by number of reasons, descending", () => {
    const property = makeProperty({
      zone: "Nueva Córdoba",
      property_type: "departamento",
      price: 95000,
      currency: "USD",
    });
    const threeReasons = makeClient({
      id: "three",
      preferred_zones: "Nueva Córdoba",
      property_type_interest: "departamento",
      budget_max: 100000,
    });
    const twoReasons = makeClient({
      id: "two",
      preferred_zones: "Nueva Córdoba",
      budget_max: 100000,
    });

    const result = findPropertyMatches(property, [twoReasons, threeReasons]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("three");
    expect(result[0].matchReasons.length).toBeGreaterThanOrEqual(result[1].matchReasons.length);
  });

  it("does not double-count the property type when notes also mention it", () => {
    // A client matched on type via structured data AND whose notes mention the
    // same type must NOT accumulate two type reasons. (Regression test for the
    // 🏗️ dedup bug: substring(0,2) split the emoji's variation selector.)
    const property = makeProperty({
      zone: "Centro",
      property_type: "departamento",
      price: 95000,
      currency: "USD",
    });
    const client = makeClient({
      preferred_zones: "Centro",
      property_type_interest: "departamento",
      budget_max: 100000,
      notes: "Busca un departamento luminoso",
    });

    const result = findPropertyMatches(property, [client]);
    expect(result).toHaveLength(1);

    const typeReasons = result[0].matchReasons.filter((r) => r.startsWith("🏗️"));
    expect(typeReasons).toHaveLength(1);
    // zone + type + budget = exactly 3 reasons (no duplicated type).
    expect(result[0].matchReasons).toHaveLength(3);
  });
});
