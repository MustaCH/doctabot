// Tests de search_properties (executor) con un mock chainable de supabase:
// eco de filtros (applied_filters/ignored_filters), only_active, moneda default USD,
// validación de rango de precio, offset, exclude_office/docta_first, price_unset_count,
// y la semántica de lote de tarjetas "última búsqueda gana" con dedup por id (ticket cardResults).
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";

type QB = {
  calls: Array<{ m: string; a: any[] }>;
  head: boolean;
  [k: string]: any;
};

/** Builder chainable + thenable: registra cada llamada y resuelve con el resultado configurado. */
function makeQB(resolve: (qb: QB) => { data?: any[] | null; count?: number | null; error?: any }): QB {
  const qb: any = { calls: [], head: false };
  const chain = (m: string) => (...a: any[]) => {
    if (m === "select") qb.head = !!a[1]?.head;
    qb.calls.push({ m, a });
    return qb;
  };
  for (const m of ["select", "or", "not", "ilike", "eq", "is", "gte", "lte", "order", "limit", "range", "in"]) {
    qb[m] = chain(m);
  }
  qb.then = (onF: any, onR: any) => Promise.resolve(resolve(qb)).then(onF, onR);
  return qb;
}

/**
 * Mock de supabase para search_properties: las queries head:true devuelven counts (la de precio
 * null se detecta por la llamada .is("price", null)); las de datos consumen dataQueue en orden.
 */
function makeSupabase(cfg: { dataQueue: any[][]; count: number; unsetCount?: number }) {
  const created: QB[] = [];
  const supabase = {
    created,
    from(_table: string) {
      const qb = makeQB((q) => {
        if (q.head) {
          const isPriceNull = q.calls.some((c) => c.m === "is" && c.a[0] === "price");
          return { count: isPriceNull ? (cfg.unsetCount ?? 0) : cfg.count, data: null, error: null };
        }
        const data = cfg.dataQueue.length > 1 ? cfg.dataQueue.shift()! : cfg.dataQueue[0];
        return { data, error: null };
      });
      created.push(qb);
      return qb;
    },
  };
  return supabase;
}

function baseCtx(supabase: any) {
  return {
    supabase,
    userId: "u1",
    conversationId: "c1",
    getCalendarToken: async () => null,
    cardResults: [] as any[],
  } as any;
}

const prop = (id: string, office: string, created: string) => ({
  id,
  title: `Prop ${id}`,
  office,
  created_at: created,
  url: `https://www.remax.com.ar/listings/prop-${id}`,
  photo: "photo.jpg",
  photos: ["photo.jpg"],
  price: 100000,
  currency: "USD",
});

