// Tests de search_properties (executor) sobre la RPC v2 `search_properties_relevance`
// (ticket 86ak2q73x): eco de filtros (applied_filters/ignored_filters), mapeo de args a params
// de la RPC (only_active→filter_active, moneda default USD, paginación server-side), validación
// de rango de precio, end_of_results con sonda de universo, price_unset_count (único count que
// sigue en PostgREST), y la semántica de lote de tarjetas "última búsqueda gana" con dedup por id.
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";

type QB = {
  calls: Array<{ m: string; a: any[] }>;
  head: boolean;
  [k: string]: any;
};

/** Builder chainable + thenable para las queries PostgREST restantes (favoritos, price IS NULL). */
function makeQB(resolve: (qb: QB) => { data?: any[] | null; count?: number | null; error?: any }): QB {
  const qb: any = { calls: [], head: false };
  const chain = (m: string) => (...a: any[]) => {
    if (m === "select") qb.head = !!a[1]?.head;
    qb.calls.push({ m, a });
    return qb;
  };
  for (const m of ["select", "or", "not", "ilike", "eq", "is", "gte", "lte", "order", "limit", "range", "in", "filter"]) {
    qb[m] = chain(m);
  }
  qb.then = (onF: any, onR: any) => Promise.resolve(resolve(qb)).then(onF, onR);
  return qb;
}

type RpcPage = { rows: any[]; total: number };

/**
 * Mock de supabase para search_properties v2: `rpc` consume rpcPages en orden (la última se
 * repite) y estampa relevance_score/total_count en cada fila, como la RPC real; `from` sirve
 * las queries PostgREST que quedan (price IS NULL → unsetCount; favoritos → dataQueue).
 */
