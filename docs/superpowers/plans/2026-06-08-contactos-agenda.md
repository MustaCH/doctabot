# Agenda de Contactos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizar el listado de "Clientes" a una "Agenda de Contactos" estilo celular, donde un contacto puede marcarse como cliente (con datos comerciales y matching) o quedar como contacto común.

**Architecture:** *Reframe in-place*: se mantiene la tabla `clients` y se le agrega un flag `is_client`. La lógica pura (avatar, agrupación/filtros de la lista, matching) se extrae a módulos testeables en `src/lib/`. El listado (`Clients.tsx`) se reescribe a agenda A–Z; el perfil (`ClientDetail.tsx`) suma un toggle "Es cliente" + etiquetas. Matching y AI tools filtran por `is_client`.

**Tech Stack:** React 18 + TypeScript + Vite + shadcn/ui + Tailwind · Supabase (Postgres + Deno edge functions) · Vitest.

**Branch:** `feature/contactos-agenda` (ya creada). Spec: `docs/superpowers/specs/2026-06-08-contactos-design.md`.

**Comandos base:**
- Tests de un archivo: `npx vitest run src/lib/<archivo>.test.ts`
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json`
- Lint: `npm run lint`

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20260608120000_add_is_client_to_clients.sql` (crear) | Agrega `is_client` y marca los existentes |
| `src/integrations/supabase/types.ts` (modificar) | Suma `is_client` al tipo de `clients` |
| `src/lib/contact-avatar.ts` (crear) | Iniciales + color determinístico (puro) |
| `src/lib/contact-avatar.test.ts` (crear) | Tests del avatar |
| `src/lib/contact-list.ts` (crear) | Normalización, agrupación A–Z y filtros (puro) |
| `src/lib/contact-list.test.ts` (crear) | Tests de la lista |
| `src/lib/property-matching.ts` (modificar) | Excluir contactos con `is_client = false` |
| `src/lib/property-matching.test.ts` (modificar) | Test del filtro `is_client` |
| `src/hooks/use-property-matches.ts` (modificar) | Filtrar `is_client` en el fetch |
| `supabase/functions/morning-matches/index.ts` (modificar) | Filtrar `is_client` en los queries |
| `supabase/functions/chat/_shared/tools/executor.ts` (modificar) | `create_client` setea `is_client=true`; `list_clients`/`get_client` filtran |
| `src/components/ClientFormFields.tsx` (modificar) | Toggle `is_client` condiciona la sección comercial |
| `src/components/ContactTags.tsx` (crear) | UI de etiquetas (CRUD sobre `tags`/`client_tags`) |
| `src/pages/Clients.tsx` (reescribir) | Agenda A–Z con avatares, chips y filtros |
| `src/pages/ClientDetail.tsx` (modificar) | Toggle "Es cliente" + sección etiquetas |
| `src/pages/Profile.tsx` (modificar) | Label "Clientes" → "Contactos" |
| `src/pages/Dashboard.tsx` (modificar) | Label de la métrica "Clientes" → "Contactos" |

---

## Task 1: Migración `is_client` + tipos

**Files:**
- Create: `supabase/migrations/20260608120000_add_is_client_to_clients.sql`
- Modify: `src/integrations/supabase/types.ts` (tabla `clients`, bloques `Row`/`Insert`/`Update`)

- [ ] **Step 1: Crear la migración**

```sql
-- Generaliza clients a contactos: flag is_client.
-- Los registros existentes son todos clientes, así que se marcan en true.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_client boolean NOT NULL DEFAULT false;

UPDATE public.clients SET is_client = true WHERE is_client = false;

COMMENT ON COLUMN public.clients.is_client IS
  'true = el contacto es cliente (datos comerciales + matching). false = contacto común.';
```

- [ ] **Step 2: Agregar `is_client` a `types.ts`**

