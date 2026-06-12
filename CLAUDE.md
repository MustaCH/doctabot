# CLAUDE.md — Alan (doctabot)

Guía para agentes que editan este repo. Para qué es el proyecto, stack y deploy → ver [README.md](./README.md).

## Qué es

PWA con un asistente de IA ("Alan") para agentes inmobiliarios de RE/MAX Docta (Córdoba, AR). El usuario conversa por texto o voz y Alan ejecuta acciones reales (buscar propiedades, CRM, calendario, email/WhatsApp, búsqueda web) vía herramientas sobre Gemini.

## Comandos

```sh
npm run dev        # dev server
npm run build      # build prod
npm run lint       # ESLint
npm test           # Vitest (una corrida)
```

> Entorno de trabajo: **Windows + PowerShell**. Ojo con rutas y comandos POSIX.

## Mapa mental del código

- **Frontend** en `src/`. El chat es la pantalla principal (`src/pages/Chat.tsx` + `src/hooks/use-chat-messages.ts` + `src/lib/stream-chat.ts`).
- **Alan vive en el backend**: `supabase/functions/chat/` es un orquestador delgado; toda la lógica está en `supabase/functions/chat/_shared/`. Empezá por ahí para cualquier cambio de comportamiento del asistente.
- DB: Postgres de Supabase. El esquema está en `supabase/migrations/`. Los tipos en `src/integrations/supabase/types.ts`.

## Reglas y gotchas (importante)

1. **Archivos generados — no editar a mano:** `src/integrations/supabase/client.ts` y `src/integrations/supabase/types.ts`. Los types se regeneran desde el esquema.

2. **Las Edge Functions usan el `service_role` key → bypassean RLS.** Por eso **cada tool filtra manualmente por `.eq("user_id", userId)`**. Si agregás una query a datos del usuario, scopeala por `userId` sí o sí, o exponés datos de otros agentes.

3. **Reglas de comportamiento canónicas: una sola fuente.** Los hechos/reglas duras de Alan (marcadores, enums de cliente, confirmación de email, prioridad Docta, contenido web no confiable, etc.) viven en `_shared/alan-facts.ts` (`ALAN_CONTEXT_FACTS`). Tanto el system prompt (`_shared/prompt.ts`) como el supervisor (`_shared/supervisor.ts`) los importan de ahí: para cambiar una regla canónica editás `alan-facts.ts` y se refleja en los dos. La prosa instruccional detallada (el "cómo") sigue viviendo en `prompt.ts`; el supervisor solo evalúa contra los hechos canónicos.

4. **Marcadores de formato que el front parsea — no romper:**
   - `===MSG_BREAK===` → separa la respuesta en burbujas de chat.
   - `<<<DRAFT_START>>>` … `<<<DRAFT_END>>>` → borradores copiables (email/WhatsApp).
   - `<<<WHATSAPP_TO:+549...>>>` → botón "Enviar por WhatsApp".
   - `[REFERENCIA]` … `[FIN REFERENCIA]` → texto citado por el usuario.
   Tanto el prompt como `sse.ts` y `stream-chat.ts` dependen de estos strings exactos.

5. **IA = Gemini directo (endpoint OpenAI-compatible), no Lovable Gateway.** En `chat/index.ts` vas a ver una variable `LOVABLE_API_KEY` que es solo un alias de `GEMINI_API_KEY` (legado). Modelos: `gemini-2.5-pro` para el turno, `gemini-2.5-flash` para supervisor/títulos/transcripción.

6. **Streaming real, supervisor post-hoc.** El turno se streamea token a token vía `_shared/stream-turn.ts` (driver con tool loop); cada token se reenvía al cliente. El supervisor (`_shared/supervisor.ts`) corre **después** de cerrar el stream, en background (`EdgeRuntime.waitUntil`), y **no bloquea ni reescribe** lo que ve el usuario — solo evalúa y loguea (ver ADR 0001). El catch de `index.ts` (cuando `streamTurn` tira) persiste un mensaje de error estático y no corre el supervisor.

7. **Validación de inputs de tools** centralizada en `_shared/tools/validators.ts`. Reutilizá `sanitizePattern`, `safePositiveInt`, `UUID_REGEX`, `normalizeClientStatus`, etc. en vez de validar a mano.

8. **Estados / tipos de cliente son cerrados:** status `hot|warm|cold`, client_type `buyer|seller|both`. Nunca uses `active/inactive/prospect/closed`. Hay sinónimos normalizados en `normalizeClientStatus`.

9. **Zona horaria:** todo en Córdoba (UTC-3). Hay helpers de fecha; evitá inventar otro cálculo de timezone.

## Idioma y tono

- Strings de usuario y respuestas de Alan: **español argentino con voseo** (vos, usás, tenés). Términos técnicos en inglés.
- Emojis con moderación (el front y el prompt ya tienen convenciones de emojis para tarjetas de propiedad: 🏠 💰 📍 📐 🏢 🔗 — no los uses fuera de ese contexto).

## Tests

Vitest. Hay tests en `src/lib/*.test.ts` (matching, contactos) y en `supabase/functions/_shared/*.test.ts` (cors, http, validation). Si tocás lógica con test asociado, corré `npm test` antes de dar por terminado.

## Seguridad

- Nunca commitear `.env` ni secrets (están fuera del tracking; viven en Dokploy/Supabase).
- El system prompt tiene reglas anti prompt-injection; si tocás el manejo de contenido externo (web_search/scrape_url) tené presente que ese contenido **no es confiable**.

## Gestión del proyecto

El tracking vive en **ClickUp**, Space "ALAN" (lo maneja el Project Manager, `/pm`). Bugs y mejoras conocidas están como tickets ahí — consultá antes de asumir que algo no está reportado.
