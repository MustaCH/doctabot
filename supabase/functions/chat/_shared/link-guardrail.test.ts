import { describe, it, expect } from "vitest";
import { extractListingSlugs, neutralizeFabricatedListings } from "./link-guardrail";

describe("extractListingSlugs", () => {
  it("extrae slugs distintos de listings de remax (ignora otras URLs)", () => {
    const text = `
      [Ver](https://www.remax.com.ar/listings/venta-depto-1-dormitorio-centro-cordoba?associate=420401250)
      https://www.remax.com.ar/listings/venta-departamento-1-dormitorio-b-centro
      https://www.zonaprop.com.ar/inmuebles-venta-cordoba.html
      https://www.remax.com.ar/agente/juan
    `;
    expect(extractListingSlugs(text).sort()).toEqual([
      "venta-departamento-1-dormitorio-b-centro",
      "venta-depto-1-dormitorio-centro-cordoba",
    ]);
  });

  it("dedupe y case-insensitive del host; texto vacío → []", () => {
    expect(extractListingSlugs("")).toEqual([]);
    const t = "HTTP://REMAX.COM.AR/listings/abc-def y https://www.remax.com.ar/listings/abc-def";
    expect(extractListingSlugs(t)).toEqual(["abc-def"]);
  });
});

describe("neutralizeFabricatedListings", () => {
  const valid = new Set(["venta-depto-1-dormitorio-centro-cordoba", "venta-departamento-1-dormitorio-b-centro"]);

  it("markdown con slug inventado → deja el texto, quita el link muerto", () => {
    const { text, removed } = neutralizeFabricatedListings(
      "Mirá [esta opción](https://www.remax.com.ar/listings/venta-dpto-1-dormitorio-centro-cordoba?associate=420401250) buenísima",
      valid,
    );
    expect(removed).toEqual(["venta-dpto-1-dormitorio-centro-cordoba"]);
    expect(text).toBe("Mirá esta opción buenísima");
    expect(text).not.toContain("remax.com.ar");
  });

  it("markdown con slug REAL → no toca nada", () => {
    const input = "Mirá [esta](https://www.remax.com.ar/listings/venta-depto-1-dormitorio-centro-cordoba?associate=420401250)";
    const { text, removed } = neutralizeFabricatedListings(input, valid);
    expect(removed).toEqual([]);
    expect(text).toBe(input);
  });

  it("URL suelta inventada → se elimina", () => {
    const { text, removed } = neutralizeFabricatedListings(
      "Te paso el link: https://www.remax.com.ar/listings/departamento-de-1-dormitorio-en-venta-en-alberdi para que la veas",
      valid,
    );
    expect(removed).toEqual(["departamento-de-1-dormitorio-en-venta-en-alberdi"]);
    expect(text).not.toContain("remax.com.ar");
    expect(text).toContain("Te paso el link:");
    expect(text).toContain("para que la veas");
  });

  it("URL suelta REAL → intacta", () => {
    const input = "Link: https://www.remax.com.ar/listings/venta-departamento-1-dormitorio-b-centro?associate=420401250";
    const { text, removed } = neutralizeFabricatedListings(input, valid);
    expect(removed).toEqual([]);
    expect(text).toBe(input);
  });

  it("caso real del incidente: las 3 inventadas se neutralizan, la real queda", () => {
    const msg = [
      "1. [Centro con balcón](https://www.remax.com.ar/listings/venta-departamento-1-dormitorio-con-balcon-b-centro?associate=420401250)",
      "2. [Alberdi amplio](https://www.remax.com.ar/listings/departamento-de-1-dormitorio-en-venta-en-alberdi?associate=420401250)",
      "3. [Centro real](https://www.remax.com.ar/listings/venta-depto-1-dormitorio-centro-cordoba?associate=420401250)",
    ].join("\n");
    const { text, removed } = neutralizeFabricatedListings(msg, valid);
    expect(removed.sort()).toEqual([
      "departamento-de-1-dormitorio-en-venta-en-alberdi",
      "venta-departamento-1-dormitorio-con-balcon-b-centro",
    ]);
    // La #3 (slug real) conserva su link; las #1 y #2 quedan como texto sin link.
    expect(text).toContain("(https://www.remax.com.ar/listings/venta-depto-1-dormitorio-centro-cordoba?associate=420401250)");
    expect(text).toContain("Centro con balcón");
    expect(text).toContain("Alberdi amplio");
    expect(text).not.toContain("con-balcon-b-centro");
    expect(text).not.toContain("en-venta-en-alberdi");
  });

  it("set vacío de válidos → neutraliza todo listing de remax", () => {
    const { text, removed } = neutralizeFabricatedListings(
      "[a](https://www.remax.com.ar/listings/uno) y https://www.remax.com.ar/listings/dos",
      new Set(),
    );
    expect(removed.sort()).toEqual(["dos", "uno"]);
    expect(text).not.toContain("remax.com.ar");
  });

  it("texto sin links → sin cambios", () => {
    const { text, removed } = neutralizeFabricatedListings("No hay propiedades que coincidan.", valid);
    expect(removed).toEqual([]);
    expect(text).toBe("No hay propiedades que coincidan.");
  });
});
