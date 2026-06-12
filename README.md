# Alan — Asistente IA para agentes inmobiliarios (RE/MAX Docta)

**Alan** es una PWA con un asistente de IA conversacional para los agentes inmobiliarios de **RE/MAX Docta** (Córdoba, Argentina). Desde un chat, el agente busca propiedades, gestiona su mini-CRM de clientes, agenda visitas en Google Calendar, redacta y envía emails/WhatsApp, y consulta el mercado — todo en lenguaje natural, con voz o texto.

El asistente (Alan) corre sobre **Gemini** con una capa de herramientas (30 tools), un **supervisor de calidad** que valida cada respuesta, y soporte multimodal (imágenes y PDFs).

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind + shadcn/ui (Radix) |
| Routing / estado | React Router v6 + TanStack Query |
| Backend | Supabase (Auth + Postgres + Edge Functions en Deno) |
| IA | Gemini API (OpenAI-compatible): `gemini-2.5-pro` (chat) · `gemini-2.5-flash` (supervisor, títulos, transcripción) |
| Búsqueda web | Firecrawl (search + scrape) |
| Integraciones | Google Calendar + Gmail (OAuth), n8n (webhooks), Web Push (PWA) |
| Deploy | Docker (build Vite → nginx) sobre VPS vía Dokploy |

---

## Arranque local

Requisitos: Node.js 20+ (el repo se versiona con `bun.lock`, pero el build usa npm).

```sh
npm install --legacy-peer-deps
npm run dev
```

### Variables de entorno (frontend)

Vite las hornea en el bundle en build-time. Crear un `.env` local:

```sh
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
VITE_SUPABASE_PROJECT_ID=<project id>
```

> El `.env` **no se versiona** (está fuera del tracking). Las credenciales reales viven en Dokploy como Environment Variables.

### Secrets de las Edge Functions

Se configuran en Supabase (no en el frontend):

```
GEMINI_API_KEY            # Gemini (chat, supervisor, transcripción, títulos)
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY # acceso admin desde las functions
SUPABASE_ANON_KEY         # validación de JWT del usuario
GOOGLE_CLIENT_ID          # OAuth Calendar/Gmail
GOOGLE_CLIENT_SECRET
FIRECRAWL_API_KEY         # web_search / scrape_url / portales externos
N8N_WEBHOOK_URL           # alertas de fallos del supervisor (opcional)
```

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Dev server con HMR |
| `npm run build` | Build de producción |
| `npm run build:dev` | Build en modo development |
| `npm run lint` | ESLint |
| `npm run test` | Tests (Vitest, una corrida) |
| `npm run test:watch` | Tests en watch |

---

## Estructura

```
src/
  pages/            Rutas (Chat, Clients, Properties, Dashboard, Profile, …)
  components/       UI (ChatMessage, PropertyCard, … + ui/ de shadcn)
  hooks/            use-chat-messages, use-audio-recorder, use-push-notifications, …
  lib/              stream-chat (SSE), property-matching, contact-* (con tests)
  contexts/         AuthContext
  integrations/     Supabase client + types (generados)
  sw.ts             Service worker (PWA + push)

supabase/
  functions/
    chat/           ⭐ Núcleo de Alan (ver abajo)
    transcribe/     Voz → texto (Gemini)
    scrape-properties/      Ingesta de propiedades
    google-calendar-auth/   OAuth de Google
    sync-calendar-event/    Sync de eventos
    morning-matches/        Matching diario cliente↔propiedad
    parse-client-import/    Importación de clientes (Excel/CSV)
    send-push-notification/ Web Push
    admin-stats/  ·  test-webhook/
    _shared/        CORS, http, validation compartidos
  migrations/       Esquema de la base (Postgres)
```

### El núcleo de Alan (`supabase/functions/chat/`)

La function `chat` es un **orquestador delgado**; la lógica vive en `_shared/`:

| Módulo | Rol |
|---|---|
| `prompt.ts` | System prompt + contexto del agente + armado de mensajes multimodales |
| `tools/definitions.ts` | Schemas de las 30 herramientas |
| `tools/executor.ts` | Dispatcher que ejecuta cada herramienta |
| `tools/validators.ts` | Sanitización de inputs |
| `tools/google.ts` | Helpers de Calendar / Gmail |
| `auth.ts` | Validación de JWT + perfil del agente |
| `supervisor.ts` | Supervisor de calidad + loop de retry + logging |
| `notifications.ts` | Web Push + webhook n8n |
| `title.ts` | Título automático de la conversación |
| `sse.ts` | Respuesta por Server-Sent Events |

**Flujo de un turno:** autenticación → armado del prompt con contexto del agente → llamada a Gemini con tools → loop de tool-calls (máx. 5) → supervisor de calidad (con retry si rechaza) → persistencia → respuesta SSE al cliente.

---

## Rutas de la app

| Ruta | Página | Acceso |
|---|---|---|
| `/login` | Login (Google OAuth vía Supabase) | público |
| `/onboarding` | Alta de perfil del agente | autenticado |
| `/tutorial` | Tutorial inicial | autenticado |
| `/` | **Chat con Alan** | perfil completo |
| `/properties` | Listado de propiedades | perfil completo |
| `/clients` · `/clients/:id` | Mini-CRM | perfil completo |
| `/dashboard` | Tareas, eventos y matches | perfil completo |
| `/profile` | Perfil + conexión de Google | perfil completo |
| `/changelog` | Novedades | perfil completo |
| `/superadminpanel` | Panel de admin | — |

---

## Deploy

Build multi-stage con Docker: compila el frontend con Vite y lo sirve con **nginx** (config SPA + cache de assets + no-cache del service worker para que la PWA reciba updates). Se despliega en un **VPS vía Dokploy**, que inyecta las `VITE_*` como build args.

```sh
docker build \
  --build-arg VITE_SUPABASE_URL=... \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=... \
  --build-arg VITE_SUPABASE_PROJECT_ID=... \
  -t alan .
```

Las Edge Functions se despliegan por separado en Supabase.

---

## Origen

El proyecto se scaffoldeó inicialmente con Lovable y luego se sacó de esa plataforma: hoy la auth es Google OAuth nativo de Supabase, las URLs de las functions derivan de env, y el deploy es self-hosted en VPS.
