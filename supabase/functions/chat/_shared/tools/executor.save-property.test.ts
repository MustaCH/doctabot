// Tests de save_property_to_client: el scraper nocturno borra propiedades que ya no ve,
// así que el path por UUID tiene que validar existencia ANTES del upsert (bug 86ak29y3q,
// FK 23503 recurrente en prod) — y safeDbError(23503) queda como red de seguridad accionable.
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";
import { safeDbError } from "./validators";

type TableCfg = {
  maybeSingleResult?: { data: any; error?: any };
  upsertResult?: { data: any; error?: any };
};

/** Mock chainable por tabla: registra llamadas; maybeSingle/upsert resuelven lo configurado. */
function makeSupabase(tables: Record<string, TableCfg>) {
  const calls: Array<{ table: string; m: string; a: any[] }> = [];
  return {
    calls,
    from(table: string) {
      const cfg = tables[table] ?? {};
      const qb: any = {};
      const chain = (m: string) => (...a: any[]) => {
        calls.push({ table, m, a });
        return qb;
      };
      for (const m of ["select", "eq", "ilike", "limit", "order", "update", "upsert"]) qb[m] = chain(m);
      qb.maybeSingle = (...a: any[]) => {
        calls.push({ table, m: "maybeSingle", a });
        const wasUpsert = calls.some((c) => c.table === table && c.m === "upsert");
        const res = wasUpsert ? (cfg.upsertResult ?? { data: null, error: null }) : (cfg.maybeSingleResult ?? { data: null, error: null });
        return Promise.resolve({ error: null, ...res });
      };
      // update(...).eq(...).eq(...) se awaitea directo (last_contact_at) → thenable
      qb.then = (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR);
      return qb;
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

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const PROP_ID = "22222222-2222-4222-8222-222222222222";

describe("save_property_to_client — propiedad borrada por el scraper (path por UUID)", () => {
  it("propiedad inexistente → error claro 'ya no está publicada', sin tocar client_properties", async () => {
    const supabase = makeSupabase({
      properties: { maybeSingleResult: { data: null } }, // el scraper la borró
      clients: { maybeSingleResult: { data: { id: CLIENT_ID, full_name: "Ana Pérez" } } },
    });
    const out = JSON.parse(await executeTool("save_property_to_client", { client_id: CLIENT_ID, property_id: PROP_ID }, baseCtx(supabase)));

    expect(out.error).toMatch(/ya no está publicada/);
    expect(out.error).toMatch(/search_properties/);
    // Nunca llegó al upsert: sin excepción de DB (FK 23503).
    expect(supabase.calls.some((c) => c.table === "client_properties")).toBe(false);
  });

  it("propiedad existente → valida por id y el upsert sale con el dedup intacto (onConflict client_id,property_id)", async () => {
    const supabase = makeSupabase({
      properties: { maybeSingleResult: { data: { id: PROP_ID } } },
      clients: { maybeSingleResult: { data: { id: CLIENT_ID, full_name: "Ana Pérez" } } },
      client_properties: { upsertResult: { data: { id: "cp1" } } },
    });
    const out = JSON.parse(await executeTool("save_property_to_client", { client_id: CLIENT_ID, property_id: PROP_ID }, baseCtx(supabase)));

    expect(out.success).toBe(true);
    const checkedProp = supabase.calls.some((c) => c.table === "properties" && c.m === "eq" && c.a[0] === "id" && c.a[1] === PROP_ID);
    expect(checkedProp).toBe(true);
    const upsert = supabase.calls.find((c) => c.table === "client_properties" && c.m === "upsert");
    expect(upsert?.a[1]?.onConflict).toBe("client_id,property_id");
  });
});

describe("safeDbError — red de seguridad para 23503", () => {
  it("devuelve un mensaje accionable, no el literal 'Referencia inválida' pelado", () => {
    const msg = safeDbError({ code: "23503", message: "violates foreign key constraint" });
    expect(msg).toMatch(/ya no existe/);
    expect(msg).toMatch(/[Vv]olvé a buscar/);
  });
});
