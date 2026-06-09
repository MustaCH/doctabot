# Edge Functions Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralizar CORS / respuestas / validación de inputs de las edge functions en `_shared/`, cortar el filtrado de errores internos al cliente, y validar inputs — sin romper el contrato con el frontend ni cambiar el modelo de auth.

**Architecture:** Tres módulos puros en `supabase/functions/_shared/` (`cors.ts`, `http.ts`, `validation.ts`) cubiertos por tests de vitest. Cada una de las 9 funciones sueltas importa esos helpers con cambios quirúrgicos (CORS, manejo de error, validación). `chat` queda intacto.

**Tech Stack:** Deno (edge functions), Supabase, vitest (tests de helpers puros), Bun (runner local).

---

## Notas de ejecución (leer antes de empezar)

- **Runner:** `bun run test` (script `test` → `vitest run`).
- **Los `index.ts` NO son unit-testeables** en vitest (importan módulos remotos de Deno y `Deno.env`). Su verificación es: (a) los tests de helpers siguen verdes, (b) revisión del diff contra la receta, (c) smoke manual de Nacho tras redeploy. Esto es esperado y está reflejado en cada tarea de función.
- **Contrato con el front:** se preservan los **shapes de éxito** y los **mensajes de error intencionales** (429/402/401/validación). Solo el `catch` final deja de filtrar el error crudo.
- **Commits:** uno por tarea. Branch ya creada: `hardening-edge-functions`.
- **`Deno.serve` vs `serve`:** algunas funciones usan `Deno.serve`, otras importan `serve` de `std`. No se cambia eso; solo se tocan CORS/errores/validación.

---

## Receta de transformación por función (referencia)

Las tareas de función (5–13) aplican un subconjunto de estos 4 cambios. Cada tarea dice exactamente cuáles:

1. **CORS:** borrar el `const corsHeaders = {...}` inline y, en su lugar, importar desde `../_shared/cors.ts`.
2. **OPTIONS:** reemplazar el bloque `if (req.method === "OPTIONS") ...` por `const pre = handleOptions(req); if (pre) return pre;`.
3. **Validación:** importar validadores + `ValidationError` y validar los inputs propios.
4. **Catch:** reemplazar el `catch` que filtra (`err.message` / `String(err)`) por `errorResponse(safeError(err, "<fn>"), 500)`, con una rama previa `if (err instanceof ValidationError) return errorResponse(err.message, 400);`.

---

## Task 1: Extender el include de vitest a las edge functions

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Editar el `include`**

Reemplazar:
```ts
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
```
por:
```ts
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.{ts,tsx}",
    ],
```

- [ ] **Step 2: Confirmar que la suite existente sigue verde**

Run: `bun run test`
Expected: PASS — los 42 tests existentes siguen pasando (todavía no hay tests nuevos en `supabase/functions/`, así que el conteo no cambia).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: vitest descubre tests en supabase/functions"
```

---

## Task 2: `validation.ts` (helper de validación, TDD)

**Files:**
- Create: `supabase/functions/_shared/validation.ts`
- Test: `supabase/functions/_shared/validation.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `supabase/functions/_shared/validation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  ValidationError,
  requireString,
  optionalString,
  requireUuid,
  requireNonEmptyArray,
} from "./validation";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("requireString", () => {
  it("devuelve el string trimeado", () => {
    expect(requireString("  hola  ", "campo")).toBe("hola");
  });
  it("lanza ValidationError si no es string o está vacío", () => {
    expect(() => requireString(undefined, "campo")).toThrow(ValidationError);
    expect(() => requireString("   ", "campo")).toThrow(ValidationError);
    expect(() => requireString(123, "campo")).toThrow(ValidationError);
  });
  it("lanza si excede maxLength", () => {
    expect(() => requireString("abcdef", "campo", { maxLength: 3 })).toThrow(ValidationError);
  });
});

describe("optionalString", () => {
  it("devuelve null si falta o es vacío", () => {
    expect(optionalString(undefined, "c")).toBeNull();
    expect(optionalString("", "c")).toBeNull();
    expect(optionalString(null, "c")).toBeNull();
  });
  it("valida tipo y largo cuando hay valor", () => {
    expect(optionalString("  x  ", "c")).toBe("x");
    expect(() => optionalString(5, "c")).toThrow(ValidationError);
    expect(() => optionalString("abcdef", "c", { maxLength: 3 })).toThrow(ValidationError);
  });
});

describe("requireUuid", () => {
  it("acepta un uuid válido", () => {
    expect(requireUuid(UUID, "id")).toBe(UUID);
  });
  it("rechaza no-uuid", () => {
    expect(() => requireUuid("nope", "id")).toThrow(ValidationError);
    expect(() => requireUuid(undefined, "id")).toThrow(ValidationError);
  });
});

describe("requireNonEmptyArray", () => {
  it("devuelve el array si tiene elementos", () => {
    expect(requireNonEmptyArray([1, 2], "arr")).toEqual([1, 2]);
  });
  it("rechaza no-array o vacío", () => {
    expect(() => requireNonEmptyArray([], "arr")).toThrow(ValidationError);
    expect(() => requireNonEmptyArray("x", "arr")).toThrow(ValidationError);
  });
  it("rechaza si supera maxItems", () => {
    expect(() => requireNonEmptyArray([1, 2, 3], "arr", { maxItems: 2 })).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test supabase/functions/_shared/validation.test.ts`
