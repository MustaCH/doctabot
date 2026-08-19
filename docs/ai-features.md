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

## Streaming en vivo de la ronda final (86aj9w5nb)

La latencia percibida del turno (5-21s sin ver nada) se resolvió con goteo en vivo + reemplazo:

- **LiveDripper** (`stream-turn.ts`): gotea el contenido de una ronda recién después de
  `DRIP_HOLD_CHARS` (200) sin tool_calls ni pinta de razonamiento filtrado — los preámbulos de
  rondas de tools son cortos, así que la supresión anti-re-saludo (86aj1n43n) queda intacta.
  Ante un token sensible (`<<<PROPERTIES>>>`/`<<<CONTACTS>>>`/`<<<CARD:`/slug de remax) DEJA de
  gotear: esa cola la entrega solo el reemplazo (es el "bufferizá solo ante un slug" del AC).
- **Evento `final` de reemplazo**: al cerrar el turno, el server emite SIEMPRE
  `{"final":{"content":<texto saneado>}}` — con tarjetas expandidas, link-guardrail aplicado y
  el aviso "⚠️ Quité N enlaces" como burbuja extra si corresponde. El front (stream-chat.ts →
  onFinal en use-chat-messages) descarta las burbujas goteadas y re-renderiza con splitBubbles
  (el MISMO camino que la recarga). Lo persistido = el reemplazo.
- **Handshake de capacidades**: el front declara `client_caps: ["final_event"]` en el body;
  sin esa cap (PWA vieja) el edge usa el protocolo histórico (ronda final bufferizada). Por eso
  el deploy es seguro en cualquier orden y con bundles cacheados.
- Caso raro aceptado: un preámbulo >200 chars que después resulta ronda de tools puede verse
  unos segundos y ser pisado por el reemplazo (flicker); con el umbral casi nunca pasa.

## Matching propiedad↔cliente: núcleo compartido (86aj9w5p3 / T3.4)

`supabase/functions/_shared/matching-core.ts` es la FUENTE ÚNICA de los primitivos de
matching (ZONE_PATTERNS_TITLE superset / ZONE_PATTERNS_NOTES conservador, `zonesMatch` +
CONTAINER_ZONES, `normalizePropertyType`, `budgetCeilingFloor`, `minReasonsFor`,
`notesSupplementReasons` con dedup por emoji líder). Lo importan `src/lib/property-matching.ts`
(front) y `morning-matches/matching.ts` (cron) — antes estaban copiados y divergieron.
Unificaciones deliberadas: el cron perdió su piso de presupuesto 0.85 (regla canónica =
`budgetCeilingFloor`), el front adoptó `minReasonsFor` (solo-zona alcanza con 1 reason,
86aj1f13j), y el fix del dedup `substring(0,2)`→`split(' ')[0]` (emojis de 3 unidades UTF-16).
`src/lib/matching-parity.test.ts` exige identidad de referencia: re-copiar una implementación
local rompe el test. Pendiente ("idealmente" del ticket): tabla `zones` con alias en Postgres.

## Harness de evals offline (86aj9w5mg — keystone)

`supabase/functions/chat/_shared/evals/` — mide el comportamiento REAL del modelo antes de
deployar cambios de prompt/tools. **Correr los evals es el gate para tocar `prompt.ts` /
`alan-facts.ts` / `definitions.ts`** (tickets tipo 86aj9w5n6).

- **Arquitectura: modelo real, DB mockeada.** `runner.ts` arma el turno igual que
  `index.ts` (`buildContextualPrompt` + `buildAIMessages` + bloque CLIENTE ACTIVO) y corre
  `streamTurn` + `executeTool` REALES contra un Supabase in-memory (`mock-db.ts`, fixture en
  `defaultDb()`). Google desconectado (`getCalendarToken → null`): email/calendar jamás pegan
  afuera; el único efecto externo es la llamada a Gemini.
