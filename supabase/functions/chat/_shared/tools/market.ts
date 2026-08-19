// Estadísticas de mercado sobre filas REALES de `properties` (ticket 86aj9w5pv).
// Puro (sin supabase): lo consumen los cases market_stats / negotiation_brief del executor,
// que hacen la query y delegan acá el cálculo. Testeable offline en market.test.ts.

export interface MarketRow {
  price: number | null;
  currency: string | null;
  m2_total: number | null;
  created_at: string | null;
}

export interface CurrencyStats {
  currency: string;
  sample: number;
  median_price: number;
  price_range: { p25: number; p75: number };
  /** Solo sobre filas con price>0 y m2_total>0; null si ninguna califica. */
  price_per_m2: { sample: number; median: number; p25: number; p75: number } | null;
}

export interface MarketStats {
  sample: number;
  by_currency: CurrencyStats[];
  /** Mediana de días publicadas (created_at → hoy) sobre filas con fecha; null sin fechas. */
  median_days_on_market: number | null;
  /** created_at más reciente del set: qué tan fresco es el dato. */
  newest_listing_at: string | null;
}

/** Percentil por interpolación lineal sobre una lista YA ordenada ascendente. */
function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Calcula las estadísticas de mercado de un set de propiedades, agrupadas por moneda
 * (USD y ARS no se mezclan jamás en una mediana). `now` inyectable para tests.
 */
export function computeMarketStats(rows: MarketRow[], now: Date = new Date()): MarketStats {
  const withPrice = rows.filter((r) => typeof r.price === "number" && r.price > 0);
  const byCurrency = new Map<string, MarketRow[]>();
  for (const r of withPrice) {
    const cur = (r.currency ?? "USD").toUpperCase();
    const list = byCurrency.get(cur) ?? [];
    list.push(r);
    byCurrency.set(cur, list);
  }

  const by_currency: CurrencyStats[] = [...byCurrency.entries()]
    .map(([currency, list]) => {
      const prices = list.map((r) => r.price as number).sort((a, b) => a - b);
      const perM2 = list
        .filter((r) => typeof r.m2_total === "number" && (r.m2_total as number) > 0)
        .map((r) => (r.price as number) / (r.m2_total as number))
        .sort((a, b) => a - b);
      return {
        currency,
        sample: list.length,
        median_price: round2(percentileSorted(prices, 0.5)),
        price_range: { p25: round2(percentileSorted(prices, 0.25)), p75: round2(percentileSorted(prices, 0.75)) },
        price_per_m2: perM2.length > 0
          ? { sample: perM2.length, median: round2(percentileSorted(perM2, 0.5)), p25: round2(percentileSorted(perM2, 0.25)), p75: round2(percentileSorted(perM2, 0.75)) }
          : null,
      };
    })
    .sort((a, b) => b.sample - a.sample); // la moneda dominante primero

  const days = rows
    .map((r) => (r.created_at ? (now.getTime() - new Date(r.created_at).getTime()) / 86_400_000 : null))
    .filter((d): d is number => d !== null && Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  const newest = rows.reduce<string | null>((acc, r) => (r.created_at && (!acc || r.created_at > acc) ? r.created_at : acc), null);

  return {
    sample: rows.length,
    by_currency,
    median_days_on_market: days.length > 0 ? Math.round(percentileSorted(days, 0.5)) : null,
    newest_listing_at: newest,
  };
}

/** Días en mercado de UNA propiedad (para negotiation_brief); null sin fecha. */
export function daysOnMarket(createdAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!createdAt) return null;
  const d = (now.getTime() - new Date(createdAt).getTime()) / 86_400_000;
  return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
}

/**
 * Posición del precio de una propiedad vs la mediana de sus comps (misma moneda):
 * porcentaje con signo (+ = por encima de la mediana). Null si no hay base comparable.
 */
export function priceVsMedian(price: number | null | undefined, currency: string | null | undefined, stats: MarketStats): number | null {
  if (typeof price !== "number" || price <= 0) return null;
  const cur = (currency ?? "USD").toUpperCase();
  const grp = stats.by_currency.find((c) => c.currency === cur);
  if (!grp || grp.median_price <= 0) return null;
  return round2(((price - grp.median_price) / grp.median_price) * 100);
}