En `src/integrations/supabase/types.ts`, dentro de `Tables.clients`, agregar el campo en los tres bloques (respetar orden alfabético del bloque):
- `Row`: `is_client: boolean`
- `Insert`: `is_client?: boolean`
- `Update`: `is_client?: boolean`

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores nuevos relacionados a `is_client`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608120000_add_is_client_to_clients.sql src/integrations/supabase/types.ts
git commit -m "feat(contactos): migracion is_client + tipos"
```

> **Nota:** la migración la aplica Lovable/Supabase al deployar. No se aplica localmente (no hay DB local).

---

## Task 2: Helper de avatar (TDD)

**Files:**
- Create: `src/lib/contact-avatar.ts`
- Test: `src/lib/contact-avatar.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/contact-avatar.test.ts
import { describe, it, expect } from "vitest";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "./contact-avatar";

describe("getInitials", () => {
  it("toma las iniciales de nombre y apellido", () => {
    expect(getInitials("Ana Gómez")).toBe("AG");
  });
  it("usa una sola letra si hay un solo nombre", () => {
    expect(getInitials("Bruno")).toBe("B");
  });
  it("ignora espacios extra y toma las dos primeras palabras", () => {
    expect(getInitials("  María  José  Pérez ")).toBe("MJ");
  });
  it("devuelve '?' si el nombre está vacío", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});

describe("getAvatarColorIndex", () => {
  it("es determinístico para el mismo nombre", () => {
    expect(getAvatarColorIndex("Ana Gómez")).toBe(getAvatarColorIndex("Ana Gómez"));
  });
  it("devuelve un índice dentro de la paleta", () => {
    const idx = getAvatarColorIndex("Carla Díaz");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(AVATAR_COLORS.length);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/contact-avatar.test.ts`
Expected: FAIL — "Failed to resolve import './contact-avatar'".

- [ ] **Step 3: Implementar el helper**

```ts
// src/lib/contact-avatar.ts
/** Paleta de fondos para avatares (clases Tailwind). */
export const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
] as const;

/** Iniciales (1-2 letras) a partir del nombre completo. */
export function getInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Índice de color determinístico (mismo nombre → mismo color). */
export function getAvatarColorIndex(fullName: string): number {
  let hash = 0;
  for (let i = 0; i < fullName.length; i++) {
    hash = (hash * 31 + fullName.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % AVATAR_COLORS.length;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/contact-avatar.test.ts`
Expected: PASS (todos los tests verdes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contact-avatar.ts src/lib/contact-avatar.test.ts
git commit -m "feat(contactos): helper de avatar (iniciales + color)"
```

---

## Task 3: Helpers de la lista — normalización, agrupación A–Z y filtros (TDD)

**Files:**
- Create: `src/lib/contact-list.ts`
- Test: `src/lib/contact-list.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/contact-list.test.ts
import { describe, it, expect } from "vitest";
import { groupLetter, groupContacts, filterContacts, type ContactListItem } from "./contact-list";

function c(partial: Partial<ContactListItem>): ContactListItem {
  return {
    id: "x", full_name: "Sin Nombre", phone: null, email: null,
    is_client: false, status: "warm", client_type: "buyer", ...partial,
  };
}

describe("groupLetter", () => {
  it("devuelve la inicial en mayúscula sin acento", () => {
    expect(groupLetter("Ángela")).toBe("A");
    expect(groupLetter("ñoño")).toBe("N");
  });
  it("agrupa nombres que no empiezan con letra bajo '#'", () => {
    expect(groupLetter("123 Empresa")).toBe("#");
    expect(groupLetter("")).toBe("#");
  });
});

describe("groupContacts", () => {
  it("agrupa por letra y ordena alfabéticamente, con '#' al final", () => {
    const groups = groupContacts([
      c({ id: "1", full_name: "Bruno" }),
      c({ id: "2", full_name: "Ana" }),
      c({ id: "3", full_name: "9 de Julio Inmob" }),
    ]);
    expect(groups.map((g) => g.letter)).toEqual(["A", "B", "#"]);
    expect(groups[0].contacts[0].full_name).toBe("Ana");
  });
});

describe("filterContacts", () => {
  const list = [
    c({ id: "1", full_name: "Ana Gómez", phone: "351111", is_client: true, status: "hot" }),
    c({ id: "2", full_name: "Bruno López", email: "bruno@mail.com", is_client: false }),
  ];
  it("filtra por texto en nombre/teléfono/email", () => {
    expect(filterContacts(list, { query: "gómez", kind: "all", status: "all" })).toHaveLength(1);
    expect(filterContacts(list, { query: "bruno@mail", kind: "all", status: "all" })).toHaveLength(1);
  });
  it("filtra por tipo cliente/contacto", () => {
    expect(filterContacts(list, { query: "", kind: "client", status: "all" })).toHaveLength(1);
    expect(filterContacts(list, { query: "", kind: "contact", status: "all" })).toHaveLength(1);
  });
  it("filtra por estado solo entre clientes", () => {
    expect(filterContacts(list, { query: "", kind: "all", status: "hot" })).toHaveLength(1);
    expect(filterContacts(list, { query: "", kind: "all", status: "cold" })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/contact-list.test.ts`
Expected: FAIL — "Failed to resolve import './contact-list'".

- [ ] **Step 3: Implementar los helpers**

```ts
// src/lib/contact-list.ts
export interface ContactListItem {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_client: boolean;
  status: string;
  client_type: string;
}

export type ContactKind = "all" | "client" | "contact";
export type StatusFilter = "all" | "hot" | "warm" | "cold";

export interface ContactFilters {
  query: string;
  kind: ContactKind;
  status: StatusFilter;
}

export interface ContactGroup {
  letter: string;
  contacts: ContactListItem[];
}

/** Quita acentos para normalizar comparaciones/agrupación. */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Letra de agrupación: inicial sin acento en mayúscula, o '#' si no es A-Z. */
export function groupLetter(fullName: string): string {
  const first = stripAccents(fullName.trim()).charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

/** Agrupa contactos por letra inicial, ordenados A-Z con '#' al final. */
export function groupContacts(contacts: ContactListItem[]): ContactGroup[] {
  const map = new Map<string, ContactListItem[]>();
  for (const c of contacts) {
    const letter = groupLetter(c.full_name);
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(c);
  }
  const letters = [...map.keys()].sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b, "es");
  });
  return letters.map((letter) => ({
    letter,
    contacts: map.get(letter)!.sort((a, b) => a.full_name.localeCompare(b.full_name, "es")),
  }));
}

/** Filtra por texto (nombre/teléfono/email), tipo y estado. */
export function filterContacts(contacts: ContactListItem[], f: ContactFilters): ContactListItem[] {
  let result = contacts;
  if (f.kind === "client") result = result.filter((c) => c.is_client);
  else if (f.kind === "contact") result = result.filter((c) => !c.is_client);

  if (f.status !== "all") result = result.filter((c) => c.is_client && c.status === f.status);

  const q = stripAccents(f.query.trim().toLowerCase());
  if (q) {
    result = result.filter((c) =>
      stripAccents(c.full_name.toLowerCase()).includes(q) ||
      (c.phone?.toLowerCase().includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    );
  }
  return result;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/contact-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contact-list.ts src/lib/contact-list.test.ts
git commit -m "feat(contactos): helpers de agrupacion A-Z y filtros"
```

---

## Task 4: Excluir no-clientes del matching (TDD)

**Files:**
- Modify: `src/lib/property-matching.ts` (interface `ClientForMatch`; función `computeMatchReasons`)
- Test: `src/lib/property-matching.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final del `describe("findPropertyMatches", ...)` en `src/lib/property-matching.test.ts`:

```ts
  it("nunca matchea un contacto que no es cliente (is_client=false)", () => {
    const property = makeProperty({
      zone: "Nueva Córdoba",
      property_type: "departamento",
      price: 95000,
      currency: "USD",
    });
    const contacto = makeClient({
      is_client: false,
      preferred_zones: "Nueva Córdoba",
      property_type_interest: "departamento",
      budget_max: 100000,
    });
    expect(findPropertyMatches(property, [contacto])).toHaveLength(0);
  });
```

Y en el helper `makeClient` del mismo archivo, agregar el campo por defecto `is_client: true,` (para que los demás tests, que asumen clientes, sigan pasando).

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/property-matching.test.ts`
Expected: FAIL — el contacto matchea (`is_client` aún no existe en el tipo ni se chequea), o error de tipo por `is_client`.

- [ ] **Step 3: Implementar**

En `src/lib/property-matching.ts`:

1. En `interface ClientForMatch`, agregar el campo:
```ts
  is_client: boolean;
```
2. Al inicio de `computeMatchReasons`, junto al check de seller:
```ts
  // Solo los contactos marcados como cliente entran al matching.
  if (!client.is_client) return null;
  if (client.client_type === "seller") return null;
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/property-matching.test.ts`
Expected: PASS (los 28 previos + el nuevo = 29).

- [ ] **Step 5: Commit**

```bash
git add src/lib/property-matching.ts src/lib/property-matching.test.ts
git commit -m "feat(contactos): el matching excluye contactos no-cliente"
```

---

## Task 5: Filtrar `is_client` en el fetch del hook de matching

**Files:**
- Modify: `src/hooks/use-property-matches.ts`

- [ ] **Step 1: Ajustar el query y el tipo**

En el `.select(...)` agregar `is_client` a la lista de columnas, y sumar el filtro `.eq("is_client", true)`:

```ts
const { data: clients, error } = await supabase
  .from("clients")
  .select(
    "id, full_name, phone, email, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, status, client_type, notes, last_contact_at, is_client"
  )
  .eq("user_id", user.id)
  .eq("is_client", true);
```

- [ ] **Step 2: Verificar typecheck y tests**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx vitest run`
Expected: sin errores; 29 tests verdes.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-property-matches.ts
git commit -m "feat(contactos): hook de matching solo trae clientes"
```

---

## Task 6: Filtrar `is_client` en `morning-matches`

**Files:**
- Modify: `supabase/functions/morning-matches/index.ts`

- [ ] **Step 1: Agregar el filtro a cada query de `clients`**

Hay cuatro queries `from("clients")` (buyers/sellers). A CADA uno agregarle `.eq("is_client", true)`:

- El query de "users que tienen clientes" (`.select("user_id").neq("client_type", "seller")`) → agregar `.eq("is_client", true)`.
- El query de buyers/both del usuario (`.neq("client_type", "seller")`) → agregar `.eq("is_client", true)`.
- El query de sellers (`.eq("client_type", "seller")`) → agregar `.eq("is_client", true)`.
- El query de buyers para cross-matching (`.neq("client_type", "seller")`) → agregar `.eq("is_client", true)`.

Ejemplo del cambio:
```ts
const { data: clients } = await admin
  .from("clients")
  .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes")
  .eq("user_id", userId)
  .eq("is_client", true)        // <-- agregado
  .neq("client_type", "seller");
```

- [ ] **Step 2: Verificar (revisión manual)**

No hay test unitario de la edge function (corre en Deno). Verificar con `git diff supabase/functions/morning-matches/index.ts` que los 4 queries `from("clients")` tienen `.eq("is_client", true)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/morning-matches/index.ts
git commit -m "feat(contactos): morning-matches solo considera clientes"
```

---

## Task 7: AI tools — `create_client` setea `is_client`, `list_clients`/`get_client` filtran

**Files:**
- Modify: `supabase/functions/chat/_shared/tools/executor.ts`

- [ ] **Step 1: `create_client` inserta `is_client: true`**

En el `case "create_client"`, en el objeto del `.insert({...})`, agregar `is_client: true`:
```ts
.insert({ user_id: userId, full_name, phone, email, notes, status, client_type, birthday, company, address, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, source, is_client: true })
```

- [ ] **Step 2: `list_clients` filtra `is_client`**

En el `case "list_clients"`, después de `.eq("user_id", userId)`, agregar:
```ts
.eq("is_client", true)
```

- [ ] **Step 3: `get_client` filtra `is_client`**

En el `case "get_client"`, en el query principal de `clients`, después de `.eq("user_id", userId)`, agregar:
```ts
.eq("is_client", true)
```

- [ ] **Step 4: Verificar (revisión manual)**

Revisar con `git diff` que los tres cambios están aplicados. (Las edge functions corren en Deno; no hay test unitario local.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/chat/_shared/tools/executor.ts
git commit -m "feat(contactos): Alan crea/lista solo clientes (is_client)"
```

---

## Task 8: `ClientFormFields` — toggle "Es cliente" condiciona la sección comercial

**Files:**
- Modify: `src/components/ClientFormFields.tsx`

- [ ] **Step 1: Agregar `is_client` al form**

1. En `interface ClientFormData`, agregar `is_client: boolean;`.
2. En `emptyClientForm`, agregar `is_client: false,`.

- [ ] **Step 2: Agregar el toggle y condicionar la sección comercial**

1. Importar el switch: `import { Switch } from "@/components/ui/switch";`.
2. Reemplazar la condición `showBuyerFields` para que dependa de `is_client`:
```ts
const showBuyerFields = form.is_client && (form.client_type === "buyer" || form.client_type === "both");
```
3. Antes del bloque `{/* Type & Status */}`, insertar el toggle:
```tsx
<Separator />
<div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
  <div>
    <p className="text-sm font-semibold">Es cliente</p>
    <p className="text-xs text-muted-foreground">Activá para registrar datos comerciales y matching</p>
  </div>
  <Switch checked={form.is_client} onCheckedChange={(v) => set("is_client", v)} />
</div>
```
   > `set` es `(key, value)` y hoy tipa `value: string`. Cambiar su firma a aceptar boolean:
   ```ts
   const set = (key: keyof ClientFormData, value: string | boolean) =>
     onChange({ ...form, [key]: value });
   ```
4. Envolver el bloque `{/* Type & Status */}` (Tipo/Estado) para que **solo se muestre si `form.is_client`**. El selector de "Fuente" puede quedar siempre visible (es útil para cualquier contacto); Tipo y Estado van dentro del `is_client`.

```tsx
{form.is_client && (
  <>
    <SectionTitle>Tipo y estado</SectionTitle>
    {/* ... grid de Tipo y Estado (sin el de Fuente) ... */}
  </>
)}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/ClientFormFields.tsx
git commit -m "feat(contactos): toggle Es cliente en el formulario"
```

> **Nota:** actualizar también los `formToDb` que arman el insert/update (ver Task 10 y Task 11): deben incluir `is_client: form.is_client`.

---

## Task 9: Componente `ContactTags` (etiquetas)

**Files:**
- Create: `src/components/ContactTags.tsx`

- [ ] **Step 1: Implementar el componente**

CRUD de etiquetas sobre las tablas existentes `tags` (id, user_id, name, color) y `client_tags` (client_id, tag_id). Permite asignar etiquetas existentes del usuario y crear nuevas.

```tsx
// src/components/ContactTags.tsx
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

interface Tag { id: string; name: string; color: string; }

export default function ContactTags({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [assigned, setAssigned] = useState<Tag[]>([]);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: tags }, { data: links }] = await Promise.all([
      supabase.from("tags").select("id, name, color").eq("user_id", user.id),
      supabase.from("client_tags").select("tag_id").eq("client_id", clientId),
    ]);
    setAllTags((tags as Tag[]) ?? []);
    const ids = new Set((links ?? []).map((l) => l.tag_id));
    setAssigned(((tags as Tag[]) ?? []).filter((t) => ids.has(t.id)));
  }, [user, clientId]);

  useEffect(() => { load(); }, [load]);

  const assign = async (tag: Tag) => {
    const { error } = await supabase.from("client_tags").insert({ client_id: clientId, tag_id: tag.id });
    if (error) { toast.error("No se pudo agregar la etiqueta"); return; }
    load();
  };

  const unassign = async (tag: Tag) => {
    await supabase.from("client_tags").delete().match({ client_id: clientId, tag_id: tag.id });
    load();
  };

  const createAndAssign = async () => {
    if (!user || !newName.trim()) return;
    const { data, error } = await supabase
      .from("tags")
      .insert({ user_id: user.id, name: newName.trim().slice(0, 40), color: "#3b82f6" })
      .select("id, name, color")
      .single();
    if (error || !data) { toast.error("No se pudo crear la etiqueta"); return; }
    setNewName("");
    await assign(data as Tag);
  };

  const unassignedTags = allTags.filter((t) => !assigned.some((a) => a.id === t.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
          {t.name}
          <button onClick={() => unassign(t)} className="opacity-80 hover:opacity-100"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]"><Plus className="h-3 w-3" /> Etiqueta</Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2" align="start">
          {unassignedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {unassignedTags.map((t) => (
                <button key={t.id} onClick={() => assign(t)} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nueva etiqueta" className="h-7 text-xs" maxLength={40} onKeyDown={(e) => { if (e.key === "Enter") createAndAssign(); }} />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={createAndAssign} disabled={!newName.trim()}>Crear</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/ContactTags.tsx
git commit -m "feat(contactos): componente de etiquetas (ContactTags)"
```

---

## Task 10: Reescribir el listado a agenda (`Clients.tsx`)

**Files:**
- Modify (reescritura): `src/pages/Clients.tsx`

- [ ] **Step 1: Reemplazar el contenido del archivo**

Usa los helpers de Task 2 y 3. Trae `is_client` en el select, agrupa A–Z, muestra avatar + nombre + chips, y agrega filtros Todos/Clientes/Contactos.

```tsx
// src/pages/Clients.tsx
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Users, Plus, Upload, Search, X } from "lucide-react";
import { toast } from "sonner";
import ImportClientsDialog from "@/components/ImportClientsDialog";
import ClientFormFields, { ClientFormData, emptyClientForm } from "@/components/ClientFormFields";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "@/lib/contact-avatar";
import { groupContacts, filterContacts, type ContactListItem, type ContactKind, type StatusFilter } from "@/lib/contact-list";

const statusChip: Record<string, { label: string; cls: string }> = {
  hot: { label: "🔥", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  warm: { label: "☀️", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  cold: { label: "❄️", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

const formToDb = (form: ClientFormData) => ({
  full_name: form.full_name.trim(),
  phone: form.phone.trim() || null,
  email: form.email.trim() || null,
  notes: form.notes.trim() || null,
  status: form.status,
  client_type: form.client_type,
  birthday: form.birthday || null,
  company: form.company.trim() || null,
  address: form.address.trim() || null,
  preferred_zones: form.preferred_zones.trim() || null,
  budget_min: form.budget_min ? Number(form.budget_min) : null,
  budget_max: form.budget_max ? Number(form.budget_max) : null,
  budget_currency: form.budget_currency || "USD",
  property_type_interest: form.property_type_interest.trim() || null,
  source: form.source || null,
  is_client: form.is_client,
});

const Clients = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<ContactKind>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ClientFormData>(emptyClientForm);
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadContacts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, phone, email, is_client, status, client_type")
        .eq("user_id", user.id);
      if (error) throw error;
      setContacts((data as ContactListItem[]) ?? []);
    } catch {
      toast.error("Error al cargar los contactos");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const { pullDistance, refreshing } = usePullToRefresh({ onRefresh: loadContacts, scrollRef });

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const groups = useMemo(
    () => groupContacts(filterContacts(contacts, { query: searchQuery, kind, status })),
    [contacts, searchQuery, kind, status]
  );
  const totalFiltered = useMemo(() => groups.reduce((n, g) => n + g.contacts.length, 0), [groups]);

  const handleCreate = async () => {
    if (!user) return;
    if (!createForm.full_name.trim()) { toast.error("El nombre no puede estar vacío"); return; }
    setCreating(true);
    try {
      const { error } = await supabase.from("clients").insert({ ...formToDb(createForm), user_id: user.id });
      if (error) throw error;
      toast.success("Contacto creado");
      setShowCreate(false);
      setCreateForm(emptyClientForm);
      loadContacts();
    } catch {
      toast.error("Error al crear el contacto");
    } finally {
      setCreating(false);
    }
  };

  const filterButtons: { key: ContactKind; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "client", label: "Clientes" },
    { key: "contact", label: "Contactos" },
  ];

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Users className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Contactos</p>
          <p className="text-xs text-muted-foreground">
            {loading ? "Cargando..." : `${totalFiltered} contacto${totalFiltered !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={() => setShowImport(true)} title="Importar desde Excel/CSV">
            <Upload className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="default" className="h-8 w-8 rounded-full" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="border-b border-border bg-card/50 px-4 py-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre, teléfono o email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 pl-9 text-sm bg-background" />
          {searchQuery && (
            <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6" onClick={() => setSearchQuery("")}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {filterButtons.map((fb) => (
            <Button key={fb.key} size="sm" variant={kind === fb.key ? "default" : "ghost"} className="h-7 text-xs px-3 shrink-0" onClick={() => setKind(fb.key)}>
              {fb.label}
            </Button>
          ))}
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-7 rounded-md border border-border bg-background px-2 text-xs">
            <option value="all">Estado: todos</option>
            <option value="hot">🔥 Caliente</option>
            <option value="warm">☀️ Tibio</option>
            <option value="cold">❄️ Frío</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-4 w-1/2" /></div>
            ))}
          </div>
        ) : totalFiltered === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center px-4">
            <Users className="h-14 w-14 text-muted-foreground/30" />
            <p className="text-base font-medium text-muted-foreground">No hay contactos para mostrar</p>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>Agregar contacto</Button>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.letter}>
              <div className="sticky top-0 bg-muted/80 px-4 py-1 text-xs font-bold text-primary backdrop-blur">{group.letter}</div>
              {group.contacts.map((c) => (
                <button key={c.id} onClick={() => navigate(`/clients/${c.id}`)} className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left hover:bg-muted/40">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_COLORS[getAvatarColorIndex(c.full_name)]}`}>
                    {getInitials(c.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.full_name}</p>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={`rounded-full px-1.5 text-[10px] font-medium ${c.is_client ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-muted text-muted-foreground"}`}>
                        {c.is_client ? "Cliente" : "Contacto"}
                      </span>
                      {c.is_client && statusChip[c.status] && (
                        <span className={`rounded-full px-1.5 text-[10px] font-medium ${statusChip[c.status].cls}`}>{statusChip[c.status].label}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-2"><DialogTitle>Nuevo contacto</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-2 min-h-0">
            <ClientFormFields form={createForm} onChange={setCreateForm} showPlaceholders />
          </div>
          <DialogFooter className="px-5 pb-5 pt-3 border-t border-border/40 gap-2 flex-col sm:flex-col">
            <Button className="w-full" onClick={handleCreate} disabled={creating}>{creating ? "Creando..." : "Crear contacto"}</Button>
            <Button variant="outline" className="w-full" onClick={() => setShowCreate(false)} disabled={creating}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {user && <ImportClientsDialog open={showImport} onOpenChange={setShowImport} userId={user.id} onImported={loadContacts} />}
    </div>
  );
};

export default Clients;
```

> **Nota import:** `ImportClientsDialog` inserta filas en `clients`. Para que los importados sean clientes, en una pasada posterior verificar que su insert incluya `is_client: true` (fuera de alcance si no aplica; documentarlo).

- [ ] **Step 2: Verificar typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint`
Expected: sin errores.

- [ ] **Step 3: Verificación visual**

Run: `npm run dev` → abrir `/clients`. Confirmar: agrupación A–Z, avatares con color, chips Cliente/Contacto + estado, filtros y búsqueda funcionando.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients.tsx
git commit -m "feat(contactos): listado tipo agenda (A-Z, avatares, filtros)"
```

---

## Task 11: Perfil — toggle "Es cliente" + etiquetas (`ClientDetail.tsx`)

**Files:**
- Modify: `src/pages/ClientDetail.tsx`

- [ ] **Step 1: Traer `is_client` en el tipo y el estado**

1. En `interface Client`, agregar `is_client: boolean;`.
2. En `clientToForm`, agregar `is_client: c.is_client,`.
3. En `formToDb` (dentro de `ClientDetail.tsx`), agregar `is_client: form.is_client,`.

- [ ] **Step 2: Toggle "Es cliente" en el header**

Importar `Switch` (`import { Switch } from "@/components/ui/switch";`) y `ContactTags` (`import ContactTags from "@/components/ContactTags";`).

Agregar, debajo del bloque de chips del header (después del `</div>` que cierra los chips de estado/tipo), un control para alternar `is_client` que persiste el cambio:
```tsx
<div className="flex items-center gap-2 px-4 pb-2">
  <span className="text-xs font-medium">Es cliente</span>
  <Switch
    checked={client.is_client}
    onCheckedChange={async (v) => {
      await supabase.from("clients").update({ is_client: v }).eq("id", client.id);
      loadClient();
    }}
  />
</div>
```

- [ ] **Step 3: Condicionar la sección comercial por `is_client`**

En el bloque de "Búsqueda" (preferencias) dentro del `<details>`, envolver para que solo se muestre si `client.is_client`:
```tsx
{client.is_client && (client.preferred_zones || budget || client.property_type_interest) && (
  /* ... bloque de preferencias existente ... */
)}
```
Y en el header, mostrar el chip de estado/tipo **solo si** `client.is_client` (envolver los `<span>` de status/clientType con `{client.is_client && (...)}`).

- [ ] **Step 4: Sección de etiquetas**

Dentro del `<details>` de "Información del cliente", al final del contenido, agregar:
```tsx
<div className="pt-1">
  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Etiquetas</p>
  <ContactTags clientId={client.id} />
</div>
```

- [ ] **Step 5: Verificar typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint`
Expected: sin errores.

- [ ] **Step 6: Verificación visual**

Run: `npm run dev` → abrir un contacto. Confirmar: toggle alterna cliente/contacto y persiste; al apagarlo se ocultan estado/preferencias; etiquetas se agregan/quitan.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ClientDetail.tsx
git commit -m "feat(contactos): perfil con toggle Es cliente + etiquetas"
```

---

## Task 12: Naming "Clientes" → "Contactos"

**Files:**
- Modify: `src/pages/Profile.tsx` (línea ~218, label del nav)
- Modify: `src/pages/Dashboard.tsx` (label de la métrica)

- [ ] **Step 1: Profile.tsx**

Cambiar el texto del item de navegación de `Clientes` a `Contactos` (la ruta `/clients` se mantiene).

- [ ] **Step 2: Dashboard.tsx**

Buscar el texto "Clientes" en `src/pages/Dashboard.tsx` (label de la métrica/tarjetas) y cambiarlo a "Contactos".

- [ ] **Step 3: Verificar typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Profile.tsx src/pages/Dashboard.tsx
git commit -m "feat(contactos): renombrar labels a Contactos"
```

---

## Cierre

- [ ] **Verificación final**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint`
Expected: todos los tests verdes, sin errores de tipos ni lint.

- [ ] **Recordatorios para el deploy (los hace Nacho)**
  - Deployar a Lovable para que aplique la migración `is_client`.
  - Redeploy de las edge functions `morning-matches` y `chat` (executor) para que tomen el filtro `is_client`.