- **Golden set** (`golden-set.json`, 42 casos): búsqueda, CRM, guardar-al-cliente, agenda,
  email, WhatsApp, anti prompt-injection, formato/marcadores y regresiones históricas
  (86aj42cb2 guardado fantasma, 86aj1n43n re-saludo, 86ajangkb links inventados). Las
  expectativas son deterministas: `tools_include/exclude`, regexes, drafts balanceados, y
  las reglas del supervisor (`supervisor_deterministic_clean`).
- **Correr:** `npm run test:evals` (config `vitest.evals.config.ts`, env node). Requiere
  `GEMINI_API_KEY` en el entorno — sin key se saltea con aviso. Vars: `EVAL_RUNS` (reps por
  caso), `EVAL_MIN_PASS_RATE` (gate global de CI, default 0.85), `EVAL_CASE_MIN_RATE`,
  `EVAL_STRICT=1`, `EVAL_FILTER=<tag|id>`, `EVAL_CONCURRENCY` (default 4).
- **`npm test` NO pega a la API:** los evals viven en `*.eval.ts` (fuera del include normal);
  el harness en sí se testea offline en `evals/harness.test.ts` (mock-db, evaluador, esquema
  del golden set, y un turno end-to-end con el modelo stubbeado por SSE).
- **Baseline fijado (2026-08-19, 3 corridas contra la API real):** 40/40 casos sanos verdes,
  gate global de CI en verde. Las 4 deficiencias del baseline (URLs fabricadas/dictadas ×2,
  update_client ante orden directa, auto-guardado sin confirmar) **se ARREGLARON el mismo día**
  (tickets 86ak2q724/72h/72z — ver commits) y sus casos corren verdes 3/3 sin `known_issue`.
  El known_issue restante del baseline (`cal-visita-sin-google`: con Calendar desconectado el
  modelo reintentaba en loop la tool que falla de forma permanente hasta agotar maxIterations)
  **se ARREGLÓ el 2026-08-19** (ticket 86ak2tkjg) con dos capas: (1) corte determinista en
  `execute-round.ts` — un reintento IDÉNTICO (misma tool + mismos args) tras un `{error}` limpio
  del MISMO turno no se re-ejecuta: devuelve un resultado sintético que instruye no reintentar
  (conservador: solo errores limpios memorizados en `toolCtx.failedCallErrors`; un throw
  transitorio o una tool con datos nunca se cortan, y args corregidos sí ejecutan); (2) hecho
  canónico en `alan-facts.ts`: errores de conexión/permiso (Calendar/Gmail) son permanentes en
  el turno — avisar y ofrecer alternativa (create_client_event / borrador copiable). El caso
  corre sin `known_issue` y pasó 3/3 con `EVAL_FILTER=cal EVAL_RUNS=3`.
- **Semántica del gate (anti whack-a-mole):** con `EVAL_RUNS=1` (default) los tests por-caso
  solo REPORTAN y CI la gatea el pass-rate GLOBAL (≥0.85) — 44 casos probabilísticos a 1 rep
  tiran ~1 caso distinto por corrida aunque cada uno esté ~90%+. Con `EVAL_RUNS>1` o
  `EVAL_STRICT=1`, los por-caso gatean con su umbral (`EVAL_CASE_MIN_RATE`).
- El baseline además pescó precisión del supervisor determinista: el stem `list` matcheaba
  el adjetivo "listo" (ARREGLADO en supervisor-rules + test); quedan documentadas dos
  limitaciones conocidas sin fix: contenido citado/inyectado dentro del mensaje dispara
  READ_INTENTS, y cláusulas de propósito tipo "invitarla a ver el depto" disparan el intent
  de búsqueda. En prod solo ensucian métricas (el supervisor no bloquea).
- Gotcha del fixture: `properties.zone/locality` en prod están normalizadas (lowercase, sin
  acentos) — un fixture con acentos hace que el executor (que busca con stripAccents) dé 0
  resultados y el modelo agote maxIterations reintentando.

`sanitizeFinal(text, executedTools)` es el punto de aplicación: la ronda final del stream se
bufferiza y pasa por ahí ANTES de emitirse/persistirse (definido en `index.ts`, inyectado a
`streamTurn`). `executedTools` habilita chequeos condicionados a qué tools corrieron de verdad.

