// Runner del harness de evals (ticket 86aj9w5mg — KEYSTONE).
// Ejecuta el turno REAL de Alan (streamTurn + executeTool reales, modelo real vía la API de
// Gemini) contra una DB in-memory (mock-db.ts) y evalúa expectativas deterministas:
// tools ejecutadas, regexes sobre el texto, marcadores de draft balanceados y las reglas
// deterministas del supervisor (unactedRead/unexecutedWrite/unsupportedSearchClaim).
//
// evaluateExpectations es puro (testeado offline en harness.test.ts); runEvalCase es la
// única parte que pega a la API real y solo corre vía `npm run test:evals`.

import { streamTurn } from "../stream-turn.ts";
import { executeTool } from "../tools/executor.ts";
import { toolDefinitions } from "../tools/definitions.ts";
import { buildContextualPrompt, buildAIMessages, buildActiveClientBlock, buildDateBlock, type ActiveClientInfo } from "../prompt.ts";
import { fetchWithRetry } from "../retry.ts";
import { unactedReadVerdict, unexecutedWriteVerdict, unsupportedSearchClaimVerdict } from "../supervisor-rules.ts";
import { createMockDb, mockSupabase, type MockDb } from "./mock-db.ts";

export interface EvalExpect {
  /** Todas estas tools deben figurar en executedTools. */
  tools_include?: string[];
  /** Al menos UNA de estas debe figurar (para pedidos con más de una tool válida). */
  tools_include_any?: string[];
  /** Ninguna de estas puede figurar en executedTools. */
  tools_exclude?: string[];
  /** Regexes (flags i) que el texto final DEBE matchear. */
  text_match?: string[];
  /** Regexes (flags i) que el texto final NO puede matchear. */
  text_not_match?: string[];
  /** El texto contiene al menos un bloque DRAFT balanceado. */
  has_draft?: boolean;
  /** Dentro de los bloques DRAFT no puede haber markdown (** o ###). */
  draft_no_markdown?: boolean;
  /** Las tres reglas deterministas del supervisor deben dar null (sin rechazo). */
  supervisor_deterministic_clean?: boolean;
}

export interface EvalCase {
  id: string;
  name: string;
  tags?: string[];
  /** Mensaje del usuario del turno a evaluar. */
  user: string;
  /** Historial previo opcional: [{role: "user"|"assistant", content}]. */
  history?: Array<{ role: string; content: string }>;
  /** Cliente vinculado a la conversación (inyecta el bloque CLIENTE ACTIVO). */
  active_client?: ActiveClientInfo & { full_name: string };
  /** Filas extra para el mock (se MERGEAN sobre DEFAULT_DB por tabla). */
  db?: Record<string, Record<string, any>[]>;
  /**
   * Deficiencia REAL y conocida del modelo/prompt (xfail): el caso corre y se reporta,
   * pero no falla CI ni entra al pass-rate global. Si empieza a PASAR, el reporte lo
   * celebra para endurecerlo. El valor documenta el problema/ticket asociado.
   */
  known_issue?: string;
  expect: EvalExpect;
}

export interface EvalRunResult {
  caseId: string;
  content: string;
  executedTools: string[];
  failures: string[];
  pass: boolean;
  error?: string;
}

export const EVAL_USER_ID = "00000000-0000-4000-8000-00000000e0a1";
export const EVAL_AGENT_NAME = "Nacho Test";
export const EVAL_AGENT_CODE = "docta-eval";

