// Tests OFFLINE del harness de evals (86aj9w5mg): corren en `npm test`, sin API.
// Validan el mock de Supabase, el evaluador de expectativas, el esquema del golden set,
// y un turno completo end-to-end con el modelo stubbeado (SSE) — el executor REAL corre
// contra la DB in-memory, probando el pipeline entero menos Gemini.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createMockDb, mockSupabase } from "./mock-db";
import { evaluateExpectations, runEvalCase, buildCaseDb, defaultDb, EVAL_USER_ID, type EvalCase } from "./runner";
import goldenSet from "./golden-set.json";

// jsdom no trae AbortSignal.timeout (los evals reales corren en env node, donde sí existe):
// sin el shim, el thunk de fetch tira en cada intento y fetchWithRetry agota el backoff.
if (typeof AbortSignal.timeout !== "function") {
  (AbortSignal as any).timeout = () => new AbortController().signal;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("mock-db — semántica de queries de los tools", () => {
  it("eq + ilike + order + limit sobre filas en memoria", async () => {
    const db = createMockDb({ clients: [
      { user_id: "u1", full_name: "Ana Pérez", is_client: true },
      { user_id: "u1", full_name: "Juan Gómez", is_client: true },
      { user_id: "u2", full_name: "Otra Persona", is_client: true },
    ]});
    const sb = mockSupabase(db);
    const { data } = await sb.from("clients").select("id, full_name").eq("user_id", "u1").ilike("full_name", "%pérez%").limit(5);
    expect(data).toHaveLength(1);
    expect(data[0].full_name).toBe("Ana Pérez");
  });

  it("or() con listing_status.eq.active,listing_status.is.null (filtro only_active)", async () => {
    const db = createMockDb({ properties: [
      { title: "A", listing_status: "active" },
      { title: "B", listing_status: null },
      { title: "C", listing_status: "inactive" },
    ]});
    const { data } = await mockSupabase(db).from("properties").select("*").or("listing_status.eq.active,listing_status.is.null");
    expect(data.map((r: any) => r.title).sort()).toEqual(["A", "B"]);
  });

  it("filter imatch traduce \\m..\\M a word-boundary (title_fallback)", async () => {
    const db = createMockDb({ properties: [
      { title: "Lote en Manantiales II" },
      { title: "Centro de Distribución" },
    ]});
    const { data } = await mockSupabase(db).from("properties").select("*").filter("title", "imatch", "\\mManantiales\\M");
    expect(data).toHaveLength(1);
    const { data: d2 } = await mockSupabase(db).from("properties").select("*").filter("title", "imatch", "\\mcentro\\M");
    expect(d2).toHaveLength(1); // matchea la palabra exacta, insensible a mayúsculas
  });

  it("upsert con onConflict actualiza en vez de duplicar; FK sintética tira 23503", async () => {
    const db = createMockDb({
      clients: [{ id: "c1", user_id: "u1", full_name: "Ana" }],
      properties: [{ id: "p1", title: "Depto" }],
      client_properties: [],
    });
    const sb = mockSupabase(db);
    await sb.from("client_properties").upsert({ user_id: "u1", client_id: "c1", property_id: "p1", status: "sugerida" }, { onConflict: "client_id,property_id" });
    await sb.from("client_properties").upsert({ user_id: "u1", client_id: "c1", property_id: "p1", status: "enviada" }, { onConflict: "client_id,property_id" });
    expect(db.tables.client_properties).toHaveLength(1);
    expect(db.tables.client_properties[0].status).toBe("enviada");

    const { error } = await sb.from("client_properties").upsert({ user_id: "u1", client_id: "c1", property_id: "p-borrada" }, { onConflict: "client_id,property_id" });
    expect(error?.code).toBe("23503");
  });

  it("select anidado clients(full_name) resuelve la relación por FK", async () => {
    const db = createMockDb({
      clients: [{ id: "c1", full_name: "Ana" }],
      client_events: [{ client_id: "c1", user_id: "u1", title: "Cumple", event_date: "2026-05-03", recurrence: "yearly" }],
    });
    const { data } = await mockSupabase(db).from("client_events").select("id, title, clients(full_name)").eq("user_id", "u1");
    expect(data[0].clients?.full_name).toBe("Ana");
  });

  it("delete con eq borra solo lo filtrado", async () => {
    const db = createMockDb({ favorites: [
      { user_id: "u1", property_id: "p1" },
      { user_id: "u1", property_id: "p2" },
    ]});
    await mockSupabase(db).from("favorites").delete().eq("user_id", "u1").eq("property_id", "p1");
    expect(db.tables.favorites).toHaveLength(1);
    expect(db.tables.favorites[0].property_id).toBe("p2");
  });
});

describe("evaluateExpectations — evaluador puro", () => {
  const base: EvalCase = { id: "t", name: "t", user: "listame mis clientes", expect: {} };

  it("tools_include / exclude / include_any", () => {
    const r = { content: "ok", executedTools: ["list_clients"] };
    expect(evaluateExpectations({ ...base, expect: { tools_include: ["list_clients"] } }, r)).toEqual([]);
    expect(evaluateExpectations({ ...base, expect: { tools_include: ["get_client"] } }, r)).toHaveLength(1);
    expect(evaluateExpectations({ ...base, expect: { tools_exclude: ["send_email"] } }, r)).toEqual([]);
    expect(evaluateExpectations({ ...base, expect: { tools_exclude: ["list_clients"] } }, r)).toHaveLength(1);
    expect(evaluateExpectations({ ...base, expect: { tools_include_any: ["get_client", "list_clients"] } }, r)).toEqual([]);
  });

  it("text_match / text_not_match con flags i", () => {
    const r = { content: "Te preparé el borrador. ===MSG_BREAK=== ¿Lo ajusto?", executedTools: [] };
    expect(evaluateExpectations({ ...base, user: "x", expect: { text_match: ["===MSG_BREAK==="] } }, r)).toEqual([]);
    expect(evaluateExpectations({ ...base, user: "x", expect: { text_not_match: ["\\[Tu Nombre\\]"] } }, r)).toEqual([]);
    expect(evaluateExpectations({ ...base, user: "x", expect: { text_match: ["no aparece"] } }, r)).toHaveLength(1);
  });

  it("has_draft exige bloque balanceado y draft_no_markdown detecta ** adentro", () => {
    const ok = { content: "<<<DRAFT_START>>>\nHola\n<<<DRAFT_END>>>", executedTools: [] };
    const unbalanced = { content: "<<<DRAFT_START>>>\nHola", executedTools: [] };
    const md = { content: "<<<DRAFT_START>>>\nHola **fuerte**\n<<<DRAFT_END>>>", executedTools: [] };
    expect(evaluateExpectations({ ...base, user: "x", expect: { has_draft: true } }, ok)).toEqual([]);
    expect(evaluateExpectations({ ...base, user: "x", expect: { has_draft: true } }, unbalanced)).toHaveLength(1);
    expect(evaluateExpectations({ ...base, user: "x", expect: { has_draft: true, draft_no_markdown: true } }, md)).toHaveLength(1);
  });

  it("supervisor_deterministic_clean corre las reglas reales", () => {
    // Pedido de listar clientes sin ejecutar la tool → la regla READ rechaza.
    const dirty = evaluateExpectations(
      { ...base, expect: { supervisor_deterministic_clean: true } },
      { content: "Tus clientes son Ana y Juan.", executedTools: [] },
    );
    expect(dirty.some((f) => f.includes("READ"))).toBe(true);
    // Con la tool ejecutada, limpio.
    const clean = evaluateExpectations(
      { ...base, expect: { supervisor_deterministic_clean: true } },
      { content: "Tenés 2 clientes.", executedTools: ["list_clients"] },
    );
    expect(clean).toEqual([]);
  });
});

describe("golden-set.json — esquema y sanidad", () => {
  const cases = (goldenSet as { cases: EvalCase[] }).cases;

  it("tiene entre 40 y 60 casos con ids únicos", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(cases.length).toBeLessThanOrEqual(60);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("cada caso tiene user + expect con al menos una aserción, y las regexes compilan", () => {
    for (const c of cases) {
      expect(c.user, c.id).toBeTruthy();
      const e = c.expect ?? {};
      const hasAssertion = [e.tools_include, e.tools_include_any, e.tools_exclude, e.text_match, e.text_not_match].some((a) => (a?.length ?? 0) > 0)
        || e.has_draft === true || e.supervisor_deterministic_clean === true;
      expect(hasAssertion, `${c.id} no tiene ninguna aserción`).toBe(true);
      for (const p of [...(e.text_match ?? []), ...(e.text_not_match ?? [])]) {
        expect(() => new RegExp(p, "i"), `${c.id}: regex inválida ${p}`).not.toThrow();
      }
    }
  });

  it("los seeds de db extra referencian tablas del fixture base", () => {
    const known = new Set(Object.keys(defaultDb()));
    for (const c of cases) {
      for (const table of Object.keys(c.db ?? {})) {
        expect(known.has(table), `${c.id}: tabla desconocida ${table}`).toBe(true);
      }
    }
  });
});

// ---- End-to-end offline: modelo stubbeado (SSE), executor + mock-db reales ----

function sseResponse(events: string[]): Response {
  const body = events.join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
const toolChunk = (id: string, name: string, args: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] }, finish_reason: "tool_calls" }] })}\n\n`;
const contentChunk = (text: string, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`;