describe("search_properties — eco de filtros y flags nuevos", () => {
  it("eco: applied_filters con moneda default USD + only_active/docta_first true; ignored_filters con args no soportados; price_unset_count", async () => {
    const supabase = makeSupabase({
      dataQueue: [[prop("a", "REMAX Docta", "2026-01-02T00:00:00Z"), prop("b", "REMAX Norte", "2026-01-03T00:00:00Z")]],
      count: 25,
      unsetCount: 4,
    });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Nueva Cordoba", max_price: 120000, foo: "bar" }, ctx));

    expect(out.total_count).toBe(25);
    expect(out.showing).toBe(2);
    expect(out.applied_filters.max_price).toBe(120000);
    expect(out.applied_filters.currency).toBe("USD"); // default documentado: precio sin moneda → USD
    expect(out.applied_filters.only_active).toBe(true);
    expect(out.applied_filters.docta_first).toBe(true);
    expect(out.applied_filters.zone).toContain("Nueva Cordoba");
    expect(out.ignored_filters).toContain("foo");
    expect(out.price_unset_count).toBe(4); // "a consultar" que el filtro de precio no evalúa

    // El filtro de activas se aplicó en la query (active O null legacy).
    const usedActiveOr = supabase.created.some((qb) =>
      qb.calls.some((c) => c.m === "or" && c.a[0] === "listing_status.eq.active,listing_status.is.null"));
    expect(usedActiveOr).toBe(true);
  });

  it("only_active=false NO aplica el filtro de listing_status y queda ecoado en applied_filters", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 1 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", only_active: false }, ctx));
    expect(out.applied_filters.only_active).toBe(false);
    const usedActiveOr = supabase.created.some((qb) =>
      qb.calls.some((c) => c.m === "or" && String(c.a[0]).includes("listing_status")));
    expect(usedActiveOr).toBe(false);
  });

  it("min_price > max_price → error claro, sin ejecutar queries", async () => {
    const supabase = makeSupabase({ dataQueue: [[]], count: 0 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { min_price: 200000, max_price: 100000 }, ctx));
    expect(out.error).toMatch(/min_price.*max_price/);
    expect(supabase.created.length).toBe(0);
  });

  it("B1: el pool se pide SIEMPRE desde 0 — .range(0, offset+pool-1) — y el offset se aplica post-rankeo", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 80 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 5, offset: 10 }, ctx));
    // poolLimit = min(5*10, 300) = 50 → range(0, 59): el pool arranca en 0 aunque haya offset.
    const ranged = supabase.created.some((qb) =>
      qb.calls.some((c) => c.m === "range" && c.a[0] === 0 && c.a[1] === 59));
    expect(ranged).toBe(true);
    expect(out.applied_filters.offset).toBe(10);
  });

  it("B1: dos páginas consecutivas con docta_first NO se solapan ni saltean propiedades", async () => {
    // Rankeo total determinista del pool: Doctas primero (created DESC) → [d1, d2, n1, n2, n3].
    const pool = [
      prop("n1", "REMAX Norte", "2026-02-05T00:00:00Z"),
      prop("d1", "REMAX Docta", "2026-01-03T00:00:00Z"),
      prop("n2", "REMAX Norte", "2026-02-04T00:00:00Z"),
      prop("d2", "REMAX Docta", "2026-01-02T00:00:00Z"),
      prop("n3", "REMAX Norte", "2026-02-03T00:00:00Z"),
    ];
    const supabase = makeSupabase({ dataQueue: [pool], count: 5 });
    const ctx = baseCtx(supabase);
    const p1 = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 2 }, ctx));
    const p2 = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 2, offset: 2 }, ctx));
    expect(p1.results.map((p: any) => p.id)).toEqual(["d1", "d2"]);
    expect(p2.results.map((p: any) => p.id)).toEqual(["n1", "n2"]); // sin repetir d1/d2, sin saltear n1
  });

  it("M5: offset más allá del final → end_of_results (sin mensaje de sin-resultados ni relax_hints)", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 1 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 5, offset: 5, max_price: 100000 }, ctx));
    expect(out.end_of_results).toBe(true);
    expect(out.total_count).toBe(1);
    expect(out.showing).toBe(0);
    expect(out.message).not.toMatch(/No se encontraron/);
    expect(out.relax_hints).toBeUndefined();
  });

  it("M6: una búsqueda con 0 resultados LIMPIA el lote de tarjetas del turno (sin tarjetas fantasma)", async () => {
    const supabase = makeSupabase({ dataQueue: [[]], count: 0 });
    const ctx = baseCtx(supabase);
    ctx.cardResults.push(prop("viejo", "X", "2026-01-01T00:00:00Z"));
    ctx.cardBatchTool = "get_favorites";
    ctx.cardBatchFresh = true;
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro" }, ctx));
    expect(out.total_count).toBe(0);
    expect(ctx.cardResults.length).toBe(0);
    expect(ctx.cardBatchFresh).toBe(false);
  });

  it("m1: exclude_office usa OR con office IS NULL (no descarta filas sin oficina) y docta_first=false desactiva la priorización", async () => {
    const otra = prop("n1", "REMAX Norte", "2026-02-01T00:00:00Z");
    const docta = prop("d1", "REMAX Docta", "2026-01-01T00:00:00Z");
    const supabase = makeSupabase({ dataQueue: [[otra, docta]], count: 2 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", exclude_office: "Docta", docta_first: false, limit: 1 }, ctx));
    const usedOr = supabase.created.some((qb) =>
      qb.calls.some((c) => c.m === "or" && c.a[0] === "office.is.null,office.not.ilike.%Docta%"));
    expect(usedOr).toBe(true);
    expect(out.applied_filters.exclude_office).toBe("Docta");
    expect(out.applied_filters.docta_first).toBe(false);
    // Sin docta_first, gana la más nueva (created_at DESC), no la Docta.
    expect(out.results[0].id).toBe("n1");
  });

  it("M8: min_price=0 se trata como no-seteado (no filtra ni dispara el default USD)", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 1 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", min_price: 0 }, ctx));
    expect(out.applied_filters.min_price).toBeUndefined();
    expect(out.applied_filters.currency).toBeUndefined();
    expect(out.applied_filters.currency_defaulted).toBeUndefined();
    const usedGte = supabase.created.some((qb) => qb.calls.some((c) => c.m === "gte" && c.a[0] === "price"));
    expect(usedGte).toBe(false);
  });

  it("M8: en Alquiler el precio sin moneda NO fuerza USD (mercado en pesos)", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 1 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { operation: "Alquiler", max_price: 500000 }, ctx));
    expect(out.applied_filters.currency).toBeUndefined();
    expect(out.applied_filters.currency_defaulted).toBeUndefined();
    const usedCurrency = supabase.created.some((qb) => qb.calls.some((c) => c.m === "ilike" && c.a[0] === "currency"));
    expect(usedCurrency).toBe(false);
  });

  it("M8: en Venta el default USD sigue y queda ecoado como currency_defaulted", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 1 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { operation: "Venta", max_price: 120000 }, ctx));
    expect(out.applied_filters.currency).toBe("USD");
    expect(out.applied_filters.currency_defaulted).toBe(true);
  });

  it("M8: 0 resultados con moneda defaulteada sugiere revisar la moneda en el mensaje", async () => {
    const supabase = makeSupabase({ dataQueue: [[]], count: 0 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", max_price: 100000 }, ctx));
    expect(out.total_count).toBe(0);
    expect(out.message).toMatch(/ARS/);
  });

  it("m2: min>max deja el eco en ctx.lastSearchAppliedFilters ANTES de fallar (el supervisor lo ve)", async () => {
    const supabase = makeSupabase({ dataQueue: [[]], count: 0 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { min_price: 200000, max_price: 100000 }, ctx));
    expect(out.error).toMatch(/min_price/);
    expect(ctx.lastSearchAppliedFilters?.min_price).toBe(200000);
    expect(ctx.lastSearchAppliedFilters?.max_price).toBe(100000);
  });

  it("con docta_first default, la Docta más vieja igual sube al tope", async () => {
    const otra = prop("n1", "REMAX Norte", "2026-02-01T00:00:00Z");
    const docta = prop("d1", "REMAX Docta", "2026-01-01T00:00:00Z");
    const supabase = makeSupabase({ dataQueue: [[otra, docta]], count: 2 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 1 }, ctx));
    expect(out.results[0].id).toBe("d1");
  });
});