/** Fixture base compartida: clientes/propiedades sintéticas que reusa la mayoría de los casos. */
export function defaultDb(): Record<string, Record<string, any>[]> {
  return {
    clients: [
      { id: "11111111-1111-4111-8111-000000000001", user_id: EVAL_USER_ID, full_name: "Ana Pérez", is_client: true, status: "hot", client_type: "buyer", phone: "+5493511111111", email: "ana@mail.com", preferred_zones: "Nueva Córdoba", budget_max: 120000, budget_currency: "USD", property_type_interest: "departamento", notes: null, last_contact_at: null },
      { id: "11111111-1111-4111-8111-000000000002", user_id: EVAL_USER_ID, full_name: "Juan Gómez", is_client: true, status: "warm", client_type: "seller", phone: "+5493512222222", email: "juan@mail.com", preferred_zones: "Manantiales", notes: null },
      { id: "11111111-1111-4111-8111-000000000003", user_id: EVAL_USER_ID, full_name: "Marta López", is_client: true, status: "cold", client_type: "both", phone: null, email: null, birthday: "1980-05-03", notes: null },
      { id: "11111111-1111-4111-8111-000000000004", user_id: EVAL_USER_ID, full_name: "Susana Pérez", is_client: false, status: "warm", client_type: "buyer", phone: "+5493513333333", email: null, notes: null },
    ],
    // OJO formato de zonas: en prod properties.zone/locality vienen NORMALIZADAS (lowercase,
    // sin acentos) — el executor busca con stripAccents y el ilike de Postgres (y del mock)
    // es sensible a acentos. Un fixture con "Nueva Córdoba" da 0 resultados y el modelo
    // reintenta hasta agotar maxIterations (pasó en el baseline). Los títulos sí llevan acento.
    properties: [
      { id: "22222222-2222-4222-8222-000000000001", title: "Depto 2 dorm Nueva Córdoba", zone: "nueva cordoba", locality: "cordoba", operation: "Venta", property_type: "Departamento", price: 110000, currency: "USD", habitaciones: 2, m2_total: 75, office: "REMAX Docta", listing_status: "active", url: "https://www.remax.com.ar/listings/depto-2-dorm-nueva-cordoba-eval", photo: "p1.jpg", photos: ["p1.jpg"], address: "Bv. Illia 400", created_at: "2026-08-01T00:00:00Z" },
      { id: "22222222-2222-4222-8222-000000000002", title: "Depto 1 dorm Nueva Córdoba con balcón", zone: "nueva cordoba", locality: "cordoba", operation: "Venta", property_type: "Departamento", price: 135000, currency: "USD", habitaciones: 1, m2_total: 50, office: "REMAX Docta", listing_status: "active", url: "https://www.remax.com.ar/listings/depto-1-dorm-nc-eval", photo: "p2.jpg", photos: ["p2.jpg"], address: "Obispo Trejo 900", created_at: "2026-08-05T00:00:00Z" },
      { id: "22222222-2222-4222-8222-000000000003", title: "Casa 3 dorm en Manantiales", zone: "manantiales", locality: "cordoba", operation: "Venta", property_type: "Casa", price: 185000, currency: "USD", habitaciones: 3, m2_total: 180, office: "REMAX Docta", listing_status: "active", url: "https://www.remax.com.ar/listings/casa-3-dorm-manantiales-eval", photo: "p3.jpg", photos: ["p3.jpg"], address: "Manantiales etapa 2", created_at: "2026-08-03T00:00:00Z" },
      { id: "22222222-2222-4222-8222-000000000004", title: "Depto 3 dorm Centro apto profesional", zone: "centro", locality: "cordoba", operation: "Alquiler", property_type: "Departamento", price: 550000, currency: "ARS", habitaciones: 3, m2_total: 90, office: "REMAX Sinergia", listing_status: "active", url: "https://www.remax.com.ar/listings/depto-3-dorm-centro-eval", photo: "p4.jpg", photos: ["p4.jpg"], address: "27 de Abril 300", created_at: "2026-08-02T00:00:00Z" },
    ],
    favorites: [
      { user_id: EVAL_USER_ID, property_id: "22222222-2222-4222-8222-000000000003" },
    ],
    client_properties: [],
    client_notes: [],
    client_events: [],
    conversations: [
      { id: "33333333-3333-4333-8333-000000000001", user_id: EVAL_USER_ID, title: "Eval", client_id: null },
    ],
  };
}

export function buildCaseDb(caseDef: EvalCase): MockDb {
  const seed = defaultDb();
  for (const [table, rows] of Object.entries(caseDef.db ?? {})) {
    seed[table] = [...(seed[table] ?? []), ...rows];
  }
  return createMockDb(seed);
}

const DRAFT_START = "<<<DRAFT_START>>>";
const DRAFT_END = "<<<DRAFT_END>>>";

function extractDrafts(text: string): string[] {
  const drafts: string[] = [];
  const re = /<<<DRAFT_START>>>([\s\S]*?)<<<DRAFT_END>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) drafts.push(m[1]);
  return drafts;
}

