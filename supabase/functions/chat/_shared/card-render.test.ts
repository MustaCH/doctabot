import { describe, it, expect } from "vitest";
import { buildListingUrl, renderPropertyCard, expandCards, collapseEmptyBubbles } from "./card-render";
import { MSG_BREAK } from "./alan-facts";

// Propiedad real del incidente 86ajangkb (fec68fa6 — la única tarjeta cuyo link funcionó en el bug).
const P = {
  id: "fec68fa6-b5c2-406b-8006-f48a1ef52e89",
  title: "ALQUILER DEPARTAMENTO 1 DORMITORIO B° NVA CÓRDOBA",
  office: "REMAX Boulevard",
  price: "750000",
  currency: "ARS",
  price_exposure: true,
  expenses_price: "174000",
  expenses_currency: "ARS",
  address: "Obispo Salguero 500",
  locality: "Nueva Cordoba, Cordoba, Capital, Córdoba",
  zone_neighborhood: "nueva cordoba",
  m2_total: "59",
  habitaciones: 1,
  banos: 1,
  url: "https://www.remax.com.ar/listings/alquiler-departamento-1-dormitorio-b-nva-cordoba",
  photo: "https://d1acdg20u0pmxj.cloudfront.net/listings/5f4c9f1f/x.webp",
};
const P2 = { ...P, title: "DEPTO 2", url: "https://www.remax.com.ar/listings/depto-2", photo: "https://cdn/x2.webp" };

describe("buildListingUrl", () => {
  it("agrega ?associate cuando no hay query", () => {
    expect(buildListingUrl("https://www.remax.com.ar/listings/x", "42040122"))
      .toBe("https://www.remax.com.ar/listings/x?associate=42040122");
  });
  it("agrega &associate cuando la URL ya tiene query", () => {
    expect(buildListingUrl("https://www.remax.com.ar/listings/x?a=1", "42040122"))
      .toBe("https://www.remax.com.ar/listings/x?a=1&associate=42040122");
  });
  it("sin agentCode devuelve la URL intacta", () => {
    expect(buildListingUrl("https://www.remax.com.ar/listings/x")).toBe("https://www.remax.com.ar/listings/x");
    expect(buildListingUrl("https://www.remax.com.ar/listings/x", "")).toBe("https://www.remax.com.ar/listings/x");
  });
});

describe("renderPropertyCard", () => {
  it("arma la tarjeta con el slug EXACTO de la DB + atribución", () => {
    const card = renderPropertyCard(P, "42040122");
    expect(card).toContain("🔗 [Ver propiedad](https://www.remax.com.ar/listings/alquiler-departamento-1-dormitorio-b-nva-cordoba?associate=42040122)");
    expect(card).toContain("![foto](https://d1acdg20u0pmxj.cloudfront.net/listings/5f4c9f1f/x.webp)");
    expect(card).toContain("🏠 **ALQUILER DEPARTAMENTO 1 DORMITORIO B° NVA CÓRDOBA**");
    expect(card).toContain("🏢 REMAX Boulevard");
    expect(card).toContain("💰 Precio: ARS 750000");
    expect(card).toContain("Expensas: $174000 ARS/mes");
    expect(card).toContain("📍 Ubicación: Obispo Salguero 500, Nueva Cordoba, Cordoba, Capital, Córdoba (nueva cordoba)");
    expect(card).toContain("📐 Superficie: 59 m² totales (1 hab · 1 baños)");
  });

  it("price_exposure=false → 'a consultar' y sin monto", () => {
    const card = renderPropertyCard({ ...P, price_exposure: false }, "1");
    expect(card).toContain("💰 Precio: a consultar");
    expect(card).not.toContain("750000");
  });

  it("omite líneas de datos faltantes", () => {
    const card = renderPropertyCard(
      { title: "Depto", price: "100", currency: "USD", url: "https://www.remax.com.ar/listings/y" }, "1");
    expect(card).not.toContain("![foto]");
    expect(card).not.toContain("🏢");
    expect(card).not.toContain("Expensas");
    expect(card).not.toContain("📐");
    expect(card).toContain("🔗 [Ver propiedad](https://www.remax.com.ar/listings/y?associate=1)");
  });

  it("sin url no pone línea de link (nunca inventa uno)", () => {
    expect(renderPropertyCard({ title: "X", url: null }, "1")).not.toContain("🔗");
  });
});

describe("expandCards — matching por POSICIÓN (inmune a ids inventados por el modelo)", () => {
  it("<<<PROPERTIES>>> vuelca TODOS los resultados en orden", () => {
    const input = `Intro${MSG_BREAK}<<<PROPERTIES>>>${MSG_BREAK}Cierre`;
    const { text, rendered, leftover } = expandCards(input, [P, P2], "42040122");
    expect(rendered).toBe(2);
    expect(leftover).toEqual([]);
    expect(text).not.toContain("<<<PROPERTIES>>>");
    expect(text).toContain("🏠 **ALQUILER DEPARTAMENTO 1 DORMITORIO B° NVA CÓRDOBA**");
    expect(text).toContain("🏠 **DEPTO 2**");
    expect(text).toContain("?associate=42040122");
  });

  it("tokens <<<CARD>>> por posición: el ref (si viene) se IGNORA — no depende de que el modelo lo acierte", () => {
    // El modelo emite refs 'inventados'/renumerados; igual mapean por orden a P, P2.
    const input = `<<<CARD:zzz>>>${MSG_BREAK}<<<CARD:otro-ref-cualquiera>>>`;
    const { text, rendered } = expandCards(input, [P, P2], "1");
    expect(rendered).toBe(2);
    expect(text).toContain("🏠 **ALQUILER DEPARTAMENTO 1 DORMITORIO B° NVA CÓRDOBA**");
    expect(text).toContain("🏠 **DEPTO 2**");
  });

  it("si hay más resultados que marcadores, los sobrantes quedan en leftover (para anexarlos)", () => {
    const { rendered, leftover } = expandCards("<<<CARD>>>", [P, P2], "1");
    expect(rendered).toBe(1);
    expect(leftover).toEqual([P2]);
  });

  it("sin resultados, el marcador se reemplaza por vacío (nunca token crudo)", () => {
    const { text, rendered } = expandCards(`a${MSG_BREAK}<<<PROPERTIES>>>${MSG_BREAK}b`, [], "1");
    expect(rendered).toBe(0);
    expect(text).not.toContain("<<<PROPERTIES>>>");
  });

  it("sin marcadores, hadMarker=false y todos los resultados quedan en leftover", () => {
    const { hadMarker, leftover } = expandCards("respuesta sin marcador", [P, P2], "1");
    expect(hadMarker).toBe(false);
    expect(leftover).toEqual([P, P2]);
  });
});

describe("collapseEmptyBubbles", () => {
  it("elimina segmentos vacíos entre separadores (evita burbujas fantasma)", () => {
    const input = `Intro${MSG_BREAK}${MSG_BREAK}${MSG_BREAK}Cierre`;
    const out = collapseEmptyBubbles(input);
    expect(out).toBe(`Intro\n${MSG_BREAK}\nCierre`);
  });
  it("texto sin separadores pasa intacto", () => {
    expect(collapseEmptyBubbles("hola")).toBe("hola");
  });
});
