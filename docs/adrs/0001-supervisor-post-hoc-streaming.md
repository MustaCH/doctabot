# ADR-001: Supervisor post-hoc + streaming optimista

**Estado:** Aceptado (enmendado parcialmente por [ADR-002](0002-supresion-determinista-preambulo-multi-tool.md))
**Fecha:** 2026-06-12
**Decisor(es):** Nacho + AI & Automation Engineer agent

> **Actualización (2026-06-14):** la granularidad **token a token** de la Decisión fue revertida por el [ADR-002](0002-supresion-determinista-preambulo-multi-tool.md): el driver ahora bufferiza por ronda para suprimir re-saludos de forma determinista. El resto de este ADR — supervisor post-hoc, eliminación del retry-loop — sigue plenamente vigente.

## Contexto

El chat de Alan (edge function `supabase/functions/chat/`) tenía dos problemas acoplados que obligaban a rediseñar juntos:

1. **El "streaming" era falso.** El edge function llamaba a Gemini con `stream: false`, corría el tool-loop completo, después el supervisor de calidad (otra llamada full a `gemini-2.5-flash`) **y hasta 2 retries que regeneraban la respuesta entera**, y recién ahí "streameaba" cortando el texto final por `===MSG_BREAK===`. El usuario miraba un spinner 10–30s y recibía todo de golpe. Era un POST disfrazado de SSE.

2. **El supervisor era bloqueante y podía reescribir** lo que veía el usuario. Eso es estructuralmente incompatible con el streaming real: no se puede emitir tokens a medida que Gemini los produce y, a la vez, garantizar que esa respuesta ya pasó por revisión de calidad.

Restricciones:
- El front (`src/lib/stream-chat.ts`) **ya** consume un stream de deltas SSE real (formato OpenAI-compatible). El cuello de botella era 100% el backend.
- Las edge functions de Supabase soportan `EdgeRuntime.waitUntil()` para correr trabajo en background después de devolver la respuesta.
- La fase de ejecución de tools (buscar propiedades, CRM, calendario) es inherentemente bloqueante: no hay tokens que mostrar mientras corren las herramientas. El streaming real solo aplica a la **generación de texto final**.

La decisión central, que afecta UX y el rol de toda una capa (el supervisor), no era de implementación sino de producto: **¿el supervisor sigue pudiendo frenar/reescribir una respuesta antes de que llegue al usuario, o priorizamos que el contenido aparezca al instante?**

## Decisión

Adoptamos **streaming optimista con supervisor post-hoc**:

- Todas las llamadas a Gemini van con `stream: true`. Un driver de turno (`_shared/stream-turn.ts`) parsea el SSE distinguiendo `content` (se pipea token a token al cliente) de `tool_calls` (se acumulan por índice y se ejecutan entre iteraciones, bloqueante).
- El supervisor se **degrada a observabilidad post-hoc** (`runSupervisorEval`): una sola evaluación con `gemini-2.5-flash` que corre **después** de cerrar el stream, vía `EdgeRuntime.waitUntil()`. Solo escribe en `supervisor_logs` y alerta a n8n en rechazo/error. **Ya no reescribe** lo que ve el usuario.
- **Se elimina el retry-loop del supervisor.** En modo post-hoc no hay a quién mostrarle una corrección.

## Alternativas consideradas

### Opción A: Mantener el gate bloqueante (status quo)
- **Pros:** ninguna respuesta subóptima llega al usuario sin pasar por revisión; el supervisor puede corregir.
- **Contras:** mata el streaming real — es la causa raíz del problema. Latencia percibida de 10–30s.
- **Por qué no:** es exactamente lo que estamos arreglando. Incompatible con el AC "el contenido aparece progresivamente".

