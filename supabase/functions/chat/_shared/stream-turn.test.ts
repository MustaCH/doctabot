import { describe, it, expect, vi } from "vitest";
import { streamTurn, AIError, truncationSuffix, unbalancedDraftClose } from "./stream-turn";

// Construye una Response cuyo body es un ReadableStream que emite los chunks SSE dados.
function sseResponse(chunks: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok, status, body } as unknown as Response;
}

function contentChunk(text: string, finish: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`;
}
function toolChunk(index: number, id: string, name: string, args: string, finish: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: args } }] }, finish_reason: finish }] })}\n\n`;
}
const DONE = "data: [DONE]\n\n";

const toolDefinitions = [{ type: "function", function: { name: "search_properties" } }];

describe("unbalancedDraftClose", () => {
  it("devuelve el cierre faltante si hay un DRAFT abierto", () => {
    expect(unbalancedDraftClose("<<<DRAFT_START>>>a medias")).toBe("\n<<<DRAFT_END>>>");
  });
  it("devuelve '' si los marcadores están balanceados o no hay", () => {
    expect(unbalancedDraftClose("<<<DRAFT_START>>>ok<<<DRAFT_END>>>")).toBe("");
    expect(unbalancedDraftClose("texto sin borrador")).toBe("");
  });
});

describe("truncationSuffix", () => {
  it("cierra un DRAFT abierto cuando hay más START que END", () => {
    const s = truncationSuffix("<<<DRAFT_START>>>texto a medias");
    expect(s).toContain("<<<DRAFT_END>>>");
    expect(s).toContain("se cortó");
  });
  it("no cierra nada si los marcadores están balanceados", () => {
    const s = truncationSuffix("<<<DRAFT_START>>>ok<<<DRAFT_END>>>");
    expect(s).not.toContain("<<<DRAFT_END>>>");
    expect(s).toContain("se cortó");
  });
});

