# Edge Functions Hardening — Design Spec

**Fecha:** 2026-06-09
**Estado:** Diseño aprobado — pendiente review del spec escrito
**Scope elegido:** "Piso" (consistencia + no filtrar errores + validación). Validación con helper manual compartido.

## Contexto

Doctabot tiene 10 edge functions (Deno) en `supabase/functions/`. Una (`chat`) ya tiene
un `_shared/` maduro (cors, auth, validators, sse…). Las otras **9 son `index.ts` sueltos**
que reimplementan CORS, manejo de errores y validación cada una a su manera, con problemas
concretos detectados al leer el código:

- **Filtrado de errores internos al cliente** (info disclosure):
  - `parse-client-import` puede devolver `"GEMINI_API_KEY not configured"`.
  - `test-webhook` hace `JSON.stringify({ error: String(err) })`.
  - `send-push-notification` hace `{ error: err.message }`.
- **Validación mínima** ("existe / no existe"), sin límites de largo ni chequeo de tipos/formatos.
  Ej.: `send-push` solo checkea `if (!user_id || !title)` y no capa `title`/`body`/`url`.
- **Status codes incorrectos**: input inválido devuelve `500` (no `400`) en varias funciones.
- **CORS duplicado e inconsistente**: cada función define su `corsHeaders` inline; ya hay
  **2 variantes distintas** (lista de headers corta vs larga).
- **Cero tests** en `supabase/functions/`.

## Objetivo (scope: "piso")

Un pase de **consistencia + robustez de bajo riesgo** que:

1. Centralice CORS, respuestas y validación en helpers compartidos.
2. Corte el filtrado de errores internos al cliente.
3. Agregue validación de inputs real por función.
4. Cubra la lógica de validación con tests.

**Sin cambiar quién puede llamar a cada función** (mismo modelo de auth) y **sin romper el
contrato con el frontend**.

## No-objetivos (follow-ups explícitos)

Deliberadamente fuera de este pase, anotados para más adelante:

- **Autorización / ownership**: cerrar que `send-push` deje pushear a cualquier `user_id`,
  o que `parse-client-import` exija auth propia. Sigue dependiendo del JWT de plataforma.
- **Control de costos / rate-limit** en las funciones que pegan a Gemini.
- **Lockear CORS** a un origen específico (se deja el terreno listo, no se cierra).
- **Refactor de `chat`**: queda intacto.
- **Bump de versiones** de imports Deno (`std@0.168.0`, `esm.sh/...`).

## Enfoque

**Helpers compartidos con cambio mínimo por función** — elegido sobre (b) un wrapper
`withHandler` que reestructura todas las funciones, y (c) arreglos inline sin módulo que
perpetúan la duplicación. Cada función importa los helpers y los usa dentro de su `try/catch`
actual: diff chico, revisable de a una, riesgo bajo.

## Diseño

### Módulos nuevos: `supabase/functions/_shared/`

Raíz compartida entre funciones. Distinto del `chat/_shared/` interno, que **no se toca**.

**`cors.ts`**
```ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Devuelve la respuesta de preflight si el método es OPTIONS; si no, null. */
export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return null;
}
```

**`http.ts`**
```ts
import { corsHeaders } from "./cors.ts";

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

/** Loguea el error real server-side y devuelve un mensaje genérico y seguro al cliente. */
export function safeError(err: unknown, fn: string): string {
  console.error(`[${fn}]`, err);
  return "Error interno del servidor";
}
```

**`validation.ts`** (puro: sin `Deno.env`, sin imports remotos → testeable en vitest)
```ts
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireString(
  value: unknown,
  field: string,
  opts: { minLength?: number; maxLength?: number } = {},
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} es requerido`);
  }
  const v = value.trim();
  if (opts.minLength != null && v.length < opts.minLength) {
    throw new ValidationError(`${field} es demasiado corto`);
  }
  if (opts.maxLength != null && v.length > opts.maxLength) {
    throw new ValidationError(`${field} excede el largo máximo`);
  }
  return v;
}

export function optionalString(
  value: unknown,
  field: string,
  opts: { maxLength?: number } = {},
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ValidationError(`${field} debe ser texto`);
  const v = value.trim();
  if (opts.maxLength != null && v.length > opts.maxLength) {
    throw new ValidationError(`${field} excede el largo máximo`);
  }
  return v;
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    throw new ValidationError(`${field} inválido`);
  }
  return value;
}