describe("search_properties — lote de tarjetas: última búsqueda gana + dedup por id", () => {
  it("dos búsquedas en el mismo turno → cardResults tiene SOLO las de la última, sin duplicados", async () => {
    const batch1 = [prop("a", "X", "2026-01-01T00:00:00Z"), prop("b", "X", "2026-01-02T00:00:00Z")];
    const dup = prop("c", "X", "2026-01-03T00:00:00Z");
    const batch2 = [dup, { ...dup }, prop("d", "X", "2026-01-04T00:00:00Z")];
    const supabase = makeSupabase({ dataQueue: [batch1, batch2], count: 10 });
    const ctx = baseCtx(supabase);

    await executeTool("search_properties", { zone: "Centro" }, ctx);
    // rankProperties ordena por created_at DESC (b es más nueva que a).
    expect(ctx.cardResults.map((p: any) => p.id)).toEqual(["b", "a"]);

    await executeTool("search_properties", { zone: "Alberdi" }, ctx);
    // Reemplaza el lote (no acumula) y dedupea el id repetido dentro del lote.
    expect(ctx.cardResults.map((p: any) => p.id).sort()).toEqual(["c", "d"]);
  });

  it("los stubs devueltos al modelo no traen url/photo/photos (el server arma la tarjeta)", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 1 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro" }, ctx));
    expect(out.results[0].url).toBeUndefined();
    expect(out.results[0].photo).toBeUndefined();
    expect(out.results[0].photos).toBeUndefined();
    // Pero el lote de tarjetas conserva la propiedad completa (con url/photo).
    expect(ctx.cardResults[0].url).toContain("/listings/");
  });

  it("M9: tools DISTINTAS con resultados en el mismo turno se fusionan con dedup por id (favoritos + búsqueda)", async () => {
    const favRows = [{ property_id: "f1", properties: prop("f1", "X", "2026-01-01T00:00:00Z") }];
    const searchPool = [prop("s1", "X", "2026-01-02T00:00:00Z"), prop("f1", "X", "2026-01-01T00:00:00Z")];
    const supabase = makeSupabase({ dataQueue: [favRows, searchPool], count: 2 });
    const ctx = baseCtx(supabase);
    await executeTool("get_favorites", {}, ctx);
    expect(ctx.cardResults.map((p: any) => p.id)).toEqual(["f1"]);
    await executeTool("search_properties", { zone: "Centro" }, ctx);
    // El lote de favoritos NO se pisa: se concatena la búsqueda, sin duplicar f1.
    expect(ctx.cardResults.map((p: any) => p.id).sort()).toEqual(["f1", "s1"]);
  });

  it("el eco queda disponible para el supervisor en ctx.lastSearchAppliedFilters (última gana)", async () => {
    const supabase = makeSupabase({ dataQueue: [[prop("a", "X", "2026-01-01T00:00:00Z")]], count: 1 });
    const ctx = baseCtx(supabase);
    await executeTool("search_properties", { zone: "Centro" }, ctx);
    expect(ctx.lastSearchAppliedFilters?.only_active).toBe(true);
    await executeTool("search_properties", { zone: "Alberdi", only_active: false }, ctx);
    expect(ctx.lastSearchAppliedFilters?.only_active).toBe(false);
  });
});
