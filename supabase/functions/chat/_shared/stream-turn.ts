// Driver del turno con tool loop. Todas las llamadas a Gemini van con stream:true.
// El contenido de cada ronda se BUFFERIZA y recién se vuelca al cliente (`emit`) cuando se
// conoce el finish_reason: si la ronda termina en tool_calls su preámbulo se DESCARTA (supresión
// determinista del re-saludo y la narración duplicada, 86aj1n43n); solo la ronda de texto final
// se muestra. Los tool_calls se acumulan por índice y se ejecutan (bloqueante) entre iteraciones.
// Puro (deps inyectadas) → testeable.

import { drainSSE } from "./sse-parse.ts";
import { executeToolCalls, AccumulatedToolCall } from "./tools/execute-round.ts";

export class AIError extends Error {
  status: number;
  constructor(status: number) {
    super(`AI error: ${status}`);
    this.name = "AIError";
    this.status = status;
  }
}

export interface StreamTurnDeps {
  resilientAIFetch: (body: Record<string, any>) => Promise<Response>;
  executeTool: (name: string, args: any, ctx: any) => Promise<string>;
  toolCtx: any;
  toolDefinitions: any[];
}

export interface StreamTurnOptions {
  messages: any[];                 // mutado in-place con assistant tool_calls + tool results
  emit: (text: string) => void;    // recibe cada token de content para reenviar al cliente
  firstResponse?: Response;        // respuesta ya fetcheada para la iteración 0 (status ya validado)
  maxIterations?: number;          // default 5
}

export interface StreamTurnResult {
  content: string;
  executedTools: string[];
}

/**
 * Validación mínima de formato: si quedó un <<<DRAFT_START>>> sin su <<<DRAFT_END>>>,
 * devuelve el cierre faltante (si no, ""). Evita que el front parsee un borrador a medias.
 * Puro y testeable.
 */
export function unbalancedDraftClose(content: string): string {
  const opens = (content.match(/<<<DRAFT_START>>>/g) || []).length;
  const closes = (content.match(/<<<DRAFT_END>>>/g) || []).length;
  return opens > closes ? "\n<<<DRAFT_END>>>" : "";
}

/**
 * Sufijo a agregar cuando Gemini corta la respuesta por longitud (finish_reason: "length").
 * Cierra un <<<DRAFT_*>>> que haya quedado abierto y agrega un aviso visible. Puro y testeable.
 */
export function truncationSuffix(content: string): string {
  return unbalancedDraftClose(content) + "\n\n⚠️ La respuesta se cortó por su longitud. Pedime que la continúe.";
}

export async function streamTurn(deps: StreamTurnDeps, opts: StreamTurnOptions): Promise<StreamTurnResult> {
  const { resilientAIFetch, executeTool, toolCtx, toolDefinitions } = deps;
  const { messages, emit } = opts;
  const maxIterations = opts.maxIterations ?? 5;

  const executedTools: string[] = [];
  let fullContent = "";
  let lastPreamble = "";     // contenido de la última ronda suprimida (tool_calls); fallback si el turno no llega a una ronda de texto final
  let emittedFinal = false;  // true cuando ya volcamos una ronda final (texto o length)

  const safeEmit = (t: string) => { if (!t) return; try { emit(t); } catch { /* cliente desconectado: seguimos drenando */ } };

  for (let iter = 0; iter < maxIterations; iter++) {
    let res: Response;
    if (iter === 0 && opts.firstResponse) {
      res = opts.firstResponse;
    } else {
      res = await resilientAIFetch({ messages, tools: toolDefinitions, stream: true });
    }
    if (!res.ok) throw new AIError(res.status);
    if (!res.body) throw new AIError(res.status || 500);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finishReason: string | null = null;
    let assistantContent = "";
    const toolAccum = new Map<number, AccumulatedToolCall>();

    const applyDelta = (d: { contentDelta?: string; toolCallDeltas?: any[]; finishReason?: string | null }) => {
      if (d.contentDelta) {
        // No se emite ni se acumula en vivo: el contenido de la ronda se bufferiza y recién se
        // vuelca (o se descarta, si la ronda termina en tool_calls) al conocer el finish_reason.
        assistantContent += d.contentDelta;
      }
      if (d.toolCallDeltas) {
        for (const tcd of d.toolCallDeltas) {
          const cur = toolAccum.get(tcd.index) ?? { id: "", name: "", arguments: "" };
          if (tcd.id) cur.id = tcd.id;
          if (tcd.name) cur.name = tcd.name;
          if (tcd.argsFragment) cur.arguments += tcd.argsFragment;
          toolAccum.set(tcd.index, cur);
        }
      }
      if (d.finishReason) finishReason = d.finishReason;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { deltas, rest } = drainSSE(buf);
      buf = rest;
      for (const d of deltas) applyDelta(d);
    }
    // Drenar cualquier línea final que quedó sin newline.
    if (buf.trim()) {
      const { deltas } = drainSSE(buf + "\n");
      for (const d of deltas) applyDelta(d);
    }

    if (finishReason === "length") {
      // Ronda final truncada por límite de tokens: volcamos el contenido bufferizado + cierre de
      // marcadores abiertos + aviso, en vez de persistir/mostrar un borrador o tarjeta a medias.
      const flush = assistantContent + truncationSuffix(assistantContent);
      fullContent += flush;
      safeEmit(flush);
      emittedFinal = true;
      break;
    }

    if (finishReason === "tool_calls" && toolAccum.size > 0) {
      // Opción 2 (86aj1n43n): el preámbulo de una ronda que termina en tool_calls NO se muestra
      // ni se persiste. El modelo regenera saludos/narración en las continuaciones del mismo turno
      // y mostrarlos produce el re-saludo y la narración duplicada. El texto SÍ se conserva en
      // `messages` (memoria del modelo) y como fallback si el turno no llega a una ronda final.
      lastPreamble = assistantContent;
      const toolCalls = [...toolAccum.values()];
      messages.push({
        role: "assistant",
        content: assistantContent || null,
        tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })),
      });
      const { toolMessages, executed } = await executeToolCalls(toolCalls, { executeTool, toolCtx });
      messages.push(...toolMessages);
      executedTools.push(...executed);
      continue;
    }

    // Ronda de texto final: recién acá se vuelca al cliente (bufferizada, de una). Validación
    // mínima de formato: si el modelo dejó un <<<DRAFT_START>>> sin cerrar (sin truncación),
    // agregamos el cierre faltante para que el front no parsee un borrador a medias.
    const flush = assistantContent + unbalancedDraftClose(assistantContent);
    fullContent += flush;
    safeEmit(flush);
    emittedFinal = true;
    break;
  }

  // El turno agotó las iteraciones sin una ronda de texto final (todas terminaron en tool_calls).
  // Para no dejar la pantalla muda, volcamos el último preámbulo que habíamos suprimido.
  if (!emittedFinal && lastPreamble) {
    fullContent += lastPreamble;
    safeEmit(lastPreamble);
  }

  return { content: fullContent, executedTools };
}