**Presupuesto de tiempo total del turno (86aj9w5mm, 2026-08-19):** el timeout de 60s por llamada
al modelo no acotaba el TURNO — el peor caso (7 iteraciones + tools) superaba el wall-clock de la
Edge Function y la plataforma mataba la función a mitad del stream (cliente colgado sin `[DONE]`,
persistencia en riesgo). Ahora `index.ts` fija `TURN_DEADLINE_AT` (default 120s, env
`CHAT_TURN_BUDGET_MS`; wall-clock asumido ~150s, supuesto del ticket sin verificar) y (1)
`streamTurn` no arranca otra iteración pasado el deadline — cierre elegante: vuelca el último
preámbulo + `TURN_DEADLINE_NOTICE` y el stream cierra normal con `[DONE]` y persistencia; (2) el
timeout de cada llamada se acota al presupuesto restante (piso 5s). Observabilidad: los cierres
por deadline van a `error_logs` con contexto `chat-turnDeadline` (medir cuántos turnos reales lo
tocan antes de ajustar el default). Los evals no pasan `deadlineAt` (sin límite, como siempre).

## Prompt caching (86aj9w5n8, 2026-08-19)

- **Orden del system message** (index.ts + runner de evals, paridad): prefijo ESTÁTICO por agente
  (`buildContextualPrompt`, ~17k tokens, ya sin fecha) → bloques por-conversación (CLIENTE ACTIVO,
  campaña) → **fecha/hora AL FINAL** (`buildDateBlock`, cambia por minuto — antes vivía dentro del
  prompt contextual).
- **Instrumentación**: los requests del turno van con `stream_options: {include_usage: true}`;
  `sse-parse` extrae `usage` (incl. `prompt_tokens_details.cached_tokens`), `streamTurn` lo
  acumula por ronda y `index.ts` loguea `turn-usage` (greppeable en los logs de la función) con
  promptTokens/cachedTokens/cacheRate/rounds por turno.
- **Medición con sonda contra la API real** (2026-08-19): el endpoint OpenAI-compat SÍ expone
  `cached_tokens` (la duda del ticket era infundada) y el caching implícito funciona: repeticiones
  del prompt de ~17.9k tokens cachean **8175 tokens constantes** (granularidad de bloque del lado
  de Google). Mover la fecha al final no cambió la medición de la sonda (mismo 8175 con la hora
  variando en ambos layouts), pero deja el prefijo máximo estable; el número real de prod (con
  tools y historial creciente) lo dará `turn-usage`.