function makeSupabase(cfg: { rpcPages: RpcPage[]; unsetCount?: number; dataQueue?: any[][] }) {
  const created: QB[] = [];
  const rpcCalls: Array<{ name: string; params: Record<string, any> }> = [];
  const pages = [...cfg.rpcPages];
  const supabase = {
    created,
    rpcCalls,
    rpc(name: string, params: Record<string, any>) {
      rpcCalls.push({ name, params });
      const page = pages.length > 1 ? pages.shift()! : pages[0] ?? { rows: [], total: 0 };
      const data = page.rows.map((r) => ({ relevance_score: 1, ...r, total_count: page.total }));
      return Promise.resolve({ data, error: null });
    },
    from(_table: string) {
      const qb = makeQB((q) => {
        if (q.head) {
          const isPriceNull = q.calls.some((c) => c.m === "is" && c.a[0] === "price");
          return { count: isPriceNull ? (cfg.unsetCount ?? 0) : 0, data: null, error: null };
        }
        const queue = cfg.dataQueue ?? [[]];
        const data = queue.length > 1 ? queue.shift()! : queue[0];
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

const searchParams = (supabase: any, i = 0) => supabase.rpcCalls[i].params;

describe("search_properties — eco de filtros y mapeo a la RPC v2", () => {
  it("eco: applied_filters con moneda default USD + only_active/docta_first true; ignored_filters con args no soportados; price_unset_count", async () => {
    const supabase = makeSupabase({
      rpcPages: [{ rows: [prop("a", "REMAX Docta", "2026-01-02T00:00:00Z"), prop("b", "REMAX Norte", "2026-01-03T00:00:00Z")], total: 25 }],
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

    // El mapeo a la RPC lleva los filtros tal cual (only_active → filter_active, moneda default).
    const p = searchParams(supabase);
    expect(supabase.rpcCalls[0].name).toBe("search_properties_relevance");
    expect(p.filter_active).toBe(true);
    expect(p.zones).toEqual(["Nueva Cordoba"]);
    expect(p.price_max).toBe(120000);
    expect(p.currency_filter).toBe("USD");
    expect(p.search_term).toBe("");
  });

  it("only_active=false llega a la RPC como filter_active=false y queda ecoado en applied_filters", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 1 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", only_active: false }, ctx));
    expect(out.applied_filters.only_active).toBe(false);
    expect(searchParams(supabase).filter_active).toBe(false);
  });

  it("min_price > max_price → error claro, sin ejecutar la RPC ni queries", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { min_price: 200000, max_price: 100000 }, ctx));
    expect(out.error).toMatch(/min_price.*max_price/);
    expect(supabase.rpcCalls.length).toBe(0);
    expect(supabase.created.length).toBe(0);
  });

  it("paginación server-side: limit/offset viajan como page_size/page_offset (sin pool en memoria)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 80 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 5, offset: 10 }, ctx));
    const p = searchParams(supabase);
    expect(p.page_size).toBe(5);
    expect(p.page_offset).toBe(10);
    expect(out.applied_filters.offset).toBe(10);
  });

  it("el orden de la RPC (docta DESC, relevance DESC, created DESC) se respeta tal cual, sin re-rankeo", async () => {
    // La RPC ya devuelve docta-first; el executor NO debe reordenar.
    const page = { rows: [prop("d1", "REMAX Docta", "2026-01-03T00:00:00Z"), prop("n1", "REMAX Norte", "2026-02-05T00:00:00Z")], total: 5 };
    const supabase = makeSupabase({ rpcPages: [page] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 2 }, ctx));
    expect(out.results.map((p: any) => p.id)).toEqual(["d1", "n1"]);
    expect(out.docta_in_results).toBe(1);
    expect(searchParams(supabase).docta_first).toBe(true);
  });

  it("M5: offset con página vacía y universo > 0 → end_of_results (la sonda relee total_count con page_offset=0)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }, { rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 1 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", limit: 5, offset: 5, max_price: 100000 }, ctx));
    expect(out.end_of_results).toBe(true);
    expect(out.total_count).toBe(1);
    expect(out.showing).toBe(0);
    expect(out.message).not.toMatch(/No se encontraron/);
    expect(out.relax_hints).toBeUndefined();
    // La sonda de universo va con page_offset 0 y page_size 1.
    const probe = searchParams(supabase, 1);
    expect(probe.page_offset).toBe(0);
    expect(probe.page_size).toBe(1);
  });

  it("M6: una búsqueda con 0 resultados LIMPIA el lote de tarjetas del turno (sin tarjetas fantasma)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }] });
    const ctx = baseCtx(supabase);
    ctx.cardResults.push(prop("viejo", "X", "2026-01-01T00:00:00Z"));
    ctx.cardBatchTool = "get_favorites";
    ctx.cardBatchFresh = true;
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro" }, ctx));
    expect(out.total_count).toBe(0);
    expect(ctx.cardResults.length).toBe(0);
    expect(ctx.cardBatchFresh).toBe(false);
  });

  it("m1: exclude_office viaja como exclude_office_filter (office IS NULL pasa en la RPC) y docta_first=false desactiva la priorización", async () => {
    const page = { rows: [prop("n1", "REMAX Norte", "2026-02-01T00:00:00Z")], total: 2 };
    const supabase = makeSupabase({ rpcPages: [page] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", exclude_office: "Docta", docta_first: false, limit: 1 }, ctx));
    const p = searchParams(supabase);
    expect(p.exclude_office_filter).toBe("Docta");
    expect(p.docta_first).toBe(false);
    expect(out.applied_filters.exclude_office).toBe("Docta");
    expect(out.applied_filters.docta_first).toBe(false);
    expect(out.results[0].id).toBe("n1");
  });

  it("M8: min_price=0 se trata como no-seteado (price_min null en la RPC, sin default USD)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 1 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", min_price: 0 }, ctx));
    expect(out.applied_filters.min_price).toBeUndefined();
    expect(out.applied_filters.currency).toBeUndefined();
    expect(out.applied_filters.currency_defaulted).toBeUndefined();
    const p = searchParams(supabase);
    expect(p.price_min).toBeNull();
    expect(p.currency_filter).toBe("");
  });

  it("M8: en Alquiler el precio sin moneda NO fuerza USD (mercado en pesos)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 1 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { operation: "Alquiler", max_price: 500000 }, ctx));
    expect(out.applied_filters.currency).toBeUndefined();
    expect(out.applied_filters.currency_defaulted).toBeUndefined();
    expect(searchParams(supabase).currency_filter).toBe("");
    expect(searchParams(supabase).op_filter).toBe("Alquiler");
  });

  it("M8: en Venta el default USD sigue y queda ecoado como currency_defaulted", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 1 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { operation: "Venta", max_price: 120000 }, ctx));
    expect(out.applied_filters.currency).toBe("USD");
    expect(out.applied_filters.currency_defaulted).toBe(true);
    expect(searchParams(supabase).currency_filter).toBe("USD");
  });

  it("M8: 0 resultados con moneda defaulteada sugiere revisar la moneda en el mensaje", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }], unsetCount: 0 });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", max_price: 100000 }, ctx));
    expect(out.total_count).toBe(0);
    expect(out.message).toMatch(/ARS/);
  });

  it("0 resultados con filtro numérico: relax_hints salen de sondas de la RPC (page_size=1) y solo con count>0", async () => {
    // 1ª llamada: búsqueda vacía. 2ª: relax de max_price → universo 7. (min rooms no seteado.)
    const supabase = makeSupabase({
      rpcPages: [{ rows: [], total: 0 }, { rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 7 }],
      unsetCount: 0,
    });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro", max_price: 100000 }, ctx));
    expect(out.relax_hints).toEqual([{ drop: "max_price", count: 7 }]);
    const relax = searchParams(supabase, 1);
    expect(relax.price_max).toBeNull();
    expect(relax.page_size).toBe(1);
  });

  it("m2: min>max deja el eco en ctx.lastSearchAppliedFilters ANTES de fallar (el supervisor lo ve)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { min_price: 200000, max_price: 100000 }, ctx));
    expect(out.error).toMatch(/min_price/);
    expect(ctx.lastSearchAppliedFilters?.min_price).toBe(200000);
    expect(ctx.lastSearchAppliedFilters?.max_price).toBe(100000);
  });
});

