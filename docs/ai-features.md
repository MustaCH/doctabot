# AI Features — Alan (doctabot)

**Dueño:** AI & Automation Engineer (`/ai-engineer`) · **Última actualización:** 2026-08-18 (post sprint de hardening 2026-08-06/07)

Decisiones de modelo, prompts, tools y guardarraíles del asistente. El "cómo funciona por dentro"
vive en el código (`supabase/functions/chat/_shared/` + CLAUDE.md); acá está el mapa y el porqué.

## Modelos (Gemini API directa, endpoint OpenAI-compat)

| Uso | Modelo | Por qué |
|---|---|---|
| Turno principal del chat (tool-loop, 30+ tools) | `gemini-3.5-flash` | Flagship stable de Google para tareas agénticas (jul-2026). Más capaz, rápido y barato que 2.5-pro. Thinking separado del contenido (mata el leak de razonamiento en origen). |
| Supervisor post-hoc, títulos, transcripción | `gemini-2.5-flash` | Clasificación/generación corta: el tier barato alcanza. |

**Gotchas de la migración a Gemini 3.x** (costó 2 rollbacks aprender esto; ambos fixes viven en
`stream-turn.ts`/`sse-parse.ts` y son retrocompatibles con 2.5):
1. Cada tool_call trae un `thought_signature` encriptado que HAY que reenviar en la continuación
   del loop (si no: 400/vacío).
2. En streaming, las rondas con tool_calls cierran con `finish_reason:"stop"` (no `"tool_calls"`)
   → el criterio de "ronda de herramientas" es *acumuló tool calls*, no el finish_reason.

**Cambio de modelo:** NUNCA probar un modelo nuevo directo en el chat de prod. Patrón validado:
edge function sonda temporal que importa el pipeline real (`streamTurn` + `executeTool` + prompt +
tools) con el modelo como parámetro → diagnóstico con visibilidad por ronda, cero riesgo.

## Doctrina central: el modelo no es dueño de ningún dato opaco

Todo lo aprendido a golpes de incidentes en prod converge en una regla: **Gemini no transcribe
confiablemente slugs, UUIDs, teléfonos, fotos ni identificadores** — y si le falta algo, lo inventa
con confianza. La respuesta es sistemática: el server renderiza los datos; el modelo solo marca
dónde van. Marcadores server-side (se expanden en `sanitizeFinal` antes del flush):

| Marcador | Expande a | Fuente |
|---|---|---|
| `<<<PROPERTIES>>>` | Tarjetas de propiedad (foto+link `?associate` exactos) | resultados de search del turno (`card-render.ts`) |
| `<<<CONTACTS>>>` | Tarjetas de contacto (👤/🏷️/📱/🔍/🕓) | última página de `list_clients` del turno |

Los marcadores legacy que SÍ escribe el modelo (`===MSG_BREAK===`, `<<<DRAFT_*>>>`,
`<<<WHATSAPP_TO:…>>>`) están protegidos por guardarraíles (abajo).

## Guardarraíles deterministas (en `sanitizeFinal` + `stream-turn`)

Todos fail-open (un error nunca rompe el turno) y testeados:
- **Links de propiedad** (`link-guardrail.ts`): slugs de remax validados contra la tabla
  `properties`; inexistente → se neutraliza + aviso.
- **Bloques de WhatsApp** (`whatsapp-guardrail.ts` → `sanitizeWhatsappBlocks`): valida el bloque
  ENTERO (borrador + `<<<WHATSAPP_TO:>>>`), no solo el número suelto. Gate estructural: solo pasan
  bloques cuyo teléfono canónico (+549…) está en el registro del turno — clientes surgidos de
  `list_clients`/`get_client` en ese turno, más el cliente activo de la conversación (sembrado en
  `index.ts`) — o fue tipeado por el agente. Número inventado → se corrige por el nombre saludado
  en el borrador (`resolveUniqueClient`/`extractGreetedName`) si es único, o se quita el botón;
  siempre con aviso al agente.
- **Listas de contactos** (mismo módulo, `verifyContactListPhones`): 3+ teléfonos listados que no
  existen en el CRM → se marcan ⚠️ + aviso (lista fabricada).
- **Drafts desbalanceados** (`stream-turn.ts` → `closeUnbalancedDrafts`): cierre region-aware en el
  punto exacto del desbalance (también en truncación) — el front nunca recibe un draft sin cerrar.
- **Tope de iteraciones** (`stream-turn.ts`): máx 7 rondas de tools por turno
  (`DEFAULT_MAX_ITERATIONS`); si se agota, se emite lo último útil + `MAX_ITERATIONS_NOTICE` en vez
  de colgar el turno.
- **Razonamiento filtrado** (`stream-turn.ts`): mensaje que arranca con `thought`/plan → re-prompt
  para reescritura limpia + backstop que recupera el español.
- **Narración de tools** (`stream-turn.ts`): 0 tools ejecutadas + el texto nombra una tool real →
  re-prompt para que la invoque de verdad (pasó hasta en japonés).
