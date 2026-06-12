# Diseño: Streaming real de Alan

**Fecha:** 2026-06-12
**Autor:** AI & Automation Engineer
**Tickets:** [feature] Streaming real de Alan (`86aj0p58w`) · supersede de [bug] retry del supervisor (`86aj0p5b5`)
**Estado:** aprobado para implementación

## Problema

Hoy el "streaming" es falso. La edge function `supabase/functions/chat/index.ts` llama a Gemini con `stream:false`, corre el tool-loop completo, después el supervisor (otra llamada full) + hasta 2 retries, y recién ahí "streamea" cortando el texto final por `===MSG_BREAK===` en `_shared/sse.ts`. El usuario mira un spinner 10–30s y recibe todo de golpe. Es un POST disfrazado de SSE. Punto flaco #1 de la experiencia.

El front (`src/lib/stream-chat.ts`) **ya** consume un stream de deltas SSE real e incrementa por `MSG_BREAK` sobre la marcha. El cuello de botella es 100% el backend.

## Decisiones tomadas (brainstorming 2026-06-12)

1. **Rol del supervisor → post-hoc / observabilidad.** Se streamea optimista. El supervisor corre async DESPUÉS del stream, solo loguea a `supervisor_logs` + alerta n8n. Ya no reescribe lo que ve el usuario. (ADR requerido.)
2. **Se elimina el retry-loop del supervisor.** En modo post-hoc no hay a quién mostrarle la corrección. `runSupervisorLoop` → `runSupervisorEval` (single eval). El fix reciente de retry-con-tools queda superseded; su valor real (separar ejecución de tools) se preserva.
3. **Full-streaming.** Todas las llamadas a Gemini van con `stream:true`; se parsea el SSE distinguiendo `content` vs `tool_calls`. Una sola arquitectura, sin llamadas desperdiciadas.
4. **Docs:** ADR en `docs/adrs/`, este spec en `docs/superpowers/specs/`.
5. **Marcadores parciales en el front → en scope** (revisión Nacho 2026-06-12). Con streaming real, `<<<DRAFT_START>>>` / `<<<DRAFT_END>>>` / `<<<WHATSAPP_TO:...>>>` llegan fragmentados y `ChatMessage.tsx` hoy muestra el marcador crudo mientras el draft no cerró. Se arregla en `stream-chat.ts`.

## Tradeoff aceptado

Contenido ocasionalmente subóptimo puede llegar al usuario **sin** corrección (el supervisor ya no bloquea). Mitigaciones: el system prompt ya es fuerte; el supervisor sigue logueando todo para detectar regresiones; alerta n8n en rechazos persistentes. Se documenta en el ADR.

## Arquitectura del turno

Driver streaming que reemplaza al `runToolLoop` actual (`stream:false`). Pseudo-flujo:

```
streamTurn(messages, deps, clientController):
  loop (max 5 iteraciones):
    res = resilientAIFetch({ messages, tools, stream: true })
    if !res.ok: throw AIError(res.status)
    parsear SSE de Gemini delta por delta:
      - delta.content      → enqueue al cliente + append a contentBuffer
      - delta.tool_calls[i] → acumular fragmentos por índice en toolCallsAccum
    al cerrar la respuesta de Gemini:
      if hubo tool_calls (finish_reason == "tool_calls"):
        push assistant message (con tool_calls) a messages
        executeToolCalls(toolCallsAccum, ...) → push tool results a messages
        continue loop
      else (finish_reason == "stop"):
        break  // contentBuffer ya fue streameado en vivo
  return { content: contentBuffer, executedTools }
```

Notas:
- Una respuesta de Gemini es `content` **o** `tool_calls`, nunca ambas (por `finish_reason`). El parser no necesita manejar mezcla dentro de una misma respuesta.
- La fase de tools sigue siendo bloqueante (no hay tokens que mostrar mientras corren). El streaming real aplica a la generación de texto final.
- Parsing de tool_calls en streaming = patrón estándar OpenAI: `delta.tool_calls[i].id`, `.function.name`, `.function.arguments` llegan fragmentados y se concatenan por `index`.

## Componentes

