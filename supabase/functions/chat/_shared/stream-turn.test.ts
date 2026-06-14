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

  it("suprime el preámbulo de una ronda que termina en tool_calls (no re-saludo): solo muestra la ronda de texto final", async () => {
    const resilientAIFetch = vi.fn()
      .mockResolvedValueOnce(sseResponse([contentChunk("¡Hola, Ignacio! Dame que reviso a Armando. "), toolChunk(0, "c1", "search_properties", '{"zone":"centro"}', "tool_calls"), DONE]))
      .mockResolvedValueOnce(sseResponse([contentChunk("Encontré 3 propiedades para vos.", "stop"), DONE]));
    const executeTool = vi.fn(async () => JSON.stringify({ total_count: 3 }));
    const emitted: string[] = [];
    const messages: any[] = [{ role: "user", content: "buscá para Armando" }];

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
      { messages, emit: (t) => emitted.push(t) },
    );

    // El preámbulo de la ronda con tool_calls NO se mostró ni se persistió (sin re-saludo).
    expect(emitted.join("")).toBe("Encontré 3 propiedades para vos.");
    expect(res.content).toBe("Encontré 3 propiedades para vos.");
    expect(res.content).not.toContain("Hola");
    // Pero sí quedó en `messages` (memoria del modelo) y la tool corrió.
    expect(executeTool).toHaveBeenCalledWith("search_properties", { zone: "centro" }, {});
    expect(messages.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("Hola"))).toBe(true);
  });

  it("si el turno se queda sin ronda de texto final, vuelca el último preámbulo suprimido (fallback anti-pantalla-muda)", async () => {
    const resilientAIFetch = vi.fn(async () =>
      sseResponse([contentChunk("Buscando propiedades… "), toolChunk(0, "c1", "search_properties", "{}", "tool_calls"), DONE]),
    );
    const executeTool = vi.fn(async () => JSON.stringify({ results: [] }));
    const emitted: string[] = [];

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
      { messages: [], emit: (t) => emitted.push(t), maxIterations: 1 },
    );

    expect(res.content).toBe("Buscando propiedades… ");
    expect(emitted.join("")).toBe("Buscando propiedades… ");
  });

  // Regresión del bug 86aj1ncj4 (doble envío de email). Un turno con side-effect externo
  // (send_email) ejecuta la tool en iter 0 y recién redacta la confirmación en iter 1. Si la
  // llamada de IA de iter 1 falla transitoriamente, streamTurn tira DESPUÉS de que el efecto
  // externo ya ocurrió → el reintento del usuario lo re-ejecuta. Este test fija el comportamiento
  // actual (la tool corre antes del fallo) y deja el gancho para validar la idempotencia del fix.
  it("la tool con side-effect ya se ejecutó cuando falla la llamada de IA post-tool (iter 1)", async () => {
    const resilientAIFetch = vi.fn()
      .mockResolvedValueOnce(sseResponse([toolChunk(0, "c1", "send_email", '{"to":"cliente@mail.com","subject":"Hola","body":"Cuerpo"}', "tool_calls"), DONE]))
      .mockResolvedValueOnce(sseResponse([], false, 503)); // iter 1: fallo transitorio del proveedor
    const executeTool = vi.fn(async () => JSON.stringify({ success: true, message_id: "m1" }));

    await expect(
      streamTurn(
        { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
        { messages: [{ role: "user", content: "envialo" }], emit: () => {} },
      ),
    ).rejects.toMatchObject({ status: 503 });

    // El envío YA ocurrió (iter 0) antes de que el turno se cayera (iter 1): sin idempotencia,
    // el reintento del usuario ejecutaría send_email una segunda vez → email duplicado.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("send_email", { to: "cliente@mail.com", subject: "Hola", body: "Cuerpo" }, {});
  });
});
