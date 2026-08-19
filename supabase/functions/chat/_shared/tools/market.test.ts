import { describe, it, expect } from "vitest";
import { computeMarketStats, daysOnMarket, priceVsMedian, type MarketRow } from "./market";

const NOW = new Date("2026-08-19T12:00:00Z");

const row = (price: number | null, m2: number | null = 100, currency = "USD", createdDaysAgo = 30): MarketRow => ({
  price,
  currency,
  m2_total: m2,
  created_at: new Date(NOW.getTime() - createdDaysAgo * 86_400_000).toISOString(),
});

describe("computeMarketStats", () => {
  it("calcula mediana, rango y precio por m² por moneda", () => {
    const rows = [row(100_000, 100), row(120_000, 100), row(140_000, 100)];
    const s = computeMarketStats(rows, NOW);
    expect(s.sample).toBe(3);
    expect(s.by_currency).toHaveLength(1);
    const usd = s.by_currency[0];
    expect(usd.currency).toBe("USD");
    expect(usd.median_price).toBe(120_000);
    expect(usd.price_range).toEqual({ p25: 110_000, p75: 130_000 });
    expect(usd.price_per_m2).toEqual({ sample: 3, median: 1200, p25: 1100, p75: 1300 });
  });

  it("NUNCA mezcla monedas: USD y ARS salen como grupos separados (dominante primero)", () => {
    const rows = [row(100_000), row(120_000), row(500_000, 90, "ARS")];
    const s = computeMarketStats(rows, NOW);
    expect(s.by_currency.map((c) => c.currency)).toEqual(["USD", "ARS"]);
    expect(s.by_currency[1].median_price).toBe(500_000);
  });

  it("ignora precios null/0 para las medianas pero los cuenta en sample total", () => {
    const rows = [row(100_000), row(null), row(0)];
    const s = computeMarketStats(rows, NOW);
    expect(s.sample).toBe(3);
    expect(s.by_currency[0].sample).toBe(1);
    expect(s.by_currency[0].median_price).toBe(100_000);
  });

  it("price_per_m2 solo usa filas con m2_total > 0 (null si ninguna)", () => {
    const s = computeMarketStats([row(100_000, null), row(120_000, 0)], NOW);
    expect(s.by_currency[0].price_per_m2).toBeNull();
  });

  it("mediana de días en mercado + fecha del dato más reciente", () => {
    const rows = [row(1, 1, "USD", 10), row(1, 1, "USD", 20), row(1, 1, "USD", 90)];
    const s = computeMarketStats(rows, NOW);
    expect(s.median_days_on_market).toBe(20);
    expect(s.newest_listing_at).toBe(rows[0].created_at);
  });

  it("set vacío: sample 0, sin grupos, sin días", () => {
    const s = computeMarketStats([], NOW);
    expect(s).toEqual({ sample: 0, by_currency: [], median_days_on_market: null, newest_listing_at: null });
  });

  it("moneda null se agrupa como USD (default del mercado de venta)", () => {
    const s = computeMarketStats([{ price: 50_000, currency: null, m2_total: 50, created_at: null }], NOW);
    expect(s.by_currency[0].currency).toBe("USD");
  });
});

describe("daysOnMarket", () => {
  it("días redondeados desde created_at", () => {
    expect(daysOnMarket(new Date(NOW.getTime() - 45 * 86_400_000).toISOString(), NOW)).toBe(45);
  });
  it("null sin fecha o con fecha futura", () => {
    expect(daysOnMarket(null, NOW)).toBeNull();
    expect(daysOnMarket(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBeNull();
  });
});

describe("priceVsMedian", () => {
  const stats = computeMarketStats([row(100_000), row(120_000), row(140_000)], NOW);
  it("porcentaje con signo vs la mediana de SU moneda", () => {
    expect(priceVsMedian(132_000, "USD", stats)).toBe(10);
    expect(priceVsMedian(108_000, "USD", stats)).toBe(-10);
  });
  it("null sin precio o sin grupo comparable en esa moneda", () => {
    expect(priceVsMedian(null, "USD", stats)).toBeNull();
    expect(priceVsMedian(1_000_000, "ARS", stats)).toBeNull();
  });
});