| Unidad | Responsabilidad | Estado |
|--------|-----------------|--------|
| `_shared/stream-turn.ts` (nuevo) | Driver streaming del turno: llama Gemini stream:true, parsea SSE, pipea content al cliente, resuelve tools, devuelve `{ content, executedTools }`. Módulo puro (deps inyectadas, sin imports `https://`) → testeable. | crear |
| `_shared/tools/execute-round.ts` (nuevo) | `executeToolCalls(toolCalls, deps)`: ejecuta una ronda de tool_calls, devuelve los tool-result messages + nombres ejecutados. Extraído del `runToolLoop` actual, mantiene su test. | extraer |
| `_shared/sse-parse.ts` (nuevo) | Parser incremental de líneas SSE de Gemini (`data: {...}` / `[DONE]`), reutilizable y testeable. | crear |
| `_shared/loop.ts` (actual) | `runToolLoop` queda superseded. Se conserva `AIError`. Se elimina `SIDE_EFFECTING_TOOLS`/`blockedTools` (sin consumidor). | reducir |
| `_shared/supervisor.ts` | `runSupervisorLoop` → `runSupervisorEval`: una eval flash, sin retry. Misma lógica de logging/n8n. | simplificar |
| `_shared/sse.ts` | `buildSSEResponse(content)` deja de usarse para el camino feliz. El stream se arma dentro del driver/index. Se puede conservar para el fallback. | revisar |
| `chat/index.ts` | Orquesta: arma el `ReadableStream`, corre `streamTurn` pasando el controller, y en `EdgeRuntime.waitUntil()` corre persistencia + `runSupervisorEval` + push notification + title. | reescribir flujo |
| `src/lib/stream-chat.ts` (front) | Extender el hold-back que hoy hace con `MSG_BREAK`: retener la región de un draft incompleto (desde `<<<WHATSAPP_TO:...>>>`/`<<<DRAFT_START>>>` hasta `<<<DRAFT_END>>>`) y emitirla entera al cerrar. Así nunca llega un marcador parcial al renderer. `ChatMessage.tsx` queda intacto. | extender |

## Data flow

1. `index.ts` crea un `ReadableStream`; en `start(controller)` llama `streamTurn`.
2. `streamTurn` pipea tokens de content al `controller` en formato SSE OpenAI-compat (`data: {choices:[{delta:{content}}]}`) — el mismo que el front ya parsea.
3. Al terminar el turno, `streamTurn` enqueue `[DONE]` y se acumula `contentBuffer`.
4. **Background (`waitUntil`)**, desacoplado de la conexión del cliente:
   - Persiste el assistant message (`contentBuffer`) + update `conversations.updated_at`.
   - Corre `runSupervisorEval(contentBuffer, ...)` → `supervisor_logs` + n8n si rechaza/error.
   - Title (si primer mensaje) + push notification (si >1.5s).

## Error handling

- **Gemini no-ok (429/402/otro):** `streamTurn` lanza `AIError(status)`. Como ya abrimos el stream, el mapeo 429/402 a HTTP status sólo es posible si el error ocurre **antes** del primer byte. Estrategia: hacer la primera llamada y validar `res.ok` **antes** de construir el `ReadableStream`; si falla, devolver el JSON de error con el status correcto (preserva el contrato actual del front: `resp.status === 429 → "rate_limit"`). Errores en iteraciones posteriores (ya streameando) → se cierra el stream con un mensaje de error en banda.
- **Desconexión del cliente mid-stream:** `controller.enqueue` lanza si el stream se cerró. Se atrapa y se deja de enqueue, pero **se sigue consumiendo el stream de Gemini hasta el final** para llenar `contentBuffer` → la persistencia en `waitUntil` no se pierde.
- **executeTool throw:** se preserva el comportamiento actual (burbujea). (Mejorar a tool-result de error queda fuera de scope.)
- **Marcadores parciales llegando token a token:** se resuelve en `stream-chat.ts` reteniendo la región del draft hasta que cierra (ver Componentes). El front nunca pasa un marcador incompleto al renderer. `===MSG_BREAK===` ya estaba cubierto por el hold-back existente.

## Testing

- `sse-parse.ts`: parsea deltas de content; acumula tool_calls fragmentados por índice; maneja `[DONE]` y líneas partidas entre chunks.
- `stream-turn.ts` (deps mockeadas): (a) turno texto puro → pipea content, no llama executeTool; (b) tools-then-text → ejecuta tools, luego pipea texto; (c) desconexión (controller.enqueue throw) → sigue consumiendo Gemini, `content` completo; (d) `AIError` en primera llamada; (e) corta en maxIterations.
- `execute-round.ts`: ejecuta ronda de tool_calls, trackea ejecutadas, ignora errores en el track.
- Reusar/adaptar `loop.test.ts` existente para `executeToolCalls`.
- `stream-chat.ts` (front, `src/lib/*.test.ts`): hold-back de marcadores — `<<<DRAFT_START>>>` partido entre deltas no llega crudo; `WHATSAPP_TO` + draft se emiten juntos al cerrar; draft incompleto al final del stream no deja marcador colgado; `MSG_BREAK` sigue funcionando.

## ADR

`docs/adrs/0001-supervisor-post-hoc-streaming.md` (vía skill `adr-writer`): "Supervisor post-hoc + streaming optimista". Contexto, decisión, tradeoff (contenido sin supervisar puede llegar al usuario), alternativas descartadas (gate-bloqueante actual, optimista-con-corrección-visible, gate-solo-en-acciones-críticas), consecuencias.

## Fuera de scope (follow-ups)

- Indicadores "buscando propiedades..." durante la fase de tools (UX/Frontend).
- Timeout / `max_tokens` (ticket `86aj0p5cb` separado).
- Corrección visible async del supervisor (descartado por YAGNI; reabrir si la calidad sin gate se degrada).
