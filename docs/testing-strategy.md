# Testing strategy — doctabot (Alan)

> Dueño: QA Engineer. Estrategia de testing **aplicada a este repo** (no teoría general): qué se testea acá, en qué nivel y por qué. Última revisión: 2026-06-12 (QA del sprint de auditoría de Alan, 22 tickets en Review).

## Stack

- **Vitest** — unit + integration, una sola suite para front (`src/`) y Edge Functions (`supabase/functions/`). Corrida: `npm test`.
- **Testing Library** — disponible para componentes React (poco usado hoy; la lógica vive en `src/lib/` y se testea pura).
- **Playwright / e2e** — todavía no hay. Ver "Pendiente" abajo.

## Pirámide aplicada

La mayor parte del valor está en **unit tests de funciones puras**. La regla práctica del repo: **la lógica de negocio se extrae a funciones puras exportadas y se testea ahí**, no a través de la Edge Function ni del componente.

- **Unit (la base, donde está casi todo):**
  - `src/lib/property-matching.ts` — matching comprador↔propiedad: presupuesto como techo +30%, zonas/municipios, tipo. (`property-matching.test.ts`, 37 tests)
  - `src/lib/` — contactos, avatares, markers de stream, visibilidad de push (`push-visibility.test.ts`).
  - `supabase/functions/chat/_shared/tools/validators.ts` — normalización de status/tipo de cliente, fechas (Córdoba/Intl), `normalizeDatetime`, `safePositiveNumber`, `sanitizePattern`, neutralización de contenido web. (`validators.test.ts`, 35 tests)
  - `supabase/functions/chat/_shared/stream-turn.ts` — driver de streaming token a token, cierre de `<<<DRAFT>>>`, truncación. (`stream-turn.test.ts`, 14 tests)
  - `_shared/sse-parse.ts`, `_shared/cors.ts` (incl. `validateAttachmentSizes`), `_shared/http.ts`.
- **Integration (pocos):** `tools/execute-round.ts` (loop de dispatch de tools con mocks del modelo).
- **e2e (ninguno hoy):** los criterios runtime-only (ver abajo) se cubren con **QA manual** documentado en el ticket, no automatizado.

## Política de mocks

- **No mockear lo que se valida.** La lógica de negocio se testea pura, sin mocks.
- **El modelo (Gemini) se mockea** a nivel de respuesta SSE en los tests del driver (`stream-turn.test.ts`) — se valida el driver, no al modelo.
- **El cliente Supabase NO se mockea hoy.** Por eso la lógica que vive embebida en `executor.ts` / handlers `serve()` (queries, inserts) **no tiene cobertura unit** — requiere refactor para inyección de dependencias o extracción de funciones puras antes de poder testearse. Ver deuda.

## Casos borde críticos (siempre testear si se tocan)

- **Fechas/timezone:** todo en Córdoba (UTC-3, sin DST) vía `Intl America/Argentina/Cordoba`. Caso borde clave: un evento "hoy" no debe empujarse al año siguiente; cruce de día por UTC. (`validators.test.ts`)
- **Status de cliente:** enum cerrado `hot|warm|cold`. Un sinónimo no reconocido **nunca** debe caer al default `hot` (cae a `warm`). Nunca `active/inactive/...`.
- **Inputs del modelo como string:** el modelo puede mandar números como string (`"50000"`). Los validadores deben coercer (`safePositiveNumber`/`safePositiveInt`).
- **Contenido web no confiable:** `web_search`/`scrape_url` se delimitan y se neutralizan los marcadores de control (anti prompt-injection). Nunca tratarlo como instrucciones.
- **Marcadores de formato:** `===MSG_BREAK===`, `<<<DRAFT_START/END>>>`, `<<<WHATSAPP_TO:>>>`, `[REFERENCIA]`. Un draft sin cerrar debe cerrarse antes de persistir.
- **Inyección PostgREST:** valores interpolados en `.or()` son peligrosos (comas/paréntesis son separadores del parser). Patrón seguro: `.ilike("col", pattern)` de columna única. `sanitizePattern` **no** escapa comas/paréntesis — no es la línea de defensa para `.or()`.

## Checklist de regresión (antes de cada release)

1. `npm test` verde (hoy: 155 tests).
2. `npm run lint` — ⚠️ hay 138 errores **preexistentes** en archivos fuera del chat (`scrape-properties`, `send-push-notification`, `sync-calendar-event`, `tailwind.config`). No bloquean, pero no deberían crecer.
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
2. **Inyección PostgREST en `save_property_to_client`** (86aj0p5by) — el fix (`.ilike` de columna única) no tiene test del escenario de inyección porque vive en `executor.ts` (requiere mock del cliente Supabase). Mitigado parcialmente: ya hay tests de caracterización de `sanitizePattern` que documentan por qué no alcanza para `.or()`. Acción: test de integración del executor con cliente mockeado.
3. **Rate limiting del chat** (86aj0p5c0) — sin test del gate `check_chat_rate_limit` ni del 429. Gate **fail-open**: confirmar con DevOps que la migración esté aplicada en prod.
4. **Filtro `title` y fallbacks de búsqueda** (86ah8v932) / **dormitorios vs ambientes** (86ah1fx0g) / **diferenciación Docta** (86ah8va9f) — `search_properties` (case del `executor.ts`) no tiene cobertura. Mismo bloqueo que (2).
5. **Persistencia del mensaje de usuario + manejo de error del insert** (86aj0p5bc) — sin test (`use-chat-messages.ts`, requiere mock de Supabase + hook testing).

## Pendiente de infraestructura

- No hay e2e (Playwright). Los flujos críticos runtime-only se cubren manual. Evaluar con DevOps un smoke e2e del happy path del chat.
- Considerar un módulo compartido de matching (front `src/lib` ↔ backend `morning-matches`) para eliminar la duplicación de lógica que ya generó un bug (86aj165ed). Coordinar con /architect.