- **Supervisor post-hoc** (`supervisor.ts`, no bloqueante): evalúa contra `alan-facts.ts` y loguea.
  Incluye una regla determinista de claims de búsqueda: el eco de `applied_filters` de la última
  `search_properties` del turno se le pasa al supervisor para detectar afirmaciones sin respaldo
  ("todas activas", "100% dentro del presupuesto") — `supervisor-rules.search-claims.test.ts`.
  La llamada a Flash va por `fetchWithRetry` (429/5xx transitorios ya no loguean `error` ni
  disparan la alerta n8n falsa), y los rechazos deterministas se loguean con el prefijo
  `[determinista]` en el reason: `admin-stats` los separa del avgScore (que además filtra a 30
  días y expone `avgScoreSampleSize`/`deterministicRejected`) — cálculo puro testeable en
  `admin-stats/supervisor-stats.ts` (ticket 86aj9w5kq).
  Cobertura de reglas (86aj9w5mq): WRITE_CLAIMS incluye claims de `update_client` ("le cambié
  el estado a hot", "marqué como hot"); READ_INTENTS cubre `list_client_properties` y
  `list_client_events`, con dos matices de precisión: `list_client_properties` satisface
  también el intent genérico de propiedades, y el intent de `list_clients` no matchea cuando
  el pedido es sobre eventos/cumpleaños/propiedades DEL cliente (gap templado).
- **Títulos con tope** (`title.ts`, 86aj9w5kn): `max_tokens: 24` + `reasoning_effort: "none"`
  en ambas llamadas — ojo: el thinking de 2.5-flash cuenta DENTRO de `max_tokens` en el
  endpoint OpenAI-compat; con tope y thinking prendido el título sale vacío.

`sanitizeFinal(text, executedTools)` es el punto de aplicación: la ronda final del stream se
bufferiza y pasa por ahí ANTES de emitirse/persistirse (definido en `index.ts`, inyectado a
`streamTurn`). `executedTools` habilita chequeos condicionados a qué tools corrieron de verdad.

## Contratos de tools endurecidos (sprint 2026-08-06)

- **`search_properties`**: `only_active` default true (solo publicaciones activas salvo pedido
  explícito); con `min/max_price` sin `currency` se asume **USD** (el mercado de venta opera en
  dólares; ARS explícito para alquileres); la respuesta ecoa `applied_filters`/`ignored_filters`
  (nada de filtros "aplicados" imaginarios); `offset` = paginación real post-rankeo para "mostrame
  más"; `exclude_office` + `docta_first` (prioridad Docta); `end_of_results` y `price_unset_count`
  como señales explícitas. Tests de contrato: `executor.search.test.ts` (cliente Supabase mockeado).
- **Tarjetas "última búsqueda gana"**: cada search re-siembra los resultados del turno; las
  tarjetas sin ubicar (leftover) solo se anexan si el modelo no puso NINGÚN marcador y el lote está
  fresco según la señal del tool (`cardBatchFresh`), con dedup — nunca tarjetas viejas bajo un "no
  encontré".
- **`send_email`**: anti header-injection (CRLF) — cada dirección debe validar header-safe (sin
  `\r\n`/espacios/`<>`) o el email no se envía; `buildMimeEmail` strippea CRLF como defensa en
  profundidad (`google.test.ts`).
- **Deletes (cliente/notas/eventos)**: resuelven por match exacto de nombre (`exactNameMatches`) —
  un delete jamás adivina por fuzzy.
- **Historial acotado** (`buildAIMessages`, `prompt.ts`): solo roles `user|assistant`, assistants
  consecutivos fusionados, tope de 40 mensajes (`MAX_HISTORY_MESSAGES`) y ~60k chars
  (`MAX_HISTORY_CHARS`), imágenes sin base64 omitidas del historial.

## CRM: verdades del sistema (no de la memoria del modelo)

- **Carga masiva**: `create_clients_bulk` (3+ contactos = una llamada, dedup por teléfono, conteos
  reales obligatorios en la respuesta). Archivos grandes → botón "Importar" del front.
- **Conteos**: `list_clients` devuelve `total_count` (universo) + `showing` (página).
- **Campañas sin repetir**: `order=least_contacted` + `mark_contacted=true` estampan
  `last_contact_at`; la rotación la lleva la DB (índice `idx_clients_user_last_contact`).
  `mark_contacted` es **auditable** (registra la tanda en `client_activities`) y **reversible por
  diferencia**: el executor guarda el valor previo por cliente y `sanitizeFinal` revierte a los
  clientes del batch que no terminaron con borrador válido en la respuesta (no quedan "contactados"
  clientes a los que no se les escribió nada).
- **Memoria entre chats v1**: bloque "actividad de campaña reciente" (derivado de
  `last_contact_at`) inyectado al system prompt por turno. La v2 (resúmenes semánticos por
  cliente) está en backlog: ticket `86aj9w5nu`.

## Costos / performance (estado, no medición fina)

- 3.5-flash abarató el turno principal vs 2.5-pro (tier Flash) con mejor capacidad agéntica.
- Latencia observada del turno con tools: ~4-25s según cantidad de rondas (el thinking pesa en
  turnos complejos; si molesta, `reasoning_effort` es el dial — hoy en default).
- Pendiente de backlog: prompt caching (reordenar prefijo estático, ticket `86aj9w5n8`) y ruteo
  Flash/Pro por complejidad (`86aj9w5nf` — revisar si sigue teniendo sentido post-migración).

## Evals / verificación

No hay banco de evals automatizado todavía (deuda). El patrón actual por cambio de comportamiento:
tests unitarios de las piezas puras + E2E contra prod con usuario descartable (admin API + password
grant + POST a `/functions/v1/chat` sin `conversationId`, parsear SSE, borrar usuario) + lectura de
mensajes persistidos por SQL. Verificar efectos de DB **por SQL**, no con checks REST improvisados.