- **Decisión (AC 3): NO migrar al cliente nativo de Gemini** — la premisa ("el OpenAI-compat no
  expone caching explícito") resultó falsa para la medición; migrar solo se justificaría si más
  adelante quisiéramos caching EXPLÍCITO (cachedContents con TTL), que es otro scope.

## Retrieval etapa 2: pgvector + hybrid search (86aj9w5pn, 2026-08-19)

- **Infra (migración `20260819210000`, aplicada con OK de Nacho):** extensión `vector`, columna
  `properties.embedding vector(768)`, índice HNSW coseno.
- **Embeddings:** `gemini-embedding-001` con `outputDimensionality=768` — ojo: a <3072 dims el
  modelo devuelve el vector SIN normalizar (verificado con sonda; `text-embedding-004` ya no
  existe, 404) → SIEMPRE normalizar L2 antes de guardar/consultar. Query: `RETRIEVAL_QUERY`;
  documentos: `RETRIEVAL_DOCUMENT`.
- **RPC v3 `search_properties_relevance`:** nuevo param opcional `query_embedding vector(768)`.
  Con query y fila embebidas, `relevance_score = 0.6·trigram + 0.4·(1 − dist. coseno)`; sin
  embedding (param NULL o fila sin backfill) el comportamiento es EXACTAMENTE la v2 (verificado
  con smoke en prod: mismos resultados con y sin vector dummy sobre filas sin backfill).
- **Executor:** `toolCtx.embedQuery` (inyectado por index.ts, timeout 4s, fail-open a null) se
  usa SOLO en el reintento por relevancia (title_fallback) — el término se embebe y viaja como
  `query_embedding`. La búsqueda principal (filtros estructurados) no embebe nada.
- **Backfill:** `scripts/backfill-property-embeddings.mjs` (idempotente, `--dry-run` para
  contar; escribe en `properties` reales → GATE). Al 2026-08-19: 3328 activas pendientes.
  Las propiedades nuevas del scraper quedan sin embedding (degradan a trigram) hasta re-correr
  el script — integrarlo al scraper es ticket aparte.
- Mock de evals: ignora `query_embedding` a propósito (filas seed sin embedding ⇒ la RPC real
  degrada a trigram, que es lo que el mock ya calcula).

## Inteligencia de mercado dinámica (86aj9w5pv, 2026-08-19)

- **`market_stats(zone, property_type, operation)`**: mediana/rango (p25–p75) de precio y de
  precio por m², días en mercado y fecha del dato más reciente, calculados sobre `properties`
  REALES activas, agrupado por moneda (USD/ARS jamás se mezclan). Cálculo puro en
  `tools/market.ts` (testeado offline); el case del executor solo hace la query (tabla
  compartida de mercado, sin scope por user). 0 resultados → mensaje honesto sin números.
- **`negotiation_brief(property_id|property_title, client_id|client_name?)`**: propiedad target
  (sin url/photo — el link solo va por tarjetas/generate_report) + comps de su zona/tipo/operación
  (excluyendo la target) + `price_vs_median_pct` + días en mercado + contexto del cliente
  (presupuesto real, visitadas/descartadas de `client_properties`, scopeado por user_id).
- **Prompt**: los precios hardcodeados "(2024-2025 aproximado)" del bloque MERCADO INMOBILIARIO
  se REEMPLAZARON por perfiles cualitativos + regla dura "VALORES DE MERCADO — SOLO POR
  HERRAMIENTA" (prohibido afirmar valores que no vengan de market_stats/negotiation_brief en el
  turno). Hecho canónico actualizado en `alan-facts.ts`.
- Tests: `market.test.ts` (stats puras) + `executor.market.test.ts` (contrato contra el mock
  in-memory, incluye scoping cross-tenant del cliente). El mock de evals soporta las queries
  (query-builder plano), así que los evals ejercitan las tools si el modelo las llama.

## Contratos de tools endurecidos (sprint 2026-08-06)

- **`search_properties`**: `only_active` default true (solo publicaciones activas salvo pedido
  explícito); con `min/max_price` sin `currency` se asume **USD** (el mercado de venta opera en
  dólares; ARS explícito para alquileres); la respuesta ecoa `applied_filters`/`ignored_filters`
  (nada de filtros "aplicados" imaginarios); `exclude_office` + `docta_first` (prioridad Docta);
  `end_of_results` y `price_unset_count` como señales explícitas. Tests de contrato:
  `executor.search.test.ts` (mock de la RPC).
- **Retrieval por RPC trigram (86ak2q73x, 2026-08-19)**: `search_properties` ya NO arma queries
  PostgREST — hace UNA llamada a la RPC `search_properties_relevance` v2 (migración
  `20260819100000`, paridad completa de filtros con la semántica histórica del executor:
  ilike-substring para tipos, `exclude_office` con office-IS-NULL-pasa, `op_filter` exacto para
  regímenes canónicos + `op_filter_like`). La RPC devuelve la página ordenada server-side
  `(docta DESC, relevance DESC, created_at DESC)` + `total_count` (window) + `relevance_score`
  por propiedad (expuesto en el JSON del tool). La paginación es `page_size`/`page_offset`
  server-side (reemplaza el viejo pool + re-rankeo en memoria B1). El **title_fallback**
  (86aj9w5mz) quedó reexpresado: mismo gate anti-espurios (`titleFallbackRegex`), pero el
  reintento va con `search_term=<término>` y umbral de `relevance_score` (≥0.25 o substring en
  título) — absorbe typos ('manantiles' → 'Manantiales'). Único count que sigue en PostgREST:
  `price_unset_count` (la RPC no expresa `price IS NULL`). El mock de evals (`mock-db.ts`)
  implementa la RPC in-memory con similarity trigram estilo pg_trgm.
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
