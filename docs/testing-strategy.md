# Testing strategy — doctabot (Alan)

> Dueño: QA Engineer. Estrategia de testing **aplicada a este repo** (no teoría general): qué se testea acá, en qué nivel y por qué. Última revisión: 2026-08-18 (post sprint de hardening 2026-08-06: **525 tests en 36 suites**).

## Stack

- **Vitest** — unit + integration, una sola suite para front (`src/`) y Edge Functions (`supabase/functions/`). Corrida: `npm test`.
- **Testing Library** — en uso para componentes/hooks puntuales (`PropertyCard.test.tsx`, `use-chat-messages.test.tsx`); la mayor parte de la lógica sigue viviendo en `src/lib/` y se testea pura.
  - ⚠️ Gotcha: `PropertyCard.test.tsx` importa el client generado de Supabase → necesita `VITE_SUPABASE_URL` (`.env`). Sin `.env` local esa suite falla en colección ("supabaseUrl is required"); las otras 35 corren igual.
- **Playwright / e2e** — todavía no hay. Ver "Pendiente" abajo.

## Pirámide aplicada

La mayor parte del valor está en **unit tests de funciones puras**. La regla práctica del repo: **la lógica de negocio se extrae a funciones puras exportadas y se testea ahí**, no a través de la Edge Function ni del componente.

- **Unit (la base, donde está casi todo):**
  - `src/lib/property-matching.ts` — matching comprador↔propiedad: presupuesto como techo +30%, zonas/municipios, tipo. (`property-matching.test.ts`)
  - `src/lib/draft-parse.ts` — parser de drafts/burbujas del front, con **test de paridad streaming (MarkerStream) vs recarga (`splitBubbles`)**: mismos bubbles por los dos caminos. (`draft-parse.test.ts`)
  - `src/lib/` — contactos, avatares, markers de stream, visibilidad de push, contratos de tarjetas front↔server (`contact-card-contract.test.ts`, `match-card-contract.test.ts`).
  - `supabase/functions/chat/_shared/tools/validators.ts` — normalización de status/tipo de cliente, fechas (Córdoba/Intl), `safePositiveNumber`, `sanitizePattern`, neutralización de contenido web. (`validators.test.ts`)
  - `supabase/functions/chat/_shared/stream-turn.ts` — driver de streaming, `closeUnbalancedDrafts` region-aware, truncación, tope de iteraciones, `sanitizeFinal` fail-open, leaks de razonamiento. (`stream-turn.test.ts`)
  - Guardarraíles deterministas: `whatsapp-guardrail.test.ts` (bloques enteros + gate + corrección por nombre), `link-guardrail.test.ts`, `card-render.test.ts`.
  - `prompt.test.ts` (`buildAIMessages`: roles, fusión, topes 40 msgs/60k chars), `supervisor-rules.test.ts` + `supervisor-rules.search-claims.test.ts` (claims vs `applied_filters`), `google.test.ts` (MIME anti-CRLF), `retry.test.ts`.
  - `_shared/` (raíz de functions): `oauth-state.test.ts` (state HMAC + nonce), `cors.test.ts`, `http.test.ts`, `validation.test.ts`.
  - Otras functions: `scrape-properties` (`cleanup-guard.test.ts`, `dedupe.test.ts`), `morning-matches` (`matching`, `batching`, `format`), `send-push-notification` (`webpush.test.ts`).
- **Integration (pocos pero creciendo):** `tools/execute-round.ts` (loop de dispatch con mocks del modelo) y `tools/executor.search.test.ts` (**contrato de `search_properties` con cliente Supabase mockeado**: `only_active`, USD default, `applied_filters`/`ignored_filters`, `offset`, `docta_first`, `end_of_results`). `use-chat-messages.test.tsx` (hook con Supabase mockeado: indicador isWorking, burbuja nueva en `===MSG_BREAK===`, errores del insert del mensaje que liberan `isStreaming` en vez de trabar la UI).
- **e2e (ninguno hoy):** los criterios runtime-only (ver abajo) se cubren con **QA manual** documentado en el ticket, no automatizado.

## Política de mocks

- **No mockear lo que se valida.** La lógica de negocio se testea pura, sin mocks.
- **El modelo (Gemini) se mockea** a nivel de respuesta SSE en los tests del driver (`stream-turn.test.ts`) — se valida el driver, no al modelo.
- **El cliente Supabase SÍ se mockea donde hace falta** (cambio vs 06/2026): `executor.search.test.ts` y `use-chat-messages.test.tsx` usan un cliente mockeado para testear contratos de tools y comportamiento del hook. El resto de la lógica embebida en `executor.ts` / handlers `serve()` sigue sin cobertura — el patrón para cubrirla ya existe.

## Casos borde críticos (siempre testear si se tocan)