### Opción B: Streaming optimista + corrección visible
- **Pros:** mantiene la red de calidad — si el supervisor rechaza, se manda una burbuja de corrección de seguimiento ("Perdón, corrijo:...").
- **Contras:** complejidad de UX (el usuario ve dos versiones, puede confundir); más estado en el front; el caso de corrección es raro y el costo de implementarlo es alto.
- **Por qué no:** YAGNI. Si la calidad sin gate se degrada de forma medible (vía `supervisor_logs`), se puede reabrir como ADR futuro.

### Opción C: Gate solo en acciones críticas
- **Pros:** streaming rápido en lo conversacional, cauto solo en turnos con efectos reales (ej. `send_email`).
- **Contras:** dos caminos de código a mantener; la complejidad del gate condicional no se justifica si igual aceptamos que el contenido conversacional fluya sin revisar.
- **Por qué no:** agrega ramificación sin un beneficio claro frente a la Opción elegida.

## Consecuencias

### Positivas
- Streaming real token a token: el texto aparece a medida que Gemini lo genera (AC cumplido).
- El supervisor deja de estar en el camino crítico → menos latencia y un punto de falla menos en la respuesta al usuario.
- `supervisor_logs` se mantiene como fuente de verdad de calidad para detectar regresiones sin afectar la UX.
- Arquitectura más simple: un solo driver de turno (`streamTurn`) reemplaza el tool-loop + supervisor-loop + fallback que estaban duplicados.

### Negativas
- **Contenido ocasionalmente subóptimo puede llegar al usuario sin corrección.** Tradeoff aceptado explícitamente por Nacho (2026-06-12): *"si es una respuesta corta/floja, está bien que llegue, no pasa nada"*.
- Se pierde la capacidad de auto-corregir un turno en vivo (ej. "describió la acción en vez de ejecutar la tool"). El system prompt de Alan ya mitiga esto; el supervisor lo seguirá detectando en los logs.

### Neutras
- `runToolLoop` (la extracción que se había hecho para arreglar el bug del retry-con-tools) queda reemplazada por `streamTurn`; su núcleo de ejecución de tools sobrevive como `executeToolCalls` (`_shared/tools/execute-round.ts`). El guard `SIDE_EFFECTING_TOOLS` / anti-duplicación se elimina junto con el retry.
- La persistencia del mensaje del assistant pasa de "antes del stream" a "después, en background (`waitUntil`)", desacoplada de la conexión del cliente (si se desconecta a mitad, se sigue drenando Gemini para persistir).
- Marcadores de formato (`<<<DRAFT_START>>>`, etc.) que ahora llegan fragmentados se retienen en el front (`src/lib/stream-markers.ts`) para que no parpadeen.
- Reemplaza/supersede al ticket "[bug] El retry del supervisor no puede ejecutar herramientas": el bug deja de existir porque el retry deja de existir.

## Notas de implementación

- `_shared/stream-turn.ts` — driver streaming (parsea SSE, pipea content, ejecuta tools).
- `_shared/sse-parse.ts` — parser incremental de deltas SSE.
- `_shared/tools/execute-round.ts` — ejecución de una ronda de tool_calls.
- `_shared/supervisor.ts` — `runSupervisorEval` (single eval, sin retry).
- `index.ts` — valida status de la primera llamada ANTES de abrir el stream (preserva el contrato 429/402 del front), arma el `ReadableStream`, corre el background vía `waitUntil`.
- `src/lib/stream-markers.ts` + `stream-chat.ts` — hold-back de marcadores incompletos.
- Validar después del deploy: que el texto aparezca progresivamente, que los drafts aparezcan completos sin marcadores crudos, y que `supervisor_logs` se siga poblando.

## Referencias

- Spec de diseño: `docs/superpowers/specs/2026-06-12-streaming-real-alan-design.md`
- Plan de implementación: `docs/superpowers/plans/2026-06-12-streaming-real-alan.md`
- Tickets ClickUp (Space ALAN): `86aj0p58w` (streaming real), `86aj0p5b5` (retry del supervisor, superseded).
- [Supabase Edge Functions — Background Tasks (`EdgeRuntime.waitUntil`)](https://supabase.com/docs/guides/functions/background-tasks)
