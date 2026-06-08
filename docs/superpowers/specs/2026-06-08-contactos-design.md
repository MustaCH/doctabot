# Diseño: Agenda de Contactos (generalización de Clientes)

- **Fecha:** 2026-06-08
- **Estado:** Diseño aprobado — pendiente plan de implementación
- **Rama:** `feature/contactos-agenda`

## Contexto y problema

Hoy la app tiene un listado de **Clientes** (tabla `clients`, páginas `Clients.tsx` / `ClientDetail.tsx`, form `ClientFormFields.tsx`). Los agentes de RE/MAX Docta piden poder guardar también **contactos que no son clientes** (conocidos, proveedores, etc.) en el mismo lugar. Además, el listado actual —tarjetas grandes ordenadas por fecha de creación— es pesado y lento de escanear.

## Objetivo

Generalizar "Clientes" a una **Agenda de Contactos** estilo celular:
- Listado liviano, alfabético, fácil de escanear.
- Un contacto puede marcarse como **cliente** (con estado comercial, presupuesto, etc.) o quedar como **contacto común**.
- Refactorizar el listado actual para que sea más usable.

## Alcance (primera versión)

**Incluido:** modelo de datos para distinguir cliente/contacto, listado tipo agenda, perfil con toggle "Es cliente", etiquetas, filtro de matching, ajuste mínimo de las AI tools, naming.

**Fuera de alcance (futuro):** que Alan gestione contactos no-clientes vía chat; renombrar la tabla a `contacts`; importación masiva de contactos (vCard/teléfono); merge de duplicados.

## Decisiones de diseño

### 1. Modelo de datos — *reframe in-place*

Se **mantiene la tabla `clients`** (no se renombra) y se agrega un flag:

```sql
ALTER TABLE clients ADD COLUMN is_client boolean NOT NULL DEFAULT false;
UPDATE clients SET is_client = true;  -- todos los registros actuales son clientes
```

- `is_client = true` → contacto que es cliente: se muestran estado/tipo/presupuesto/zonas y entra al matching.
- `is_client = false` → contacto común: datos básicos + etiquetas + notas.
- Los campos comerciales existentes (`status`, `client_type`, `budget_min/max`, `budget_currency`, `preferred_zones`, `property_type_interest`) **no se modifican**. Siguen con sus defaults/NOT NULL actuales; la UI simplemente los ignora cuando `is_client = false`.

**Alternativa descartada:** renombrar todo a `contacts` (tabla, columnas, las 30 AI tools, edge functions, RLS, `conversations.client_id`, `types.ts`). Limpio en nombre pero de altísimo riesgo y con choque seguro contra Lovable (que regenera/deploya el proyecto). El nombre interno "clients" queda como deuda cosmética invisible para el usuario.

### 2. Distinción cliente vs. contacto

Toggle **"Es cliente"** (campo `is_client`) **+ etiquetas libres** reutilizando el sistema existente `tags` + `client_tags` (con color). Un contacto puede ser cliente y además tener etiquetas (Referido, Proveedor, etc.).

### 3. UI — Listado tipo agenda (opción B validada)

Reescritura de `Clients.tsx`:
- Agrupado **A–Z** por la primera letra del nombre (normalizada, sin acentos).
- Cada fila: **avatar con iniciales** (color determinístico por nombre) + nombre + chips (`Cliente`/`Contacto`, y estado 🔥/☀️/❄️ si es cliente).
- Búsqueda por nombre / teléfono / email.
- Filtros: **Todos / Clientes / Contactos / por estado**.
- Indicador de letra y scroll fluido.

### 4. UI — Perfil con toggle (validado)

Ajuste de `ClientDetail.tsx`:
- Header: avatar grande + nombre + chips.
- Acciones rápidas: Llamar / WhatsApp / Email.
- **Toggle "Es cliente"**: al activarlo se despliega la sección comercial (estado, tipo, presupuesto, zonas), las **propiedades vinculadas** y el **matching** (🎯 compatibles). Al desactivarlo, esas secciones se ocultan.
- Sección **Etiquetas**: agregar/quitar (CRUD sobre `tags`/`client_tags`).
- **Notas** siempre presentes.
- Desactivar "Es cliente" **oculta** la sección comercial pero **conserva** los datos (estado, presupuesto, zonas, vínculos a propiedades); no se borran. Reactivarlo los vuelve a mostrar tal cual estaban.

### 5. Form de creación/edición

`ClientFormFields.tsx`: el toggle `is_client` condiciona **toda** la sección comercial (hoy solo se condicionan los campos de comprador según `client_type`).

### 6. Matching

- `use-property-matches` (fetch de clientes): agregar `.eq("is_client", true)` → un contacto común nunca aparece como match.
- Edge function `morning-matches`: mismo filtro `is_client = true`.

### 7. Asistente Alan (30 tools) — cambio mínimo

- `create_client`: setea `is_client = true` (Alan trabaja con clientes).
- `list_clients` / `get_client`: filtran `is_client = true` → Alan sigue viendo "clientes" como hoy, sin mezclarse con contactos comunes.
- Resto de tools sin cambios.

### 8. Naming y rutas

- Labels "Clientes" → **"Contactos"** en menú y headers.
- Ruta `/clients` se mantiene (no se rompen deep links ni notificaciones); solo cambia el texto visible.

## Cambios por archivo (estimado)

| Archivo | Cambio |
|---|---|
| migración SQL nueva | `is_client` + UPDATE de existentes |
| `src/pages/Clients.tsx` | Reescritura a agenda (A–Z, avatares, chips, filtros) |
| `src/pages/ClientDetail.tsx` | Toggle "Es cliente" + sección etiquetas + reorden |
| `src/components/ClientFormFields.tsx` | Toggle `is_client` condiciona sección comercial |
| `src/lib/contact-avatar.ts` (nuevo) | Iniciales + color determinístico (puro, testeable) |
| `src/hooks/use-property-matches.ts` | Filtro `is_client` en el fetch |
| `supabase/functions/morning-matches/index.ts` | Filtro `is_client` |
| `supabase/functions/chat/_shared/tools/executor.ts` | `create_client` setea `is_client=true`; `list_clients`/`get_client` filtran |
| Navegación / labels | "Clientes" → "Contactos" |

## Migración con Lovable

Una sola migración SQL (la de arriba). Trabajo en la rama `feature/contactos-agenda` → merge a `main` → Nacho deploya a Lovable, que aplica la migración.

## Testing

- `contact-avatar`: iniciales y color determinístico.
- Agrupación A–Z del listado (normalización de acentos, casos borde).
- Filtros del listado (Todos/Clientes/Contactos/estado).
- Filtro `is_client` en el matching (se suma a los tests existentes de `property-matching`).

## Riesgos y mitigaciones

- **Lovable puede regenerar archivos de UI/hook** si se le pide algo que los toque → hacer estos cambios con Claude, no con Lovable.
- **`status`/`client_type` siguen NOT NULL** para contactos no-clientes → quedan con su default y la UI los ignora; no se migran.
- **`conversations.client_id`** sigue apuntando a la misma tabla → sin cambios.
- **Contactos sin `is_client` por error** → el default `false` es seguro (no entran al matching ni a las tools de Alan).
