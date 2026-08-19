// Parser incremental de líneas SSE del endpoint OpenAI-compatible de Gemini.
// Puro (sin imports remotos) para ser testeable con Vitest.

export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argsFragment?: string;
  // Gemini 3+: firma encriptada del "pensamiento" adjunta al tool_call. HAY que reenviarla en el
  // assistant message de la continuación o la ronda siguiente devuelve 400/vacío (ver 86ajbjq22).
  thoughtSignature?: string;
}

export interface StreamDelta {
  contentDelta?: string;
  toolCallDeltas?: ToolCallDelta[];
  finishReason?: string | null;
  // usage del request (86aj9w5n8): viene en el último chunk cuando el caller pide
  // stream_options.include_usage. cachedTokens = prompt_tokens_details.cached_tokens
  // (medición real del prompt caching implícito de Gemini; 0 si no vino el detail).
  usage?: { promptTokens: number; cachedTokens: number; completionTokens: number };
}

// Consume las líneas `data:` completas de `buffer`. Devuelve los deltas parseados,
// el `rest` no consumido (líneas incompletas / JSON partido entre chunks de red), y
// `done` si apareció `[DONE]`.
export function drainSSE(buffer: string): { deltas: StreamDelta[]; rest: string; done: boolean } {
  const deltas: StreamDelta[] = [];
  let done = false;
  let rest = buffer;
  let idx: number;

  while ((idx = rest.indexOf("\n")) !== -1) {
    let line = rest.slice(0, idx);
    const after = rest.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);

    if (line.startsWith(":") || line.trim() === "") { rest = after; continue; }
    if (!line.startsWith("data:")) { rest = after; continue; }

    const payload = line.slice(5).trim(); // "data:" = 5 chars; tolera "data: x" y "data:x"
    if (payload === "[DONE]") { done = true; rest = after; continue; }

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // JSON partido entre chunks: dejamos la línea en rest para el próximo push.
      break;
    }
    rest = after;

    const choice = parsed.choices?.[0];

    // Chunk con usage (include_usage): lo emitimos aunque no traiga choice (OpenAI manda el
    // usage en un chunk final con choices vacío; Gemini OpenAI-compat lo adjunta a un chunk
    // con choice — cubrimos ambos).
    if (!choice) {
      if (parsed.usage && typeof parsed.usage.prompt_tokens === "number") {
        deltas.push({ usage: { promptTokens: parsed.usage.prompt_tokens, cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0, completionTokens: parsed.usage.completion_tokens ?? 0 } });
      }
      continue;
    }

    const d: StreamDelta = { finishReason: choice.finish_reason ?? null };
    if (parsed.usage && typeof parsed.usage.prompt_tokens === "number") {
      d.usage = { promptTokens: parsed.usage.prompt_tokens, cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0, completionTokens: parsed.usage.completion_tokens ?? 0 };
    }
    if (choice.delta?.content) d.contentDelta = choice.delta.content;
    if (Array.isArray(choice.delta?.tool_calls)) {
      d.toolCallDeltas = choice.delta.tool_calls.map((tc: any) => ({
        index: tc.index ?? 0,
        id: tc.id,
        name: tc.function?.name,
        argsFragment: tc.function?.arguments,
        thoughtSignature: tc.extra_content?.google?.thought_signature,
      }));
    }
    deltas.push(d);
  }

  return { deltas, rest, done };
}