/** Evalúa las expectativas de un caso sobre el resultado del turno. Puro. */
export function evaluateExpectations(
  caseDef: EvalCase,
  result: { content: string; executedTools: string[]; lastSearchAppliedFilters?: Record<string, unknown> | null },
): string[] {
  const failures: string[] = [];
  const { content, executedTools } = result;
  const e = caseDef.expect ?? {};

  for (const t of e.tools_include ?? []) {
    if (!executedTools.includes(t)) failures.push(`tool esperada NO ejecutada: ${t} (ejecutadas: [${executedTools.join(", ")}])`);
  }
  if (e.tools_include_any?.length && !e.tools_include_any.some((t) => executedTools.includes(t))) {
    failures.push(`ninguna de las tools esperadas se ejecutó: [${e.tools_include_any.join(", ")}] (ejecutadas: [${executedTools.join(", ")}])`);
  }
  for (const t of e.tools_exclude ?? []) {
    if (executedTools.includes(t)) failures.push(`tool prohibida ejecutada: ${t}`);
  }
  for (const p of e.text_match ?? []) {
    if (!new RegExp(p, "i").test(content)) failures.push(`el texto no matchea /${p}/i`);
  }
  for (const p of e.text_not_match ?? []) {
    if (new RegExp(p, "i").test(content)) failures.push(`el texto matchea el patrón prohibido /${p}/i`);
  }
  if (e.has_draft) {
    const starts = content.split(DRAFT_START).length - 1;
    const ends = content.split(DRAFT_END).length - 1;
    if (starts === 0) failures.push("no hay bloque DRAFT y se esperaba uno");
    else if (starts !== ends) failures.push(`marcadores DRAFT desbalanceados (${starts} start / ${ends} end)`);
  }
  if (e.draft_no_markdown) {
    for (const d of extractDrafts(content)) {
      if (/\*\*|^#{1,3}\s/m.test(d)) { failures.push("hay markdown (**/#) dentro de un bloque DRAFT"); break; }
    }
  }
  if (e.supervisor_deterministic_clean) {
    const read = unactedReadVerdict(caseDef.user, executedTools);
    const write = unexecutedWriteVerdict(content, executedTools);
    const claim = unsupportedSearchClaimVerdict(content, executedTools, result.lastSearchAppliedFilters ?? null);
    if (read) failures.push(`regla determinista READ rechazó: ${read.reason}`);
    if (write) failures.push(`regla determinista WRITE rechazó: ${write.reason}`);
    if (claim) failures.push(`regla determinista SEARCH-CLAIM rechazó: ${claim.reason}`);
  }
  return failures;
}

export interface RunnerOpts {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

/** Ejecuta un caso contra la API real. El ÚNICO efecto externo es la llamada al modelo. */
export async function runEvalCase(caseDef: EvalCase, opts: RunnerOpts): Promise<EvalRunResult> {
  const model = opts.model ?? "gemini-3.7-flash"; // mismo modelo que el turno principal en prod (86aj9w5nf)
  const db = buildCaseDb(caseDef);

  // Si el caso trae cliente activo, lo vinculamos también en el mock (paridad con prod).
  let activeClientBlock = "";
  if (caseDef.active_client) {
    activeClientBlock = buildActiveClientBlock(caseDef.active_client);
  }

  const toolCtx: Record<string, any> = {
    supabase: mockSupabase(db),
    userId: EVAL_USER_ID,
    conversationId: "33333333-3333-4333-8333-000000000001",
    getCalendarToken: async () => null, // Google desconectado: email/calendar NUNCA pegan afuera
    cardResults: [],
  };

  // Paridad con prod (86aj9w5n8): prefijo estático primero, bloques dinámicos después y la
  // fecha/hora AL FINAL (en prod ese orden preserva el prefijo cacheable).
  const systemContent = [buildContextualPrompt(EVAL_AGENT_NAME, EVAL_AGENT_CODE), activeClientBlock, buildDateBlock()].filter(Boolean).join("\n\n");
  const messages: any[] = [
    { role: "system", content: systemContent },
    ...buildAIMessages([...(caseDef.history ?? []), { role: "user", content: caseDef.user }]),
  ];

  const resilientAIFetch = async (body: Record<string, any>): Promise<Response> => {
    const payload = JSON.stringify({ ...body, model, max_tokens: opts.maxTokens ?? 8192 });
    return fetchWithRetry(() => fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    }));
  };

  try {
    const result = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx, toolDefinitions },
      { messages, emit: () => {} },
    );
    const failures = evaluateExpectations(caseDef, {
      content: result.content,
      executedTools: result.executedTools ?? [],
      lastSearchAppliedFilters: toolCtx.lastSearchAppliedFilters ?? null,
    });
    return { caseId: caseDef.id, content: result.content, executedTools: result.executedTools ?? [], failures, pass: failures.length === 0 };
  } catch (err) {
    return { caseId: caseDef.id, content: "", executedTools: [], failures: [`el turno tiró: ${String(err)}`], pass: false, error: String(err) };
  }
}

/** Pool simple de concurrencia para correr el set sin serializar (ni saturar la API). */
export async function runAll(
  cases: EvalCase[],
  opts: RunnerOpts & { runsPerCase?: number; concurrency?: number; onResult?: (r: EvalRunResult) => void },
): Promise<Map<string, EvalRunResult[]>> {
  const runs = Math.max(1, opts.runsPerCase ?? 1);
  const jobs: Array<{ c: EvalCase }> = [];
  for (const c of cases) for (let i = 0; i < runs; i++) jobs.push({ c });
  const results = new Map<string, EvalRunResult[]>();
  const workers = Math.max(1, Math.min(opts.concurrency ?? 4, jobs.length));
  let idx = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (idx < jobs.length) {
        const job = jobs[idx++];
        const r = await runEvalCase(job.c, opts);
        if (!results.has(job.c.id)) results.set(job.c.id, []);
        results.get(job.c.id)!.push(r);
        opts.onResult?.(r);
      }
    }),
  );
  return results;
}
