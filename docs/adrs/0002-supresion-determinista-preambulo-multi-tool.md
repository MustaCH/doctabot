# ADR-002: Supresión determinista del preámbulo en turnos multi-herramienta

**Estado:** Aceptado
**Fecha:** 2026-06-14
**Decisor(es):** Nacho + AI & Automation Engineer agent

> Enmienda parcialmente al [ADR-001](0001-supervisor-post-hoc-streaming.md): revierte la granularidad **token a token** de su Decisión. El resto del ADR-001 — supervisor post-hoc, eliminación del retry-loop — sigue vigente.

## Contexto

El [ADR-001](0001-supervisor-post-hoc-streaming.md) estableció streaming optimista **token a token**: el driver `_shared/stream-turn.ts` pipea al cliente cada delta de `content` de Gemini a medida que llega, en **todas** las rondas del tool-loop.

Eso destapó un bug (ticket `86aj1n43n`): en un turno que encadena varias herramientas (ej. *"buscá propiedades para Armando"* → revisar contacto → buscar → guardar), el modelo **regenera un saludo y re-narra el caso** en rondas posteriores del loop (re-lee el historial crecido y "arranca de cero"). Como cada ronda se streamea, esos re-saludos y narraciones duplicadas llegaban al usuario. El criterio de aceptación era *"Alan saluda como máximo una vez por turno"*.

Se intentó primero un fix **por prompt** (regla canónica + prosa instruccional, commit `dea762e`). QA lo midió empíricamente: **2 de 5 turnos** seguían con re-saludo. Un fix de prompt es probabilístico por naturaleza — no puede *garantizar* "máximo una vez".

La fuerza en tensión: para suprimir el preámbulo de una ronda de forma **determinista** hay que conocer su `finish_reason` (si termina en `tool_calls` es un preámbulo intermedio; si termina en texto es la respuesta final). Pero el `content` se streamea **antes** de que aparezcan los `tool_calls` / el `finish_reason`. Es decir: **streaming token a token y supresión determinista son mutuamente excluyentes** — para poder suprimir hay que bufferizar la ronda entera.

La decisión, entonces, no es de implementación sino de producto: **¿priorizamos el streaming token a token (ADR-001) o la garantía determinista de que el re-saludo nunca llega al usuario?**

## Decisión

Adoptamos **buffering por ronda con supresión determinista del preámbulo**:

- El driver `stream-turn.ts` ya **no** emite `content` token a token. **Bufferiza** el contenido de cada ronda y decide al conocer el `finish_reason`.
- Ronda que termina en `tool_calls` → su preámbulo se **descarta**: no se emite al cliente ni se persiste. (Sí se conserva en `messages` para la memoria del modelo.)
- Solo la **ronda de texto final** (o una truncada por `length`) se vuelca al cliente, de una.
- **Fallback anti-pantalla-muda:** si el turno agota las iteraciones sin una ronda de texto final, se vuelca el último preámbulo suprimido.

Con esto, el re-saludo y la narración duplicada pasan de "menos probables" a **imposibles**: el usuario ve un único mensaje (la ronda final), que contiene a lo sumo un saludo.

## Alternativas consideradas

### Opción A: Solo el fix de prompt (regla canónica + prosa)
- **Pros:** preserva el streaming token a token del ADR-001; cambio mínimo; no toca el driver.
- **Contras:** probabilístico — QA midió 2/5 re-saludos. No garantiza el AC "máximo una vez".
- **Por qué no:** un prompt no puede *garantizar* la ausencia de un comportamiento del modelo. Queda igual como **segunda capa** (defensa en profundidad) sobre la supresión determinista.

### Opción B: Strip quirúrgico del saludo en las continuaciones (preservando streaming)
- **Pros:** mantiene el streaming token a token y la narración intermedia; bufferiza solo un prefijo corto de cada ronda de continuación y borra un saludo si aparece (regex).
- **Contras:** es **pattern-based** — un saludo con wording exótico podría escaparse; no es 100% determinista; más lógica de borde (lookahead de prefijo).
- **Por qué no:** Nacho priorizó explícitamente el determinismo total sobre el streaming (2026-06-14). Queda documentada como la vía para **recuperar el streaming** si el trade-off de la Opción C resulta muy caro en uso real (sería un ADR futuro).

### Opción C: Buffering por ronda + supresión total *(elegida)*
- (Ver **Decisión**.) Única opción que **garantiza** el AC, al costo del streaming.

## Consecuencias

### Positivas
- Re-saludo y narración duplicada **imposibles por construcción** (no probabilístico). AC cumplido de forma determinista.
- Cae justo con el indicador de "Alan trabajando" (fix de `86aj1n43n` en `Chat.tsx`): como durante el turno no se emite nada, el indicador queda activo toda la espera y se apaga recién con la respuesta. Sinergia con el ticket `86aj1naw2`.
- Consistencia preservada: lo mostrado == lo persistido (`fullContent`) == lo que evalúa el supervisor.
- Cambio contenido en un solo módulo (`stream-turn.ts`), con tests.

### Negativas
- **Se pierde el streaming token a token** — el headline benefit del ADR-001. Aplica a **todas** las respuestas (incluso las simples sin tools), porque hay que bufferizar cada ronda para decidir. La respuesta final aparece de un saque, no "tipeándose". Sube el TTFB percibido.
- Se pierde la **narración intermedia** del turno multi-tool (el usuario ya no ve "déjame ver sus contactos", "encontré a X, ¿qué busca?"). Depende del indicador (`86aj1naw2`) para no dejar la pantalla muda.
- Deuda documental: la regla 6 de `CLAUDE.md` ("streaming token a token") queda desactualizada y hay que corregirla.

### Neutras
- Los preámbulos suprimidos **siguen** en `messages` (memoria del modelo) — el modelo mantiene continuidad del turno aunque el usuario no los vea.
- Se agrega un fallback para el caso borde de agotar iteraciones sin ronda de texto final.
- No cambia el rol del supervisor ni nada del ADR-001 más allá de la granularidad del emit.

## Notas de implementación

- `_shared/stream-turn.ts` — `applyDelta` ya no emite ni acumula en vivo; el `content` se junta en `assistantContent` y se vuelca/descarta al conocer el `finish_reason`. Flags `lastPreamble` (fallback) y `emittedFinal`.
- `_shared/stream-turn.test.ts` — +2 tests (supresión del preámbulo en ronda con `tool_calls` / fallback anti-pantalla-muda). Suite 206/206.
- Sin migraciones. Deploy: edge `chat` v11. Front sin cambios (el `MarkerStream` maneja igual un flush grande).
- Validar post-deploy: 0 re-saludos en el repro multi-tool, y que la UX "indicador + respuesta de un saque" sea aceptable.

## Referencias

- [ADR-001](0001-supervisor-post-hoc-streaming.md) — el que esta decisión enmienda (granularidad del streaming).
- Tickets ClickUp (Space ALAN): `86aj1n43n` (re-saludo), `86aj1naw2` (indicador + continuaciones, companion).
- Commits: `dea762e` (fix de prompt, Opción A) → `46081cd` (Opción C, esta decisión).
