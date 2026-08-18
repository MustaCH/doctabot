// Tests del ticket 86aj9w5mz: el title_fallback de search_properties no debe disparar para
// términos genéricos (blocklist) ni cortos (<4 chars), y cuando dispara usa word-boundary
// (imatch = ~* '\mterm\M') en vez de substring ('centro' matcheaba "Centro de Distribución").
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";
import { titleFallbackRegex } from "./validators";

type QB = { calls: Array<{ m: string; a: any[] }>; head: boolean; [k: string]: any };

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

function makeSupabase(cfg: { dataQueue: any[][]; count: number }) {
  const created: QB[] = [];
  const supabase = {
    created,
    from(_table: string) {
      const qb = makeQB((q) => {
        if (q.head) return { count: cfg.count, data: null, error: null };
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

const prop = {
  id: "p1",
  title: "Lote en Manantiales II",
  office: "REMAX Docta",
  created_at: "2026-01-02T00:00:00Z",
  url: "https://www.remax.com.ar/listings/p1",
  photo: "photo.jpg",
  photos: ["photo.jpg"],
  price: 100000,
  currency: "USD",
};

const imatchCalls = (supabase: any) =>
  supabase.created.flatMap((qb: QB) => qb.calls.filter((c) => c.m === "filter" && c.a[1] === "imatch"));

describe("titleFallbackRegex (validators)", () => {
  it("null para términos cortos (<4) y de blocklist (con y sin acento/mayúsculas)", () => {
    expect(titleFallbackRegex("san")).toBeNull();
    expect(titleFallbackRegex("  ne ")).toBeNull();
    expect(titleFallbackRegex("centro")).toBeNull();
    expect(titleFallbackRegex("Centro")).toBeNull();
    expect(titleFallbackRegex("Córdoba")).toBeNull();
    expect(titleFallbackRegex(null)).toBeNull();
  });

  it("término válido → patrón word-boundary; los metacaracteres de regex van escapados", () => {
    expect(titleFallbackRegex("Manantiales")).toBe("\\mManantiales\\M");
    expect(titleFallbackRegex("Docta (etapa 2)")).toBe("\\mDocta \\(etapa 2\\)\\M");
  });
});

describe("search_properties — gate del title_fallback (86aj9w5mz)", () => {
  it("zona genérica ('centro') con 0 resultados NO dispara el fallback por título", async () => {
    const supabase = makeSupabase({ dataQueue: [[]], count: 0 });
    const out = JSON.parse(await executeTool("search_properties", { zone: "centro" }, baseCtx(supabase)));

    expect(out.match_mode).toBeUndefined();
    expect(imatchCalls(supabase)).toHaveLength(0);
  });

  it("zona específica ('Manantiales') con 0 resultados dispara el fallback con imatch word-boundary", async () => {
    const supabase = makeSupabase({ dataQueue: [[], [prop]], count: 5 });
    const out = JSON.parse(await executeTool("search_properties", { zone: "Manantiales" }, baseCtx(supabase)));

    expect(out.match_mode).toBe("title_fallback");
    expect(out.searched_term).toBe("Manantiales");
    const calls = imatchCalls(supabase);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.a[0]).toBe("title");
      expect(c.a[2]).toBe("\\mManantiales\\M");
    }
    // Nada quedó en ilike substring sobre title
    const titleIlikes = supabase.created.flatMap((qb: QB) => qb.calls.filter((c) => c.m === "ilike" && c.a[0] === "title"));
    expect(titleIlikes).toHaveLength(0);
  });

  it("locality genérica corta no dispara; locality específica sí, vía applyFilters con imatch", async () => {
    const s1 = makeSupabase({ dataQueue: [[]], count: 0 });
    const out1 = JSON.parse(await executeTool("search_properties", { locality: "sur" }, baseCtx(s1)));
    expect(out1.match_mode).toBeUndefined();
    expect(imatchCalls(s1)).toHaveLength(0);

    const s2 = makeSupabase({ dataQueue: [[], [prop]], count: 3 });
    const out2 = JSON.parse(await executeTool("search_properties", { locality: "Saldán" }, baseCtx(s2)));
    expect(out2.match_mode).toBe("title_fallback");
    // locality pasa por stripAccents antes del fallback → el patrón va sin acento
    expect(imatchCalls(s2).length).toBeGreaterThan(0);
    expect(imatchCalls(s2).every((c: any) => c.a[2] === "\\mSaldan\\M")).toBe(true);
  });
});
