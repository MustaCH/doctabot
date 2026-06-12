import { describe, it, expect, vi } from "vitest";
import { streamTurn, AIError } from "./stream-turn";

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
