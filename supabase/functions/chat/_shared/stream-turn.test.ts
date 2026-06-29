import { describe, it, expect, vi } from "vitest";
import { streamTurn, AIError, truncationSuffix, unbalancedDraftClose, stripLeakedToolCalls, stripLeakedInternals } from "./stream-turn";

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

describe("stripLeakedToolCalls", () => {
  const names = ["link_conversation", "save_property_to_client", "search_properties"];

  it("strippea un call:NAME{...} fugado y reporta el nombre", () => {
    const { cleaned, leakedNames } = stripLeakedToolCalls(
      "Perfecto, ya lo vinculo. call:link_conversation{client_id:abc-123,conversation_type:search}",
      names,
    );
    expect(leakedNames).toEqual(["link_conversation"]);
    expect(cleaned).not.toContain("call:");
    expect(cleaned).toContain("Perfecto");
  });

  it("no toca texto legítimo sin tool-calls fugados", () => {
    const out = stripLeakedToolCalls("Te dejo 3 propiedades en Centro. ¿Te sirven?", names);
    expect(out.leakedNames).toEqual([]);
    expect(out.cleaned).toBe("Te dejo 3 propiedades en Centro. ¿Te sirven?");
  });

  it("ignora call: con un nombre que NO es una tool real (no borra texto legítimo)", () => {
    const out = stripLeakedToolCalls("mirá esta call:funcion_inventada{x:1}", names);
    expect(out.leakedNames).toEqual([]);
    expect(out.cleaned).toContain("funcion_inventada");
  });
});

