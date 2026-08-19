// Tests del ticket 86aj9w5ke: create_client_event / create_client_note validan pertenencia
// del cliente en el path por client_id UUID directo (las edge usan service_role → bypass RLS;
// sin el check se cuelgan filas del cliente de OTRO agente). El path por client_name ya
// scopeaba por user_id y no debe romperse.
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";

type TableCfg = {
  listResult?: { data: any[] | null; error?: any };       // queries awaiteadas directo (ilike+limit)
  maybeSingleResult?: { data: any; error?: any };          // .maybeSingle()
  singleResult?: { data: any; error?: any };               // .single() (inserts con .select().single())
};

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
      for (const m of ["select", "eq", "ilike", "limit", "order", "insert", "update", "upsert"]) qb[m] = chain(m);
      qb.maybeSingle = () => {
        calls.push({ table, m: "maybeSingle", a: [] });
        return Promise.resolve({ data: null, error: null, ...(cfg.maybeSingleResult ?? {}) });
      };
      qb.single = () => {
        calls.push({ table, m: "single", a: [] });
        return Promise.resolve({ data: null, error: null, ...(cfg.singleResult ?? {}) });
      };
      qb.then = (onF: any, onR: any) => Promise.resolve({ data: null, error: null, ...(cfg.listResult ?? {}) }).then(onF, onR);
      return qb;
    },
  };
}

function baseCtx(supabase: any, getCalendarToken: () => Promise<string | null> = async () => null) {
  return {
    supabase,
    userId: "u1",
    conversationId: "c1",
    getCalendarToken,
    cardResults: [] as unknown[],
  } as never;
}

const FOREIGN_ID = "99999999-9999-4999-8999-999999999999";
const OWN_ID = "11111111-1111-4111-8111-111111111111";

describe("pertenencia de cliente en path UUID directo (86aj9w5ke)", () => {
  it("create_client_note con client_id ajeno → rechaza sin insertar", async () => {
    const supabase = makeSupabase({
      clients: { maybeSingleResult: { data: null } }, // no existe scopeado por user_id
    });
    const out = JSON.parse(await executeTool("create_client_note", { client_id: FOREIGN_ID, content: "nota" }, baseCtx(supabase)));

    expect(out.error).toMatch(/no te pertenece/);
    expect(supabase.calls.some((c) => c.table === "client_notes")).toBe(false);
  });

  it("create_client_event con client_id ajeno → rechaza ANTES del sync a Calendar y sin insertar", async () => {
    const supabase = makeSupabase({
      clients: { maybeSingleResult: { data: null } },
    });
    let calendarTokenPedido = false;
    const ctx = baseCtx(supabase, async () => { calendarTokenPedido = true; return "tok"; });
    const out = JSON.parse(await executeTool("create_client_event", { client_id: FOREIGN_ID, title: "Cumple", event_date: "2026-09-01" }, ctx));

    expect(out.error).toMatch(/no te pertenece/);
    expect(calendarTokenPedido).toBe(false); // el efecto externo nunca arrancó
    expect(supabase.calls.some((c) => c.table === "client_events")).toBe(false);
  });

  it("create_client_note con client_id propio → inserta normal", async () => {
    const supabase = makeSupabase({
      clients: { maybeSingleResult: { data: { id: OWN_ID, full_name: "Ana Pérez" } } },
      client_notes: { singleResult: { data: { id: "n1", content: "nota", is_action: false, is_done: false, created_at: "2026-08-18" } } },
    });
    const out = JSON.parse(await executeTool("create_client_note", { client_id: OWN_ID, content: "nota" }, baseCtx(supabase)));

    expect(out.success).toBe(true);
    expect(supabase.calls.some((c) => c.table === "client_notes" && c.m === "insert")).toBe(true);
  });

  // 86aj9w5nt: due_at de tareas (lo consume daily-followups).
  it("create_client_note con is_action y due_at persiste el vencimiento; sin is_action se ignora", async () => {
    const supabase = makeSupabase({
      clients: { maybeSingleResult: { data: { id: OWN_ID, full_name: "Ana Pérez" } } },
      client_notes: { singleResult: { data: { id: "n1", content: "Llamar", is_action: true, is_done: false, due_at: "2026-08-25T12:00:00.000Z", created_at: "2026-08-18" } } },
    });
    const out = JSON.parse(await executeTool("create_client_note", { client_id: OWN_ID, content: "Llamar", is_action: true, due_at: "2026-08-25" }, baseCtx(supabase)));

    expect(out.success).toBe(true);
    const insert = supabase.calls.find((c) => c.table === "client_notes" && c.m === "insert");
    expect(typeof insert?.a[0]?.due_at).toBe("string");
    expect(insert?.a[0]?.due_at).toMatch(/^2026-08-2[45]T/); // normalizado a ISO (TZ Córdoba)

    const s2 = makeSupabase({
      clients: { maybeSingleResult: { data: { id: OWN_ID, full_name: "Ana Pérez" } } },
      client_notes: { singleResult: { data: { id: "n2", content: "Nota", is_action: false, is_done: false, created_at: "2026-08-18" } } },
    });
    await executeTool("create_client_note", { client_id: OWN_ID, content: "Nota", due_at: "2026-08-25" }, baseCtx(s2));
    const insert2 = s2.calls.find((c) => c.table === "client_notes" && c.m === "insert");
    expect(insert2?.a[0]?.due_at).toBeNull();
  });

  it("path por client_name (match exacto, ya scopeado) sigue funcionando", async () => {
    const supabase = makeSupabase({
      clients: {
        listResult: { data: [{ id: OWN_ID, full_name: "Ana Pérez" }] },
        maybeSingleResult: { data: { id: OWN_ID, full_name: "Ana Pérez" } },
      },
      client_notes: { singleResult: { data: { id: "n1", content: "nota", is_action: false, is_done: false, created_at: "2026-08-18" } } },
    });
    const out = JSON.parse(await executeTool("create_client_note", { client_name: "Ana Pérez", content: "nota" }, baseCtx(supabase)));

    expect(out.success).toBe(true);
    // La búsqueda por nombre fue scopeada por user_id
    expect(supabase.calls.some((c) => c.table === "clients" && c.m === "eq" && c.a[0] === "user_id" && c.a[1] === "u1")).toBe(true);
  });
});