describe("search_properties — lote de tarjetas: última búsqueda gana + dedup por id", () => {
  it("dos búsquedas en el mismo turno → cardResults tiene SOLO las de la última, sin duplicados", async () => {
    const batch1 = [prop("b", "X", "2026-01-02T00:00:00Z"), prop("a", "X", "2026-01-01T00:00:00Z")];
    const dup = prop("c", "X", "2026-01-03T00:00:00Z");
    const batch2 = [dup, { ...dup }, prop("d", "X", "2026-01-04T00:00:00Z")];
    const supabase = makeSupabase({ rpcPages: [{ rows: batch1, total: 10 }, { rows: batch2, total: 10 }] });
    const ctx = baseCtx(supabase);

    await executeTool("search_properties", { zone: "Centro" }, ctx);
    expect(ctx.cardResults.map((p: any) => p.id)).toEqual(["b", "a"]);

    await executeTool("search_properties", { zone: "Alberdi" }, ctx);
    // Reemplaza el lote (no acumula) y dedupea el id repetido dentro del lote.
    expect(ctx.cardResults.map((p: any) => p.id).sort()).toEqual(["c", "d"]);
  });

  it("los stubs devueltos al modelo no traen url/photo/photos ni total_count, pero SÍ relevance_score", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 1 }] });
    const ctx = baseCtx(supabase);
    const out = JSON.parse(await executeTool("search_properties", { zone: "Centro" }, ctx));
    expect(out.results[0].url).toBeUndefined();
    expect(out.results[0].photo).toBeUndefined();
    expect(out.results[0].photos).toBeUndefined();
    expect(out.results[0].total_count).toBeUndefined();
    expect(out.results[0].relevance_score).toBe(1);
    // Pero el lote de tarjetas conserva la propiedad completa (con url/photo).
    expect(ctx.cardResults[0].url).toContain("/listings/");
  });

  it("M9: tools DISTINTAS con resultados en el mismo turno se fusionan con dedup por id (favoritos + búsqueda)", async () => {
    const favRows = [{ property_id: "f1", properties: prop("f1", "X", "2026-01-01T00:00:00Z") }];
    const searchPage = [prop("s1", "X", "2026-01-02T00:00:00Z"), prop("f1", "X", "2026-01-01T00:00:00Z")];
    const supabase = makeSupabase({ rpcPages: [{ rows: searchPage, total: 2 }], dataQueue: [favRows] });
    const ctx = baseCtx(supabase);
    await executeTool("get_favorites", {}, ctx);
    expect(ctx.cardResults.map((p: any) => p.id)).toEqual(["f1"]);
    await executeTool("search_properties", { zone: "Centro" }, ctx);
    // El lote de favoritos NO se pisa: se concatena la búsqueda, sin duplicar f1.
    expect(ctx.cardResults.map((p: any) => p.id).sort()).toEqual(["f1", "s1"]);
  });

  it("el eco queda disponible para el supervisor en ctx.lastSearchAppliedFilters (última gana)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [prop("a", "X", "2026-01-01T00:00:00Z")], total: 1 }] });
    const ctx = baseCtx(supabase);
    await executeTool("search_properties", { zone: "Centro" }, ctx);
    expect(ctx.lastSearchAppliedFilters?.only_active).toBe(true);
    await executeTool("search_properties", { zone: "Alberdi", only_active: false }, ctx);
    expect(ctx.lastSearchAppliedFilters?.only_active).toBe(false);
  });
});