describe("stripLeakedInternals (proceso interno filtrado al texto final)", () => {
  const names = ["search_properties", "list_clients", "save_property_to_client", "get_client", "link_conversation"];

  it("quita la sintaxis 'Executing function call: NAME{...}' dejando la frase del usuario", () => {
    const out = stripLeakedInternals(
      "Empiezo por los que están \"Calientes\". Dame un segundo.\nExecuting function call: list_clients{limit:1000,status:hot}",
      names,
    );
    expect(out).not.toMatch(/function call/i);
    expect(out).not.toContain("list_clients{");
    expect(out).toContain("Dame un segundo");
  });

  it("quita una invocación pegada al texto (NAME(...)): search_properties(...)", () => {
    const out = stripLeakedInternals(
      "Voy a buscar propiedades con esos criterios. Dame un momento... search_properties(currency:USD,max_price:325000,property_type:Duplex,zone:Nueva Córdoba)",
      names,
    );
    expect(out).not.toContain("search_properties(");
    expect(out).toContain("Dame un momento");
  });

  it("quita el header '🧠 … está pensando'", () => {
    const out = stripLeakedInternals("# 🧠 Alan, el asistente de IA, está pensando...\n¡Listo! Acá va la respuesta.", names);
    expect(out).not.toMatch(/está pensando/);
    expect(out).not.toContain("🧠");
    expect(out).toContain("Acá va la respuesta");
  });

  it("quita el marcador 🛠️ con sus parámetros key: value", () => {
    const out = stripLeakedInternals(
      "Hago una búsqueda amplia.🛠️llama a la herramienta search_properties con los siguientes parámetros:\noperation: Alquiler\nproperty_type: Departamento\nListo, acá tenés.",
      names,
    );
    expect(out).not.toContain("🛠️");
    expect(out).not.toMatch(/operation: Alquiler/);
    expect(out).toContain("Listo, acá tenés");
  });

  it("NO toca prosa legítima ni menciones sin sintaxis de invocación", () => {
    const legit = "Te paso 3 deptos en Centro. Si querés, después coordinamos una visita. 😉";
    expect(stripLeakedInternals(legit, names)).toBe(legit);
    // 🧠 usado como emoji legítimo (sin "pensando") no se toca
    const emoji = "Buen dato 🧠 para tener en cuenta.";
    expect(stripLeakedInternals(emoji, names)).toBe(emoji);
    // nombre de tool mencionado en prosa pero SIN (..)/{..} (ej. entre paréntesis) no se borra
    const mention = "Usé la búsqueda interna (search_properties) y encontré 3.";
    expect(stripLeakedInternals(mention, names)).toBe(mention);
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

  // Regresión del bug 86aj1ncj4 (send_email que no se enviaba): args truncados/malformados en el
  // tool_call (send_email lleva el body completo, el payload más grande). Antes, el `JSON.parse`
  // sin guarda en execute-round.ts explotaba y abortaba el turno ENTERO antes de ejecutar nada → el
  // usuario veía el error estático. Con la guarda, degrada: se inyecta un tool-message de error y el
  // modelo puede recuperar dentro del mismo turno (la tool NO corre → no hay envío fantasma).
  it("args de tool_call malformados NO abortan el turno: degradan y el modelo recupera", async () => {
    const resilientAIFetch = vi.fn()
      // iter 0: JSON incompleto (stream cortado a la mitad del cuerpo del email).
      .mockResolvedValueOnce(sseResponse([toolChunk(0, "c1", "send_email", '{"to":"yo@mail.com","subject":"Hola","body":"texto a medias', "tool_calls"), DONE]))
      // iter 1: el modelo ve el tool-message de error y responde con texto.
      .mockResolvedValueOnce(sseResponse([contentChunk("Perdón, se cortó algo. ¿Me repetís a quién se lo mando?", "stop"), DONE]));
    const executeTool = vi.fn();
    const messages: any[] = [{ role: "user", content: "envialo" }];

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions },
      { messages, emit: () => {} },
    );

    // No tiró; el tool con args rotos NO se ejecutó (no hay mail fantasma); el modelo recuperó.
    expect(executeTool).not.toHaveBeenCalled();
    expect(res.content).toBe("Perdón, se cortó algo. ¿Me repetís a quién se lo mando?");
    // Se inyectó un tool-message de error con el id del call para que el modelo sepa que falló.
    expect(messages.some((m) => m.role === "tool" && m.tool_call_id === "c1" && m.content.includes("error"))).toBe(true);
  });

  // Riesgo LATENTE relacionado (no fue lo que pasó en este incidente — Nacho confirmó que no hubo
  // doble envío). Si un tool con side-effect externo corre en iter 0 y la llamada de IA de iter 1
  // falla, streamTurn tira DESPUÉS de que el efecto ya ocurrió → un reintento lo re-ejecutaría.
  // Guard para que la idempotencia se contemple cuando se toque el tool-loop.
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

  // Regresión del bug 86aj4276y: Gemini (OpenAI-compat) emite tool calls PARALELOS en una misma
  // ronda como deltas completos (id+name+args) a veces con el MISMO index. El acumulador keyeaba por
  // index → fusionaba los dos en uno (name pisado, args concatenados `{...}{...}`). Eso rompía el
  // JSON.parse (tool no corría) Y la continuación mandaba 1 function_call donde Gemini generó 2 →
  // 400 INVALID_ARGUMENT → "Lo siento, hubo un problema". El flujo "buscá para [cliente]"
  // (link_conversation + search_properties en paralelo) caía SIEMPRE.
  it("dos tool calls en paralelo en la misma ronda (Gemini, mismo index) NO se fusionan", async () => {
    const resilientAIFetch = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        toolChunk(0, "id-link", "link_conversation", '{"conversation_type":"search","client_id":"abc"}'),
        toolChunk(0, "id-search", "search_properties", '{"zone":"Nueva Cordoba"}', "tool_calls"),
        DONE,
      ]))
      .mockResolvedValueOnce(sseResponse([contentChunk("Encontré 2 dúplex.", "stop"), DONE]));
    const executeTool = vi.fn(async (name: string) => JSON.stringify({ ok: name }));
    const messages: any[] = [{ role: "user", content: "buscá para Armando" }];
    const defs = [
      { type: "function", function: { name: "link_conversation" } },
      { type: "function", function: { name: "search_properties" } },
    ];

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions: defs },
      { messages, emit: () => {} },
    );

    // Cada tool corre con SUS argumentos (no concatenados ni pisados).
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledWith("link_conversation", { conversation_type: "search", client_id: "abc" }, {});
    expect(executeTool).toHaveBeenCalledWith("search_properties", { zone: "Nueva Cordoba" }, {});
    // Dos tool-messages con ids distintos para que la continuación matchee los 2 function_call de Gemini.
    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(2);
    expect(new Set(toolMsgs.map((m) => m.tool_call_id))).toEqual(new Set(["id-link", "id-search"]));
    expect(res.content).toBe("Encontré 2 dúplex.");
  });

  it("recupera un tool-call fugado como texto: lo strippea, re-promptea y lo ejecuta de verdad (86aj1nb0t)", async () => {
    const resilientAIFetch = vi.fn()
      // iter 0: el modelo "narra" la tool como texto (leak) y termina en stop.
      .mockResolvedValueOnce(sseResponse([contentChunk("Listo, ya lo vinculo. call:link_conversation{client_id:abc-123,conversation_type:search}", "stop"), DONE]))
      // iter 1: re-prompteado, ahora la invoca de verdad por el canal de tools.
      .mockResolvedValueOnce(sseResponse([toolChunk(0, "c1", "link_conversation", '{"client_id":"abc-123"}', "tool_calls"), DONE]))
      // iter 2: narra el resultado real.
      .mockResolvedValueOnce(sseResponse([contentChunk("Listo, vinculé la conversación al cliente.", "stop"), DONE]));
    const executeTool = vi.fn(async () => JSON.stringify({ success: true }));
    const emitted: string[] = [];
    const messages: any[] = [{ role: "user", content: "vinculá esto a abc-123" }];

    const res = await streamTurn(
      { resilientAIFetch, executeTool, toolCtx: {}, toolDefinitions: [{ type: "function", function: { name: "link_conversation" } }] },
      { messages, emit: (t) => emitted.push(t) },
    );

    // El leak NO se mostró ni se persistió.
    expect(emitted.join("")).not.toContain("call:");
    expect(res.content).not.toContain("call:");
    // La tool se ejecutó DE VERDAD (recuperada) y el usuario ve solo la narración final correcta.
    expect(executeTool).toHaveBeenCalledWith("link_conversation", { client_id: "abc-123" }, {});
    expect(res.content).toBe("Listo, vinculé la conversación al cliente.");
  });

  // Guardarraíl de links inventados: la ronda final se bufferiza, así que sanitizeFinal corre
  // sobre el texto completo ANTES de volcarlo. Lo que ve el cliente == lo que se persiste.
  it("sanitizeFinal transforma la ronda de texto final antes de emitir/persistir", async () => {
    const resilientAIFetch = vi.fn(async () => sseResponse([contentChunk("link inventado", "stop"), DONE]));
    const emitted: string[] = [];
    const sanitizeFinal = vi.fn(async (t: string) => t.replace("inventado", "[neutralizado]"));

    const res = await streamTurn(
      { resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions },
      { messages: [], emit: (t) => emitted.push(t), sanitizeFinal },
    );

    expect(sanitizeFinal).toHaveBeenCalledOnce();
    expect(res.content).toBe("link [neutralizado]");
    expect(emitted.join("")).toBe("link [neutralizado]"); // live == persistido
  });

  it("sanitizeFinal que tira NO rompe el turno: se usa el texto original (fail-open)", async () => {
    const resilientAIFetch = vi.fn(async () => sseResponse([contentChunk("texto original", "stop"), DONE]));
    const sanitizeFinal = vi.fn(async () => { throw new Error("db down"); });

    const res = await streamTurn(
      { resilientAIFetch, executeTool: vi.fn(), toolCtx: {}, toolDefinitions },
      { messages: [], emit: () => {}, sanitizeFinal },
    );

    expect(res.content).toBe("texto original");
  });
});