describe("runEvalCase end-to-end con modelo stubbeado", () => {
  it("el executor REAL corre contra el mock: search + texto final pasan las expectativas", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(sseResponse([toolChunk("c1", "search_properties", '{"zone":"Nueva Córdoba"}')]))
      .mockResolvedValueOnce(sseResponse([contentChunk("Encontré estas opciones que te van a servir:\n<<<PROPERTIES>>>", "stop")])) as typeof fetch;

    const caseDef: EvalCase = {
      id: "e2e-offline",
      name: "e2e",
      user: "buscame deptos en Nueva Córdoba",
      expect: { tools_include: ["search_properties"], text_match: ["<<<PROPERTIES>>>"], supervisor_deterministic_clean: true },
    };
    const r = await runEvalCase(caseDef, { apiKey: "stub" });
    expect(r.executedTools).toContain("search_properties");
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("una expectativa insatisfecha reporta el fallo (no lanza)", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(sseResponse([contentChunk("Tus clientes son Ana, Juan y Marta.", "stop")])) as typeof fetch;

    const caseDef: EvalCase = {
      id: "e2e-fail",
      name: "e2e fail",
      user: "listame mis clientes",
      expect: { tools_include: ["list_clients"], supervisor_deterministic_clean: true },
    };
    const r = await runEvalCase(caseDef, { apiKey: "stub" });
    expect(r.pass).toBe(false);
    expect(r.failures.length).toBeGreaterThanOrEqual(2); // tool faltante + regla READ
  });

  it("buildCaseDb mergea filas extra del caso sobre el fixture base", () => {
    const db = buildCaseDb({ id: "x", name: "x", user: "x", expect: {}, db: { clients: [{ user_id: EVAL_USER_ID, full_name: "Extra Uno", is_client: true }] } });
    const names = db.tables.clients.map((c: any) => c.full_name);
    expect(names).toContain("Ana Pérez");
    expect(names).toContain("Extra Uno");
  });
});
