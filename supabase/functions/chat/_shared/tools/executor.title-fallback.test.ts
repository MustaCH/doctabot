// Tests del gate del title_fallback (86aj9w5mz), reexpresado sobre la RPC v2 (86ak2q73x):
// el fallback no debe disparar para términos genéricos (blocklist) ni cortos (<4 chars), y
// cuando dispara reintenta la RPC con search_term=<término> (umbral de relevance_score en la
// RPC, que absorbe typos) en vez del viejo imatch word-boundary, etiquetando match_mode.
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";
import { titleFallbackRegex } from "./validators";

type RpcPage = { rows: any[]; total: number };

function makeSupabase(cfg: { rpcPages: RpcPage[] }) {
  const rpcCalls: Array<{ name: string; params: Record<string, any> }> = [];
  const pages = [...cfg.rpcPages];
  return {
    rpcCalls,
    rpc(name: string, params: Record<string, any>) {
      rpcCalls.push({ name, params });
      const page = pages.length > 1 ? pages.shift()! : pages[0] ?? { rows: [], total: 0 };
      const data = page.rows.map((r) => ({ relevance_score: 0.6, ...r, total_count: page.total }));
      return Promise.resolve({ data, error: null });
    },
    from(_table: string) {
      throw new Error("sin queries PostgREST en estos casos");
    },
  };
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

describe("search_properties — gate del fallback por relevancia (86aj9w5mz sobre RPC v2)", () => {
  it("zona genérica ('centro') con 0 resultados NO dispara el fallback (una sola llamada a la RPC)", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }] });
    const out = JSON.parse(await executeTool("search_properties", { zone: "centro" }, baseCtx(supabase)));

    expect(out.match_mode).toBeUndefined();
    expect(supabase.rpcCalls).toHaveLength(1);
  });

  it("zona específica ('Manantiales') con 0 resultados reintenta con search_term y sin filtro de zona", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }, { rows: [prop], total: 5 }] });
    const out = JSON.parse(await executeTool("search_properties", { zone: "Manantiales" }, baseCtx(supabase)));

    expect(out.match_mode).toBe("title_fallback");
    expect(out.searched_term).toBe("Manantiales");
    expect(out.total_count).toBe(5);
    expect(supabase.rpcCalls).toHaveLength(2);
    const first = supabase.rpcCalls[0].params;
    const retry = supabase.rpcCalls[1].params;
    expect(first.zones).toEqual(["Manantiales"]);
    expect(first.search_term).toBe("");
    expect(retry.search_term).toBe("Manantiales");
    expect(retry.zones).toBeNull(); // el término pasa de filtro exacto a búsqueda por relevancia
  });

  it("locality genérica corta no dispara; locality específica sí, con el término sin acento", async () => {
    const s1 = makeSupabase({ rpcPages: [{ rows: [], total: 0 }] });
    const out1 = JSON.parse(await executeTool("search_properties", { locality: "sur" }, baseCtx(s1)));
    expect(out1.match_mode).toBeUndefined();
    expect(s1.rpcCalls).toHaveLength(1);

    const s2 = makeSupabase({ rpcPages: [{ rows: [], total: 0 }, { rows: [prop], total: 3 }] });
    const out2 = JSON.parse(await executeTool("search_properties", { locality: "Saldán" }, baseCtx(s2)));
    expect(out2.match_mode).toBe("title_fallback");
    // locality pasa por stripAccents antes del fallback → el término va sin acento
    const retry = s2.rpcCalls[1].params;
    expect(retry.search_term).toBe("Saldan");
    expect(retry.locality_filter).toBe("");
  });

  it("con title explícito el fallback NO dispara aunque la búsqueda dé vacía", async () => {
    const supabase = makeSupabase({ rpcPages: [{ rows: [], total: 0 }] });
    const out = JSON.parse(await executeTool("search_properties", { zone: "Manantiales", title: "duplex" }, baseCtx(supabase)));
    expect(out.match_mode).toBeUndefined();
    expect(supabase.rpcCalls).toHaveLength(1);
  });
});