Expected: FAIL — `Cannot find module './validation'` (o "ValidationError is not exported").

- [ ] **Step 3: Implementar `validation.ts`**

Create `supabase/functions/_shared/validation.ts`:
```ts
// Helpers de validación de inputs, sin dependencias (testeables en vitest).
// Mismo estilo manual que chat/_shared/tools/validators.ts.

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

export function optionalArray<T = unknown>(
  value: unknown,
  field: string,
  opts: { maxItems?: number } = {},
): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} debe ser una lista`);
  if (opts.maxItems != null && value.length > opts.maxItems) {
    throw new ValidationError(`${field} tiene demasiados elementos`);
  }
  return value as T[];
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test supabase/functions/_shared/validation.test.ts`
Expected: PASS — todos los casos verdes. (Si dice "0 tests found", el `include` de la Task 1 no quedó bien — corregir antes de seguir.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts
git commit -m "feat(hardening): helper de validacion de inputs compartido"
```

---

## Task 3: `cors.ts` (CORS unificado, TDD)

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Test: `supabase/functions/_shared/cors.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `supabase/functions/_shared/cors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { corsHeaders, handleOptions } from "./cors";

describe("corsHeaders", () => {
  it("permite el origen y los headers del cliente supabase", () => {
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("*");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("x-supabase-client-platform");
  });
});