export function requireNonEmptyArray<T = unknown>(
  value: unknown,
  field: string,
  opts: { maxItems?: number } = {},
): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${field} es requerido`);
  }
  if (opts.maxItems != null && value.length > opts.maxItems) {
    throw new ValidationError(`${field} tiene demasiados elementos`);
  }
  return value as T[];
}

export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | null {
  if (value == null) return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} inválido`);
  }
  return value as T;
}
```

### Regla de errores (preserva el contrato con el front)

- **Éxito:** shapes idénticos a hoy.
- **Error:** se mantiene el envelope `{ error: string }` (el front ya lee `error`).
- **Mensajes intencionales y seguros** (validación → 400, `"Demasiadas solicitudes"` → 429,
  `"Créditos de IA agotados"` → 402) → **se preservan tal cual**.
- **`catch` final:** en vez de `err.message` / `String(err)` crudo → `safeError(err, fn)`
  (mensaje genérico + log server-side). Ahí muere el info-disclosure.
- **`ValidationError`:** se mapea a `errorResponse(err.message, 400)`.

### CORS

Unificado en la variante larga (superset de las dos actuales, no rompe ningún caller) +
`Access-Control-Allow-Methods: "POST, OPTIONS"`. `Origin: *` se mantiene (lockear el origen
es un follow-up).

### Patrón por función (ejemplo `send-push-notification`)

Antes:
```ts
const corsHeaders = { /* variante propia */ };
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { user_id, title } = body;
    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "user_id and title required" }), { status: 400, headers: {...} });
    }
    // ...
    return new Response(JSON.stringify({ sent }), { headers: {...} });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: {...} });
  }
});
```

Después:
```ts
import { handleOptions } from "../_shared/cors.ts";
import { jsonResponse, errorResponse, safeError } from "../_shared/http.ts";
import { requireString, requireUuid, optionalString, ValidationError } from "../_shared/validation.ts";

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const body = await req.json();
    // branch get_vapid_key intacto…
    const userId = requireUuid(body.user_id, "user_id");
    const title  = requireString(body.title, "title", { maxLength: 200 });
    const pushBody = optionalString(body.body, "body", { maxLength: 500 });
    const url = optionalString(body.url, "url", { maxLength: 500 });
    // ...lógica intacta...
    return jsonResponse({ sent });
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400);
    return errorResponse(safeError(err, "send-push-notification"), 500);
  }
});
```

### Scope por función

**In (9):** `admin-stats`, `google-calendar-auth`, `parse-client-import`, `scrape-properties`,
`send-push-notification`, `sync-calendar-event`, `transcribe`, `test-webhook`, `morning-matches`.

- **`chat`:** intacto este pase.
- **`test-webhook`:** se endurece (corta el `String(err)`, valida que `pin` sea string),
  **no se borra** — es el test de notificación a N8N del Super Admin Panel.

**Validación concreta ya definida** (funciones leídas en detalle):

- **`send-push-notification`:** `user_id` = `requireUuid`; `title` = `requireString(≤200)`;
  `body`/`url` = `optionalString(≤500)`. El branch `action === "get_vapid_key"` queda intacto.
- **`parse-client-import`:** `headers` = `requireNonEmptyArray(≤200)`; `sampleRows` = array
  opcional (`≤50`). Se preservan los mensajes 429/402 existentes.
- **`test-webhook`:** `pin` = `requireString`; se mantiene la comparación contra `SUPER_ADMIN_PIN`.

**Resto (6 funciones):** mismo tratamiento — (a) reemplazar CORS/errores inline por los helpers,
(b) validar sus inputs propios con `validation.ts`. Los inputs concretos de cada una se enumeran
función por función en el **plan de implementación** (paso siguiente), tras leer cada `index.ts`.
Nota: algunas (p.ej. `morning-matches`) pueden ser invocadas por cron/internamente y no por el
browser; se ajusta CORS/validación según corresponda al leerlas.

### Testing

- Unit tests (vitest) para los helpers puros: `validation.ts` (el grueso) y `http.ts`.
- Extender `vitest.config.ts` `include` a:
  `["src/**/*.{test,spec}.{ts,tsx}", "supabase/functions/**/*.{test,spec}.{ts,tsx}"]`.
- Tests co-localizados: `_shared/validation.test.ts`, `_shared/http.test.ts`.
- Los `index.ts` quedan **fuera** del unit-test (importan módulos remotos de Deno y `Deno.env`);
  se verifican con smoke manual tras el redeploy.

## Riesgos y mitigaciones

- **Contrato con el front** → se preservan los shapes de éxito y los mensajes de error
  intencionales; solo se generaliza el `catch` final. Verificación de smoke por función.
- **Sync con Lovable** → cambios mayormente aditivos (`_shared/` nuevo) + edits chicos por
  función; commits enfocados; Nacho redeploya las funciones afectadas.
- **Resolución de imports `.ts` en vitest** → los helpers son import-clean (sin remoto, sin
  `Deno.env`); el resolver de Vite maneja la extensión `.ts`. Si fallara, fallback a importar
  sin extensión desde el test.
- **`morning-matches` (cron)** → se confirma su modo de invocación al leerla; si no la llama el
  browser, CORS es inocuo igual.

## Verificación (criterios de éxito)

- Los 42 tests existentes de la app siguen verdes; nuevos tests de `validation`/`http` verdes;
  `tsc` / typecheck limpio.
- Smoke manual por función tras redeploy (Nacho): happy path devuelve el **mismo shape**;
  input inválido → `400` con mensaje claro; error forzado → `500` genérico (y el error real
  aparece en los logs de Supabase).

## Follow-ups (post-pase)

1. Autorización / ownership (opción B).
2. Control de costos / rate-limit en funciones que pegan a Gemini (opción C).
3. Lockear CORS a origen específico.
4. Unificar `chat` con el `_shared` raíz para borrar la última duplicación.
