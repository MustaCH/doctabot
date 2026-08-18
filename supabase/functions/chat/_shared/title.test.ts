// Tests del ticket 86aj9w5kn: las dos llamadas a Flash de títulos van con max_tokens: 24
// y reasoning_effort "none" (el thinking de 2.5-flash cuenta dentro de max_tokens en el
// endpoint OpenAI-compat — con tope 24 y thinking prendido, el título saldría vacío).
import { describe, it, expect, afterEach, vi } from "vitest";
import { generateTitle, regenerateTitle } from "./title";

// jsdom no trae AbortSignal.timeout (sí existe en Deno/Node 20): sin el shim, title.ts
// tira antes del fetch y su catch silencioso hace pasar cualquier assert de "no llamó".
if (typeof AbortSignal.timeout !== "function") {
  (AbortSignal as any).timeout = () => new AbortController().signal;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFlash(title = "Depto para María") {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: title } }] }), { status: 200 }),
  );
  globalThis.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

function makeSupabase(convRow: { title_locked: boolean } | null = { title_locked: false }) {
  const calls: Array<{ m: string; a: any[] }> = [];
  const qb: any = {};
  const chain = (m: string) => (...a: any[]) => {
    calls.push({ m, a });
    return qb;
  };
  for (const m of ["from", "update", "select", "eq"]) qb[m] = chain(m);
  qb.maybeSingle = () => Promise.resolve({ data: convRow, error: null });
  qb.then = (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR);
  return { qb, calls };
}

describe("títulos con tope de salida (86aj9w5kn)", () => {
  it("generateTitle manda max_tokens 24 + reasoning_effort none y actualiza scopeado por user_id", async () => {
    const fetchMock = stubFlash();
    const { qb, calls } = makeSupabase();
    await generateTitle([{ role: "user", content: "hola" }], "respuesta", "conv1", "u1", qb, "key");

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.max_tokens).toBe(24);
    expect(body.reasoning_effort).toBe("none");
    expect(body.model).toBe("gemini-2.5-flash");
    expect(calls.some((c) => c.m === "update" && c.a[0]?.title === "Depto para María")).toBe(true);
    expect(calls.some((c) => c.m === "eq" && c.a[0] === "user_id" && c.a[1] === "u1")).toBe(true);
  });

  it("regenerateTitle manda el mismo tope (y respeta title_locked)", async () => {
    const fetchMock = stubFlash();
    const { qb } = makeSupabase({ title_locked: false });
    await regenerateTitle({ conversationId: "conv1", userId: "u1", supabase: qb, apiKey: "key", recentMessages: [{ role: "user", content: "vendemos el depto" }] });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.max_tokens).toBe(24);
    expect(body.reasoning_effort).toBe("none");

    // title_locked=true → ni siquiera llama a Flash
    const fetchMock2 = stubFlash();
    const { qb: qb2 } = makeSupabase({ title_locked: true });
    await regenerateTitle({ conversationId: "conv1", userId: "u1", supabase: qb2, apiKey: "key", recentMessages: [] });
    expect(fetchMock2).not.toHaveBeenCalled();
  });
});