describe("handleOptions", () => {
  it("devuelve una Response para OPTIONS con headers CORS", () => {
    const res = handleOptions(new Request("https://x", { method: "OPTIONS" }));
    expect(res).not.toBeNull();
    expect(res!.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
  it("devuelve null para otros métodos", () => {
    expect(handleOptions(new Request("https://x", { method: "POST" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test supabase/functions/_shared/cors.test.ts`
Expected: FAIL — `Cannot find module './cors'`.

- [ ] **Step 3: Implementar `cors.ts`**

Create `supabase/functions/_shared/cors.ts`:
```ts
// CORS unificado para todas las edge functions.
// La lista de headers es superset de las variantes que había inline.
// Methods es superset (GET/POST/DELETE) para cubrir también las funciones de calendar.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

/** Si el request es preflight (OPTIONS), devuelve la Response; si no, null. */
export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test supabase/functions/_shared/cors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/cors.test.ts
git commit -m "feat(hardening): CORS unificado compartido"
```

---

## Task 4: `http.ts` (respuestas + safeError, TDD)

**Files:**
- Create: `supabase/functions/_shared/http.ts`
- Test: `supabase/functions/_shared/http.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `supabase/functions/_shared/http.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { jsonResponse, errorResponse, safeError } from "./http";

describe("jsonResponse", () => {
  it("setea status, content-type y CORS", async () => {
    const res = jsonResponse({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("errorResponse", () => {
  it("devuelve { error } con el status dado", async () => {
    const res = errorResponse("mal", 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "mal" });
  });
});

describe("safeError", () => {
  it("NO filtra el mensaje real y loguea server-side", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = safeError(new Error("DB password leaked"), "fn-x");
    expect(msg).toBe("Error interno del servidor");
    expect(msg).not.toContain("password");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test supabase/functions/_shared/http.test.ts`
Expected: FAIL — `Cannot find module './http'`.

- [ ] **Step 3: Implementar `http.ts`**

Create `supabase/functions/_shared/http.ts`:
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

/** Loguea el error real server-side y devuelve un mensaje genérico y seguro. */
export function safeError(err: unknown, fn: string): string {
  console.error(`[${fn}]`, err);
  return "Error interno del servidor";
}
```

> Nota: `http.ts` importa `./cors.ts` con extensión `.ts` (requerido por Deno). El resolver de Vite/vitest la resuelve igual. Si vitest fallara al resolverla, cambiar el import del test a `./http` (sin extensión) ya funciona; el problema sería solo el `.ts` interno — en ese caso, confirmar que vitest está en su versión actual (3.x) que sí soporta `.ts` explícito.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test supabase/functions/_shared/http.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/http.ts supabase/functions/_shared/http.test.ts
git commit -m "feat(hardening): helpers de respuesta + safeError"
```

---

## Task 5: `send-push-notification` (CORS + validación + catch)

**Files:**
- Modify: `supabase/functions/send-push-notification/index.ts`

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el bloque (líneas ~4-8):
```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
```
y agregar, debajo del `import { createClient } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { requireString, requireUuid, optionalString, ValidationError } from "../_shared/validation.ts";
```

- [ ] **Step 2: Reemplazar el manejo de OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Validar inputs (después del branch `get_vapid_key`)**

Reemplazar:
```ts
    const { user_id, title, body: pushBody, url } = body;
    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "user_id and title required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
```
por:
```ts
    const user_id = requireUuid(body.user_id, "user_id");
    const title = requireString(body.title, "title", { maxLength: 200 });
    const pushBody = optionalString(body.body, "body", { maxLength: 500 }) ?? "";
    const url = optionalString(body.url, "url", { maxLength: 500 }) ?? "/";
```
> El resto del cuerpo ya usa `pushBody || ""` y `url || "/"`, que siguen funcionando con estos valores.

- [ ] **Step 4: Reemplazar el catch que filtra**

Reemplazar:
```ts
  } catch (err) {
    console.error("send-push-notification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
```
por:
```ts
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400);
    return errorResponse(safeError(err, "send-push-notification"), 500);
  }
```

- [ ] **Step 5: Verificar**

Run: `bun run test`
Expected: PASS (los tests de helpers siguen verdes; nada regresiona).
Revisión manual: el branch `get_vapid_key` sigue ANTES de la validación; los `Response` de éxito siguen usando `corsHeaders` (ahora importado).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-push-notification/index.ts
git commit -m "fix(hardening): send-push usa _shared, valida inputs y no filtra errores"
```

---

## Task 6: `test-webhook` (CORS + validación + catch)

**Files:**
- Modify: `supabase/functions/test-webhook/index.ts`

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~3-6) y agregar bajo el `import { serve } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { requireString, ValidationError } from "../_shared/validation.ts";
```

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Validar el pin**

Reemplazar:
```ts
    const body = await req.json();
    const { pin } = body;
```
por:
```ts
    const body = await req.json();
    const pin = requireString(body.pin, "pin");
```
> La comparación `pin !== ADMIN_PIN` que sigue queda intacta.

- [ ] **Step 4: Reemplazar el catch que filtra**

Reemplazar:
```ts
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
```
por:
```ts
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400);
    return errorResponse(safeError(err, "test-webhook"), 500);
  }
```

- [ ] **Step 5: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: el chequeo de PIN sigue devolviendo 401 con `"Unauthorized"`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/test-webhook/index.ts
git commit -m "fix(hardening): test-webhook valida pin y no filtra errores"
```

---

## Task 7: `parse-client-import` (CORS + validación + catch)

**Files:**
- Modify: `supabase/functions/parse-client-import/index.ts`

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~3-6) y agregar bajo el `import { serve } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { requireNonEmptyArray, optionalArray, ValidationError } from "../_shared/validation.ts";
```

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Validar inputs**

Reemplazar:
```ts
    const { headers, sampleRows } = await req.json();

    if (!headers || !Array.isArray(headers) || headers.length === 0) {
      return new Response(JSON.stringify({ error: "No headers provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
```
por:
```ts
    const parsed = await req.json();
    const headers = requireNonEmptyArray<string>(parsed.headers, "headers", { maxItems: 200 });
    const sampleRows = optionalArray<string[]>(parsed.sampleRows, "sampleRows", { maxItems: 50 });
```
> Más abajo el código usa `sampleRows ?? []`; con `optionalArray` ahora `sampleRows` siempre es un array, así que sigue andando.

- [ ] **Step 4: Reemplazar el catch que filtra (preservando 429/402)**

Los bloques que devuelven 429 ("Demasiadas solicitudes…") y 402 ("Créditos de IA agotados") quedan **intactos**. Solo reemplazar el catch final:
```ts
  } catch (err) {
    console.error("parse-client-import error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
```
por:
```ts
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400);
    return errorResponse(safeError(err, "parse-client-import"), 500);
  }
```

- [ ] **Step 5: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: los mensajes 429/402 siguen presentes; el éxito sigue devolviendo `{ mapping }`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/parse-client-import/index.ts
git commit -m "fix(hardening): parse-client-import valida inputs y no filtra errores"
```

---

## Task 8: `transcribe` (CORS + validación de archivo + catch)

**Files:**
- Modify: `supabase/functions/transcribe/index.ts`

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~4-8) y agregar bajo el `import { createClient } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { ValidationError } from "../_shared/validation.ts";
```

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Validar el archivo (presencia + tamaño)**

Reemplazar:
```ts
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;
    if (!audioFile) throw new Error("No audio file provided");
```
por:
```ts
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) throw new ValidationError("audio es requerido");
    const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB
    if (audioFile.size > MAX_AUDIO_BYTES) {
      throw new ValidationError("el audio supera el tamaño máximo (25 MB)");
    }
```

- [ ] **Step 4: Reemplazar el catch que filtra**

Reemplazar:
```ts
  } catch (e) {
    console.error("transcribe error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
```
por:
```ts
  } catch (e) {
    if (e instanceof ValidationError) return errorResponse(e.message, 400);
    return errorResponse(safeError(e, "transcribe"), 500);
  }
```
> Esto también oculta el `throw new Error("GEMINI_API_KEY not configured")` y el `Transcription failed: <status>`, que hoy se filtran.

- [ ] **Step 5: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: la auth (Bearer) sigue intacta; el éxito sigue devolviendo `{ text }`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/transcribe/index.ts
git commit -m "fix(hardening): transcribe valida audio y no filtra errores"
```

---

## Task 9: `sync-calendar-event` (CORS + validación; ya es leak-free)

**Files:**
- Modify: `supabase/functions/sync-calendar-event/index.ts`

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~4-8) y agregar bajo el `import { createClient } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { requireString, requireUuid, ValidationError } from "../_shared/validation.ts";
```

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Validar inputs del POST**

Reemplazar:
```ts
    const { event_id, title, event_date, recurrence, notes } = await req.json();
    if (!event_id || !title || !event_date) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
```
por:
```ts
    const payload = await req.json();
    const event_id = requireUuid(payload.event_id, "event_id");
    const title = requireString(payload.title, "title", { maxLength: 300 });
    const event_date = requireString(payload.event_date, "event_date", { maxLength: 32 });
    const recurrence = payload.recurrence;
    const notes = payload.notes;
```
> El branch DELETE lee `google_event_id` de su propio `req.json()` más arriba y no se toca.

- [ ] **Step 4: Agregar rama de ValidationError al catch**

Reemplazar:
```ts
  } catch (e) {
    console.error("sync-calendar-event error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
```
por:
```ts
  } catch (e) {
    if (e instanceof ValidationError) return errorResponse(e.message, 400);
    console.error("sync-calendar-event error:", e);
    return errorResponse("Error interno del servidor", 500);
  }
```

- [ ] **Step 5: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: las respuestas `{ synced, ... }` / `{ deleted, ... }` no cambian; la auth sigue intacta.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/sync-calendar-event/index.ts
git commit -m "fix(hardening): sync-calendar-event usa _shared y valida inputs"
```

---

## Task 10: `morning-matches` (CORS + catch; sin input de usuario)

**Files:**
- Modify: `supabase/functions/morning-matches/index.ts`

> `morning-matches` es invocada por cron / internamente y **no lee body**. No requiere validación de inputs. Solo CORS + dejar de filtrar el error.

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~4-7) y agregar bajo el `import { createClient } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
```

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Reemplazar el catch que filtra**

Reemplazar:
```ts
  } catch (err) {
    console.error("morning-matches error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
```
por:
```ts
  } catch (err) {
    return errorResponse(safeError(err, "morning-matches"), 500);
  }
```

- [ ] **Step 4: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: el éxito sigue devolviendo `{ matches }`; las llamadas internas a `send-push-notification` no cambian.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/morning-matches/index.ts
git commit -m "fix(hardening): morning-matches usa _shared y no filtra errores"
```

---

## Task 11: `scrape-properties` (CORS + catch; params internos)

**Files:**
- Modify: `supabase/functions/scrape-properties/index.ts`

> `scrape-properties` se llama desde cron / admin / self-invoke. Sus params (`operationId`, `startPage`, `maxPages`, `batchTimestamp`) ya se parsean defensivamente con `Number()` dentro de un `try/catch`. No agregamos validación dura (rompería el self-invoke). Solo CORS + dejar de filtrar el error.

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~4-7) y agregar bajo el `import { createClient } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
```

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Reemplazar el catch que filtra**

Reemplazar:
```ts
  } catch (e) {
    console.error("❌ Scrape error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
```
por:
```ts
  } catch (e) {
    return errorResponse(safeError(e, "scrape-properties"), 500);
  }
```

- [ ] **Step 4: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: los `Response` de éxito (orchestrator/worker) no cambian; `selfInvoke`, `writeLog`, `runCleanup` quedan intactos.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/scrape-properties/index.ts
git commit -m "fix(hardening): scrape-properties usa _shared y no filtra errores"
```

---

## Task 12: `admin-stats` (CORS + cortar leaks internos)

**Files:**
- Modify: `supabase/functions/admin-stats/index.ts`

> `admin-stats` ya tiene un catch top-level seguro (`"Internal error"`) pero **no loguea**, y varios handlers internos hacen `json({ error: error.message }, 500)` (leak, aunque solo visible para super_admins). Usa `Deno.serve` y un helper `json` local. Tratamiento: CORS compartido, loguear en el catch, y cortar los 4 leaks internos. La auth (PIN + JWT super_admin) NO se toca.

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~3-7) y agregar bajo el `import { createClient } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { safeError } from "../_shared/http.ts";
```
> Se mantiene el helper `json` local (usa `corsHeaders`, ahora importado).

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Cortar los leaks internos de error.message**

Hay 4 ocurrencias de `return json({ error: error.message }, 500);` (en las acciones `time-stats`, `user-reports`, `engagement-report`, `push-delivery-stats`). Reemplazar **cada una** por:
```ts
      if (error) { console.error("[admin-stats]", error); return json({ error: "Error al obtener datos" }, 500); }
```
> Es decir, donde hoy dice `if (error) return json({ error: error.message }, 500);`, cambiarlo por la línea de arriba (loguea el real, devuelve genérico).

- [ ] **Step 4: Loguear en el catch top-level**

Reemplazar:
```ts
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
```
por:
```ts
  } catch (err) {
    return new Response(JSON.stringify({ error: safeError(err, "admin-stats") }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
```

- [ ] **Step 5: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: el chequeo PIN+JWT super_admin no cambió; todas las acciones siguen devolviendo el mismo shape (`{ data, total }`, etc.).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/admin-stats/index.ts
git commit -m "fix(hardening): admin-stats usa CORS compartido y no filtra errores de DB"
```

---

## Task 13: `google-calendar-auth` (solo CORS; ya es leak-free)

**Files:**
- Modify: `supabase/functions/google-calendar-auth/index.ts`

> Esta función NO filtra errores (todas sus respuestas usan strings hardcodeados seguros, y los errores del flujo OAuth redirigen con `?calendar=error`). **No** le agregamos un try/catch global para no romper el redirect del callback GET. Solo unificamos CORS.

- [ ] **Step 1: Reemplazar CORS inline por imports**

Borrar el `const corsHeaders = {...}` (líneas ~4-8) y agregar bajo el `import { createClient } ...`:
```ts
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
```

- [ ] **Step 2: Reemplazar OPTIONS**

Reemplazar:
```ts
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
```
por:
```ts
  const pre = handleOptions(req);
  if (pre) return pre;
```

- [ ] **Step 3: Verificar**

Run: `bun run test`
Expected: PASS. Revisión: los 3 flujos (POST init / GET callback / DELETE) devuelven exactamente lo mismo; el `Access-Control-Allow-Methods` compartido ya incluye GET/POST/DELETE.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/google-calendar-auth/index.ts
git commit -m "fix(hardening): google-calendar-auth usa CORS compartido"
```

---

## Task 14: Verificación final y resumen para deploy

**Files:** (ninguno — verificación)

- [ ] **Step 1: Suite completa verde**

Run: `bun run test`
Expected: PASS — 42 tests previos + los nuevos de `_shared` (validation/cors/http).

- [ ] **Step 2: Confirmar que `chat` quedó intacto**

Run: `git diff --name-only main..hardening-edge-functions`
Expected: NINGÚN archivo bajo `supabase/functions/chat/`. Solo `_shared/`, las 9 funciones, `vitest.config.ts` y los docs.

- [ ] **Step 3: Armar la lista de funciones a redeployar**

Las 9 funciones modificadas que Nacho debe redeployar en Lovable/Supabase:
`admin-stats`, `google-calendar-auth`, `parse-client-import`, `scrape-properties`, `send-push-notification`, `sync-calendar-event`, `transcribe`, `test-webhook`, `morning-matches`.
> El `_shared/` se deploya junto con cada función que lo importa (Supabase incluye los imports relativos al bundlear).

- [ ] **Step 4: Checklist de smoke manual (post-deploy, lo hace Nacho)**

- Subir un archivo en el importador de clientes → mapeo de columnas sigue funcionando.
- Grabar una nota de voz → transcripción OK.
- Push de prueba desde el Super Admin Panel → llega.
- Cualquier input inválido → `400` con mensaje claro (no `500`).

---

## Self-Review (hecho al escribir el plan)

- **Cobertura del spec:** _shared (cors/http/validation) → Tasks 2-4. Regla de errores → en cada función (catch). CORS unificado → cada función. Validación → Tasks 5-9 (las que reciben input de usuario). Testing + include → Tasks 1-4. `chat` intacto → verificado en Task 14. `test-webhook` endurecido no borrado → Task 6. ✅
- **Tratamiento diferenciado (honesto):** funciones leak-free (admin-stats/sync-calendar/google-calendar) no se fuerzan a un patrón que no necesitan; cron/internas (morning-matches/scrape) no reciben validación de inputs inexistentes. Documentado en cada tarea.
- **Sin placeholders:** cada paso tiene el código exacto a buscar y reemplazar.
- **Consistencia de tipos:** `ValidationError`, `requireString/requireUuid/optionalString/requireNonEmptyArray/optionalArray`, `corsHeaders/handleOptions`, `jsonResponse/errorResponse/safeError` se definen en Tasks 2-4 y se usan con esas firmas en 5-13.
- **Follow-ups (NO en este plan):** autorización/ownership, rate-limit/costos, lockear CORS a origen, unificar `chat` con `_shared` raíz.