describe("streamTurn", () => {
  it("turno de texto puro: pipea cada token y devuelve el contenido completo", async () => {
    const resilientAIFetch = vi.fn(async () => sseResponse([contentChunk("Hola "), contentChunk("Alan", "stop"), DONE]));
    const executeTool = vi.fn();
    const emitted: string[] = [];

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
      { messages: [{ role: "user", content: "hola" }], emit: (t) => emitted.push(t) },
    );

    expect(emitted.join("")).toBe("Hola Alan");
    expect(res.content).toBe("Hola Alan");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("tools-then-text: ejecuta la tool y después pipea el texto", async () => {
    const resilientAIFetch = vi.fn()
      .mockResolvedValueOnce(sseResponse([toolChunk(0, "c1", "search_properties", '{"zone":"centro"}', "tool_calls"), DONE]))
      .mockResolvedValueOnce(sseResponse([contentChunk("Encontré 3", "stop"), DONE]));
    const executeTool = vi.fn(async () => JSON.stringify({ total_count: 3 }));
    const emitted: string[] = [];
    const messages: any[] = [{ role: "user", content: "buscá en centro" }];

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
      { messages, emit: (t) => emitted.push(t) },
    );

    expect(executeTool).toHaveBeenCalledWith("search_properties", { zone: "centro" }, {});
    expect(emitted.join("")).toBe("Encontré 3");
    expect(res.content).toBe("Encontré 3");
    expect(res.executedTools).toEqual(["search_properties"]);
    expect(messages.some((m) => m.role === "tool" && m.tool_call_id === "c1")).toBe(true);
  });

  it("si emit lanza (cliente desconectado) sigue acumulando el contenido completo", async () => {
    const resilientAIFetch = vi.fn(async () => sseResponse([contentChunk("parte1 "), contentChunk("parte2", "stop"), DONE]));
    const executeTool = vi.fn();
    const emit = vi.fn(() => { throw new Error("controller closed"); });

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
      { messages: [], emit },
    );

    expect(res.content).toBe("parte1 parte2");
  });

  it("lanza AIError con el status si la primera llamada es no-ok", async () => {
    const resilientAIFetch = vi.fn(async () => sseResponse([], false, 429));
    await expect(
      streamTurn({ resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions }, { messages: [], emit: () => {} }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("acepta una firstResponse ya fetcheada para la iteración 0", async () => {
    const resilientAIFetch = vi.fn();
    const first = sseResponse([contentChunk("desde primed", "stop"), DONE]);
    const res = await streamTurn(
      { resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions },
      { messages: [], emit: () => {}, firstResponse: first },
    );
    expect(resilientAIFetch).not.toHaveBeenCalled();
    expect(res.content).toBe("desde primed");
  });

  it("finish_reason 'length' con un DRAFT abierto: lo cierra y agrega aviso de truncado", async () => {
    const resilientAIFetch = vi.fn(async () =>
      sseResponse([contentChunk("Mirá este borrador: <<<DRAFT_START>>>Hola, te escribo por la propiedad", "length"), DONE]),
    );
    const emitted: string[] = [];
    const res = await streamTurn(
      { resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions },
      { messages: [], emit: (t) => emitted.push(t) },
    );
    // El draft quedó cerrado (no hay START sin END) y se avisó.
    expect((res.content.match(/<<<DRAFT_START>>>/g) || []).length).toBe(1);
    expect((res.content.match(/<<<DRAFT_END>>>/g) || []).length).toBe(1);
    expect(res.content).toContain("se cortó");
    // Lo truncado-cerrado también se streameó al cliente.
    expect(emitted.join("")).toBe(res.content);
  });

  it("finish_reason 'length' sin marcadores abiertos: solo agrega aviso", async () => {
    const resilientAIFetch = vi.fn(async () => sseResponse([contentChunk("Texto largo cortado", "length"), DONE]));
    const res = await streamTurn(
      { resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions },
      { messages: [], emit: () => {} },
    );
    expect(res.content).toContain("Texto largo cortado");
    expect(res.content).toContain("se cortó");
    expect(res.content).not.toContain("<<<DRAFT_END>>>");
  });

  it("turno normal (finish 'stop') con un DRAFT sin cerrar: lo cierra sin avisar truncación", async () => {
    const resilientAIFetch = vi.fn(async () =>
      sseResponse([contentChunk("Te dejo el mensaje: <<<DRAFT_START>>>Hola, soy Nacho", "stop"), DONE]),
    );
    const emitted: string[] = [];
    const res = await streamTurn(
      { resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions },
      { messages: [], emit: (t) => emitted.push(t) },
    );
    expect((res.content.match(/<<<DRAFT_START>>>/g) || []).length).toBe(1);
    expect((res.content.match(/<<<DRAFT_END>>>/g) || []).length).toBe(1);
    // No es truncación: no debe aparecer el aviso de "se cortó".
    expect(res.content).not.toContain("se cortó");
    // El cierre también se streameó (live == persistido).
    expect(emitted.join("")).toBe(res.content);
  });

  it("turno normal con DRAFT balanceado: no agrega nada", async () => {
    const resilientAIFetch = vi.fn(async () =>
      sseResponse([contentChunk("<<<DRAFT_START>>>Hola<<<DRAFT_END>>>", "stop"), DONE]),
    );
    const res = await streamTurn(
      { resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions },
      { messages: [], emit: () => {} },
    );
    expect((res.content.match(/<<<DRAFT_END>>>/g) || []).length).toBe(1);
    expect(res.content).toBe("<<<DRAFT_START>>>Hola<<<DRAFT_END>>>");
  });

  it("corta en maxIterations si el modelo siempre pide tools", async () => {
    const resilientAIFetch = vi.fn(async () => sseResponse([toolChunk(0, "c1", "search_properties", "{}", "tool_calls"), DONE]));
    const executeTool = vi.fn(async () => JSON.stringify({ results: [] }));
    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
      { messages: [], emit: () => {}, maxIterations: 2 },
    );
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(res.content).toBe("");
  });
});