- **Fechas/timezone:** todo en Córdoba (UTC-3, sin DST) vía `Intl America/Argentina/Cordoba`. Caso borde clave: un evento "hoy" no debe empujarse al año siguiente; cruce de día por UTC. (`validators.test.ts`)
- **Status de cliente:** enum cerrado `hot|warm|cold`. Un sinónimo no reconocido **nunca** debe caer al default `hot` (cae a `warm`). Nunca `active/inactive/...`. Desde 2026-08 la DB también lo garantiza (CHECK `clients_status_check`, default `warm`) — un bug de validación en código ya no persiste basura.
- **Inputs del modelo como string:** el modelo puede mandar números como string (`"50000"`). Los validadores deben coercer (`safePositiveNumber`/`safePositiveInt`).
- **Contenido web no confiable:** `web_search`/`scrape_url` se delimitan y se neutralizan los marcadores de control (anti prompt-injection). Nunca tratarlo como instrucciones.
- **Marcadores de formato:** `===MSG_BREAK===`, `<<<DRAFT_START/END>>>`, `<<<WHATSAPP_TO:>>>`, `[REFERENCIA]`. Un draft sin cerrar debe cerrarse antes de persistir.
- **Inyección PostgREST:** valores interpolados en `.or()` son peligrosos (comas/paréntesis son separadores del parser). Patrón seguro: `.ilike("col", pattern)` de columna única. `sanitizePattern` **no** escapa comas/paréntesis — no es la línea de defensa para `.or()`.

## Checklist de regresión (antes de cada release)

1. `npm test` verde (hoy: **525 tests, 36 suites**; ver gotcha de `PropertyCard.test.tsx` + `.env` arriba).
2. `npm run lint` — ⚠️ hay **241 errores + 15 warnings preexistentes** (medido 2026-08-18), mayormente en archivos fuera del chat. No bloquean, pero no deberían crecer.
3. **QA manual de lo runtime-only** (ver abajo) si se tocó streaming, push, multimodal o el modelo.
4. **Verificar migraciones aplicadas en prod** antes de confiar en features con gate fail-open (ej. rate limiting).

## Comportamientos runtime-only (QA manual, no automatizado)

No se pueden validar leyendo código; se prueban a mano en dispositivo/entorno real:

- **Streaming progresivo** (86aj0p58w): el texto aparece token a token, no de golpe.
- **Push con foco real** (86aj0p5ce): con el chat abierto en la conversación X no llega push; en background sí.
- **Multimodal al recargar** (86aj0p5bg): subir imagen → recargar → Alan la sigue "viendo" en el siguiente turno (depende de RLS de Storage + que Gemini reciba la signed URL).
- **Obediencia anti prompt-injection** (86aj0p5bw): que el LLM ignore instrucciones embebidas en una página scrapeada.

## Deuda de QA (priorizada)

Fixes que pasaron QA en código pero **sin cobertura automatizada**. Orden por valor/riesgo:

1. **`morning-matches` — ✅ ruta de zona resuelta; resto sin cobertura.** El cross-match de municipios (**bug 86aj165ed, Done**) se arregló extrayendo la lógica pura a `supabase/functions/morning-matches/matching.ts` (ahora importable/testeable) + test de regresión en `matching.test.ts` (caso San Salvador vs Falda del Carmen). **Pendiente:** (a) el resto de `matching.ts` (`findSellerBuyerMatchReasons`, `normalizePropertyType`, budget-en-notas) y el handler `serve()` siguen sin cobertura; (b) la lógica sigue **duplicada** con `src/lib/property-matching.ts` — la dedup front↔edge es el feature 86aj18j1w (vía /architect). Nota: las Edge Functions Deno no se pueden `deno check` en este entorno (sin Deno local) → la validación de deploy queda en /devops.
2. **Inyección PostgREST en `save_property_to_client`** (86aj0p5by) — el fix (`.ilike` de columna única) sigue sin test del escenario de inyección. El bloqueo histórico (no había mock del cliente Supabase) **ya no existe**: `executor.search.test.ts` estableció el patrón. Acción pendiente: extenderlo al case de inyección.
3. **Rate limiting del chat** (86aj0p5c0) — sin test del gate `check_chat_rate_limit` ni del 429. Gate **fail-open**; la migración figura aplicada en prod (confirmado 2026-06-13).
4. ✅ **`search_properties` — cobertura de contrato resuelta (sprint 2026-08-06):** `executor.search.test.ts` testea el case del executor con cliente mockeado (`only_active`, USD default, `applied_filters`/`ignored_filters`, `offset`, `docta_first`, `end_of_results`). Los casos históricos específicos (filtro `title` 86ah8v932, dormitorios vs ambientes 86ah1fx0g) siguen sin test dedicado, pero el andamiaje existe.
5. ✅ **Persistencia del mensaje de usuario + manejo de error del insert** (86aj0p5bc) — cubierto por `use-chat-messages.test.tsx` (insert que tira o devuelve error → `isStreaming` se libera, no se streamea).

## Pendiente de infraestructura

- No hay e2e (Playwright). Los flujos críticos runtime-only se cubren manual. Evaluar con DevOps un smoke e2e del happy path del chat.
- Considerar un módulo compartido de matching (front `src/lib` ↔ backend `morning-matches`) para eliminar la duplicación de lógica que ya generó un bug (86aj165ed). Coordinar con /architect.
