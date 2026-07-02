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
  body?: string;
  constructor(status: number, body?: string) {
    super(`AI error: ${status}${body ? ` — ${body}` : ""}`);
    this.name = "AIError";
    this.status = status;
    this.body = body;
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
  // Saneador opcional de la ronda de texto FINAL antes de volcarla al cliente. La ronda final se
  // bufferiza (no se streamea token a token), así que es el punto natural para una validación
  // determinista del contenido (ej. neutralizar links de propiedad inventados — ver link-guardrail.ts).
  // Recibe el texto final y devuelve el texto a emitir/persistir. Fail-open: si tira, se usa el original.
  sanitizeFinal?: (text: string) => Promise<string> | string;
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

// Máximo de re-prompts por turno cuando el modelo fuga un tool-call como texto (ver abajo).
const MAX_REPROMPTS = 2;

/**
 * Detecta y remueve invocaciones de herramienta que el modelo "narró" como TEXTO en vez de usar el
 * canal de tool_calls (ej. `call:link_conversation{client_id:...}`). Solo reconoce NOMBRES de tools
 * reales (validToolNames) para no borrar texto legítimo que contenga "call:". Devuelve el texto
 * limpio y los nombres fugados. Puro y testeable. Ver 86aj1nb0t / 86aj1nb16.
 */
export function stripLeakedToolCalls(
  content: string,
  validToolNames: string[],
): { cleaned: string; leakedNames: string[] } {
  const names = (validToolNames || []).filter((n) => typeof n === "string" && /^\w+$/.test(n));
  if (!content || names.length === 0) return { cleaned: content, leakedNames: [] };
  // Formato observado: `call:NAME{...}` (args hasta el primer '}', sin anidar).
  const re = new RegExp(`call:(${names.join("|")})\\s*\\{[^{}]*\\}`, "gi");
  const leakedNames: string[] = [];
  const cleaned = content.replace(re, (_m, name) => { leakedNames.push(name); return ""; });
  if (leakedNames.length === 0) return { cleaned: content, leakedNames: [] };
  return { cleaned: cleaned.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim(), leakedNames };
}

/**
 * Limpieza COSMÉTICA del texto final: remueve artefactos del PROCESO INTERNO que el modelo a veces
 * filtra al canal de contenido y que se MOSTRARÍAN al agente (distinto de stripLeakedToolCalls, que
 * recupera un `call:NAME{}` no ejecutado vía re-prompt; esto barre lo que igual quedaría visible).
 * Cubre las formas observadas en prod: el header "🧠 … está pensando", la sintaxis de invocación
 * ("Executing function call: list_clients{…}", "search_properties(…)"), el marcador 🛠️ con sus
 * parámetros, y `call:NAME{…}` residual. Anclado a marcadores inequívocos (🧠/🛠️/"function call:")
 * y a nombres de herramientas REALES para NO tocar prosa legítima. Puro y testeable.
 */
export function stripLeakedInternals(content: string, validToolNames: string[]): string {
  if (!content) return content;
  const names = (validToolNames || []).filter((n) => typeof n === "string" && /^\w+$/.test(n));
  let out = content;

  // 1) Header de "pensamiento": línea que arranca con 🧠 (con o sin #) y narra que está pensando/analizando.
  out = out.replace(/^[^\S\n]*#*[^\S\n]*🧠[^\n]*$/gim, (m) =>
    /pensando|thinking|analizando|an[áa]lisis/i.test(m) ? "" : m);

  // 2) Marcador 🛠️ "llama a la herramienta … con los siguientes parámetros:" + sus líneas `key: value`.
  out = out.replace(/🛠️[^\n]*\n(?:[^\S\n]*[a-z_]+:[^\n]*\n?)*/gi, "");

  // 3) Sintaxis de invocación: "(executing )?function call: NAME{…}" o "…(…)".
  out = out.replace(/(?:executing\s+)?function[ _]call:\s*[a-z_]+\s*[{(][^\n})]*[)}]\.{0,3}/gi, "");

  // 4) `call:NAME{…}` residual (la vía principal lo recupera vía re-prompt; esto barre lo que quede).
  out = out.replace(/call:\s*[a-z_]+\s*\{[^\n}]*\}/gi, "");

  // 5) Invocación anclada a un nombre de tool REAL seguido de (…) o {…}: search_properties(…), list_clients{…}.
  if (names.length > 0) {
    const re = new RegExp(`\\b(?:${names.join("|")})\\s*[{(][^\\n})]*[)}]`, "gi");
    out = out.replace(re, "");
  }

  if (out === content) return content;
  // Tidy: colapsar espacios horizontales y líneas vacías que dejó la limpieza (sin tocar el formato real).
  return out.replace(/[^\S\n]{2,}/g, " ").replace(/[^\S\n]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Detecta si el modelo FILTRÓ su razonamiento/planificación interna como contenido (en vez de
 * responder). Gemini 2.5 a veces emite su "thought" (plan en inglés, listas de pasos, "My Plan",
 * "Mental Sandbox", "I will call…") pegado a la respuesta real. Señal principal: el mensaje ARRANCA
 * con "thought" (100% de los casos observados en prod, 86ajbjq22). Puro y testeable.
 */
export function looksLikeLeakedReasoning(content: string): boolean {
  if (!content) return false;
  const head = content.slice(0, 4000);
  if (/^﻿?\s*thought\s*[\n:]/i.test(head)) return true; // arranca con el bloque "thought"
  // Markers inequívocos de planificación interna en inglés (por si no viene el prefijo "thought").
  if (/\*\*\s*(My Plan|Mental Sandbox|Constraint Checklist|Confidence Score)\b/i.test(head)) return true;
  return false;
}

// Un párrafo "parece razonamiento interno" (inglés / markdown de planificación).
function paraLooksLikeReasoning(p: string): boolean {
  return (
    /^\s*thought\b/i.test(p) ||
    /\*\*\s*(My Plan|Mental Sandbox|Constraint Checklist|Confidence Score|Step \d)/i.test(p) ||
    /\b(I['’]?ll|I will|I need to|I have (received|successfully|now)|the user (wants|has|is|made|explicitly)|tool call|create_client|search_properties|list_clients|is_client)\b/.test(p) ||
    /^\s*\d+\.\s+\*\*[^\n]*\*\*\s*:/.test(p) // items numerados de un plan: "1. **Nombre**: …"
  );
}

/**
 * Backstop cuando el re-prompt no logró una respuesta limpia: recupera la RESPUESTA en español
 * (sufijo) descartando el bloque de razonamiento (prefijo en inglés). Toma, desde el final, los
 * párrafos que NO parecen razonamiento y corta al toparse con el bloque de planificación. Si no logra
 * separar nada, devuelve un aviso neutro — NUNCA el "thought" crudo. Puro y testeable.
 */
export function stripLeakedReasoningTail(content: string): string {
  if (!looksLikeLeakedReasoning(content)) return content;
  const paras = content.split(/\n{2,}/);
  const tail: string[] = [];
  for (let i = paras.length - 1; i >= 0; i--) {
    if (paraLooksLikeReasoning(paras[i])) break;
    tail.unshift(paras[i]);
  }
  const answer = tail.join("\n\n").trim();
  return answer || "Perdón, tuve un problema al redactar la respuesta. ¿Me lo repetís?";
}

export async function streamTurn(deps: StreamTurnDeps, opts: StreamTurnOptions): Promise<StreamTurnResult> {
  const { resilientAIFetch, executeTool, toolCtx, toolDefinitions } = deps;
  const { messages, emit } = opts;
  const maxIterations = opts.maxIterations ?? 5;

  const executedTools: string[] = [];
  let fullContent = "";
  let lastPreamble = "";     // contenido de la última ronda suprimida (tool_calls); fallback si el turno no llega a una ronda de texto final
  let emittedFinal = false;  // true cuando ya volcamos una ronda final (texto o length)
  let repromptCount = 0;     // re-prompts gastados al recuperar tool-calls fugados como texto

  const safeEmit = (t: string) => { if (!t) return; try { emit(t); } catch { /* cliente desconectado: seguimos drenando */ } };
  // Aplica el saneador de la ronda final si fue provisto. Fail-open: cualquier error deja el texto intacto.
  const finalize = async (t: string): Promise<string> => {
    if (!opts.sanitizeFinal) return t;
    try { return await opts.sanitizeFinal(t); } catch { return t; }
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    let res: Response;
    if (iter === 0 && opts.firstResponse) {
      res = opts.firstResponse;
    } else {
      res = await resilientAIFetch({ messages, tools: toolDefinitions, stream: true });
    }
    if (!res.ok) {
      // Capturamos el cuerpo del error de Gemini para diagnóstico (86aj4276y): el status solo
      // no alcanza para saber POR QUÉ rechazó una continuación del tool-loop. No se streamea, así
      // que leer el body acá es seguro.
      let errBody = "";
      try { errBody = (await res.text()).slice(0, 1500); } catch { /* cuerpo ilegible */ }
      throw new AIError(res.status, errBody);
    }
    if (!res.body) throw new AIError(res.status || 500);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finishReason: string | null = null;
    let assistantContent = "";
    // Tool calls acumulados keyeados por ID del call. Gemini (OpenAI-compat) emite tool calls
    // PARALELOS en una misma ronda como deltas completos (id+name+args) a veces con el MISMO index
    // (o sin index) → keyear por index los FUSIONABA en uno (name pisado, args concatenados
    // `{...}{...}`): el JSON.parse reventaba y la continuación mandaba 1 function_call donde Gemini
    // generó 2 → 400 INVALID_ARGUMENT (bug 86aj4276y). Keyeamos por id (único por call); los
    // fragmentos de args sin id (streaming incremental estilo OpenAI) continúan el último slot
    // abierto en ese index.
    const toolAccum = new Map<string, AccumulatedToolCall>();
    const lastKeyByIndex = new Map<number, string>();

    const applyDelta = (d: { contentDelta?: string; toolCallDeltas?: any[]; finishReason?: string | null }) => {
      if (d.contentDelta) {
        // No se emite ni se acumula en vivo: el contenido de la ronda se bufferiza y recién se
        // vuelca (o se descarta, si la ronda termina en tool_calls) al conocer el finish_reason.
        assistantContent += d.contentDelta;
      }
      if (d.toolCallDeltas) {
        for (const tcd of d.toolCallDeltas) {
          // Un delta con id es el inicio de un tool call nuevo (slot propio por id); uno sin id es
          // la continuación de los args del último call abierto en ese index.
          let key: string;
          if (tcd.id) {
            key = tcd.id;
            lastKeyByIndex.set(tcd.index, key);
          } else {
            key = lastKeyByIndex.get(tcd.index) ?? `idx-${tcd.index}`;
          }
          const cur = toolAccum.get(key) ?? { id: "", name: "", arguments: "" };
          if (tcd.id) cur.id = tcd.id;
          if (tcd.name) cur.name = tcd.name;
          if (tcd.argsFragment) cur.arguments += tcd.argsFragment;
          if (tcd.thoughtSignature) cur.thoughtSignature = tcd.thoughtSignature;
          toolAccum.set(key, cur);
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
      const safe = stripLeakedReasoningTail(assistantContent);
      const flush = await finalize(safe + truncationSuffix(safe));
      fullContent += flush;
      safeEmit(flush);
      emittedFinal = true;
      break;
    }

    // Gemini 2.5 cierra las rondas con tool calls con finish_reason:"tool_calls"; Gemini 3.x en
    // streaming manda "stop" AUNQUE haya emitido tool_calls (verificado contra la API real,
    // 86ajbjq22 — era la causa del turno vacío al migrar). El criterio robusto: si la ronda acumuló
    // tool calls, ES una ronda de herramientas, sea cual sea el finish_reason (salvo "length", que
    // se maneja arriba como truncado).
    if (toolAccum.size > 0) {
      // Opción 2 (86aj1n43n): el preámbulo de una ronda que termina en tool_calls NO se muestra
      // ni se persiste. El modelo regenera saludos/narración en las continuaciones del mismo turno
      // y mostrarlos produce el re-saludo y la narración duplicada. El texto SÍ se conserva en
      // `messages` (memoria del modelo) y como fallback si el turno no llega a una ronda final.
      lastPreamble = assistantContent;
      const toolCalls = [...toolAccum.values()];
      messages.push({
        role: "assistant",
        content: assistantContent || null,
        // Gemini 3+: reenviamos el thought_signature en cada tool_call que lo trajo, si no la
        // continuación tras el tool_call devuelve 400/vacío. En 2.5-pro no viene → no se agrega
        // (retrocompatible). Ver sse-parse.ts / 86ajbjq22.
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
          ...(tc.thoughtSignature ? { extra_content: { google: { thought_signature: tc.thoughtSignature } } } : {}),
        })),
      });
      const { toolMessages, executed } = await executeToolCalls(toolCalls, { executeTool, toolCtx });
      messages.push(...toolMessages);
      executedTools.push(...executed);
      continue;
    }

    // Recuperación de tool-calls fugados como texto (86aj1nb0t / guardado fantasma 86aj1nb16): si el
    // modelo "narró" una invocación (call:NAME{...}) en vez de usar el canal de herramientas, la
    // acción NO se ejecutó. La strippeamos del texto y re-prompteamos para que la invoque de verdad
    // (en vez de parsear el formato quirky de Gemini, frágil y con riesgo de escribir mal). El texto
    // fugado NO se muestra: la acción todavía no ocurrió. Cap de re-prompts para no loopear.
    const validToolNames = toolDefinitions.map((d: any) => d?.function?.name).filter(Boolean);
    const { cleaned, leakedNames } = stripLeakedToolCalls(assistantContent, validToolNames);
    if (leakedNames.length > 0 && repromptCount < MAX_REPROMPTS) {
      repromptCount++;
      messages.push({ role: "assistant", content: cleaned || null });
      messages.push({
        role: "user",
        content: `[sistema] Escribiste como TEXTO una invocación de herramienta (call:${leakedNames.join(", ")}). Las herramientas NO se ejecutan escribiéndolas: invocá ${leakedNames.join(" y ")} ahora por el canal de herramientas si esa acción hace falta; si ya no, continuá SIN repetir ese texto.`,
      });
      lastPreamble = cleaned;
      continue;
    }

    // Recuperación de RAZONAMIENTO fugado (86ajbjq22): si el modelo filtró su "thought"/plan como
    // texto (100% de los casos arrancan con "thought"), re-prompteamos UNA vez para que reescriba
    // SOLO el mensaje final. Es más robusto que recortar el prefijo a mano: la respuesta real viene
    // pegada al plan sin delimitador y el plan a veces cita español. Comparte el cap de re-prompts.
    if (leakedNames.length === 0 && looksLikeLeakedReasoning(assistantContent) && repromptCount < MAX_REPROMPTS) {
      repromptCount++;
      messages.push({ role: "assistant", content: assistantContent || null });
      messages.push({
        role: "user",
        content: `[sistema] Tu último mensaje filtró tu razonamiento interno (empezó con "thought" o incluyó tu plan paso a paso, en inglés). Reescribí SOLO el mensaje final para el agente, en español rioplatense, sin ningún razonamiento, plan, listas de pasos, la palabra "thought" ni texto en inglés. Contá únicamente el resultado.`,
      });
      lastPreamble = assistantContent;
      continue;
    }

    // Narración de tool sin ejecución (86ajbr466 — caso Guido, en japonés: "ツール呼び出しを実行します:
    // `list_clients`…"): el modelo ANUNCIA que va a llamar una herramienta, nombrándola, pero el turno
    // no ejecutó NINGUNA. La forma varía (cualquier idioma/sintaxis), así que el detector es
    // estructural: 0 tools ejecutadas en el turno + el texto final menciona un nombre de tool real.
    // El prompt prohíbe nombrar tools en la respuesta, así que un falso positivo es rarísimo. Va
    // DESPUÉS del detector de razonamiento (más específico), y comparte el cap de re-prompts.
    if (executedTools.length === 0 && repromptCount < MAX_REPROMPTS) {
      const mentioned = validToolNames.filter((n: string) => new RegExp(`\\b${n}\\b`).test(assistantContent));
      if (mentioned.length > 0) {
        repromptCount++;
        messages.push({ role: "assistant", content: assistantContent || null });
        messages.push({
          role: "user",
          content: `[sistema] Tu mensaje NOMBRA la herramienta ${mentioned.join(", ")} pero NO la invocaste (no se ejecutó nada). Anunciarla no la ejecuta: invocala AHORA por el canal de herramientas y después contá el resultado real, sin mencionar nombres de herramientas.`,
        });
        lastPreamble = assistantContent;
        continue;
      }
    }

    // Ronda de texto final: recién acá se vuelca al cliente (bufferizada, de una). Si quedó un leak
    // que no pudimos recuperar (cap agotado), va el texto ya strippeado. Validación mínima de
    // formato: si el modelo dejó un <<<DRAFT_START>>> sin cerrar, agregamos el cierre faltante.
    const finalText0 = leakedNames.length > 0 ? cleaned : assistantContent;
    // Barrido cosmético del proceso interno filtrado (header "🧠 …", sintaxis de invocación, etc.)
    // que stripLeakedToolCalls no recupera y que igual se mostraría. Ver stripLeakedInternals.
    // Luego, backstop: si el re-prompt no alcanzó (cap agotado) y sigue habiendo un "thought"
    // filtrado, recuperamos la respuesta en español descartando el bloque de razonamiento.
    const finalText = stripLeakedReasoningTail(stripLeakedInternals(finalText0, validToolNames));
    const flush = await finalize(finalText + unbalancedDraftClose(finalText));
    fullContent += flush;
    safeEmit(flush);
    emittedFinal = true;
    break;
  }

  // El turno agotó las iteraciones sin una ronda de texto final (todas terminaron en tool_calls).
  // Para no dejar la pantalla muda, volcamos el último preámbulo que habíamos suprimido.
  if (!emittedFinal && lastPreamble) {
    const safe = await finalize(stripLeakedReasoningTail(lastPreamble));
    fullContent += safe;
    safeEmit(safe);
  }

  return { content: fullContent, executedTools };
}
