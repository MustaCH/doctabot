# design-system.md

**Proyecto:** doctabot — asistente IA "Alan" (RE/MAX Docta)
**Dueño:** /ui-designer
**Última actualización:** 2026-06-17
**Stack visual:** Tailwind **v3** + shadcn/ui · tokens en HSL CSS vars (`src/index.css`) · fuente **DM Sans**

> ⚠️ Este proyecto usa Tailwind **v3** (config en `tailwind.config.ts`, vars HSL al estilo shadcn).
> NO usar sintaxis v4 (`@theme`). La fuente de verdad de los tokens base es `src/index.css`; este doc
> los referencia y agrega lo que falta. La skill `design-tokens-tailwind` (output v4) **no aplica** acá.

---

## 1. Fundaciones (existentes — fuente: `src/index.css`)

Tokens core ya implementados. No los redefino; los tabulo para referencia. Editarlos = editar `index.css`.

| Token | Light (HSL) | Rol |
|---|---|---|
| `--background` / `--foreground` | `210 20% 98%` / `220 20% 10%` | fondo / texto |
| `--card` | `0 0% 100%` | superficies (diálogos, cards) |
| `--primary` | `210 100% 45%` | **azul RE/MAX** — acción primaria, foco |
| `--secondary` | `210 15% 93%` | superficies suaves, segmented inactivo |
| `--muted` / `--muted-foreground` | `210 15% 95%` / `215 12% 50%` | atenuado, texto secundario |
| `--accent` / `--destructive` | `0 75% 55%` / `0 84% 60%` | **rojo RE/MAX** / destructivo |
| `--border` / `--input` / `--ring` | `214 20% 90%` / … / `210 100% 45%` | bordes / foco |
| `--radius` | `0.75rem` | radio base (`lg`); `md`=−2px, `sm`=−4px |

- **Tipografía:** DM Sans (300–700). Escala: el código usa `text-[10px]`/`text-xs`/`text-sm`/`text-lg`.
- **Dark mode:** `.dark` con su set espejo (ya definido en `index.css`).

### Colores de dominio ocupados (restricción de diseño)

Los **estados de cliente (pipeline)** ya reservan hues — NO reutilizarlos para otra semántica:

| Estado cliente | Color | Token actual (ad-hoc) |
|---|---|---|
| `hot` 🔥 | **rojo** | `bg-red-100 text-red-700` / dark `red-900/30 red-400` |
| `warm` ☀️ | **ámbar** | `bg-amber-100 text-amber-700` / dark `amber-900/30 amber-400` |
| `cold` ❄️ | **azul** | `bg-blue-100 text-blue-700` / dark `blue-900/30 blue-400` |

> El rojo está sobrecargado (marca + `destructive` + `hot` + badge "Vendedor"). Regla: **rojo solo para
> destructivo/fallo real**, nunca para "atención leve".

---

## 2. Tokens semánticos de estado (NUEVO — agregar a `index.css`)

Hoy los estados de éxito/aviso/info se resuelven con colores crudos sueltos (`emerald-500`,
`text-orange-500`, `blue-100`) en ≥9 archivos → inconsistente. Se promueven a tokens reutilizables.
Contraste verificado **AA** (texto sobre su bg suave).

```css
/* src/index.css → dentro de :root */
--success: 142 72% 29%;          /* verde — texto/icono sobre bg claro */
--success-foreground: 0 0% 100%;
--success-soft: 142 60% 94%;     /* fondo suave del chip */

--warning: 35 92% 38%;           /* ámbar oscuro — atención no destructiva */
--warning-foreground: 0 0% 100%;
--warning-soft: 40 96% 92%;

--info: 210 100% 45%;            /* = primary (azul RE/MAX), alias semántico */
--info-soft: 210 100% 95%;

/* .dark → set espejo (sigue el patrón -900/30 + -400 ya usado en statusChip) */
```

```css
/* .dark */
--success: 142 65% 45%;  --success-soft: 142 40% 14%;
--warning: 40 90% 55%;   --warning-soft: 40 50% 14%;
--info: 210 100% 55%;    --info-soft: 210 60% 14%;
```

```ts
// tailwind.config.ts → theme.extend.colors
success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))", soft: "hsl(var(--success-soft))" },
warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))", soft: "hsl(var(--warning-soft))" },
info:    { DEFAULT: "hsl(var(--info))", soft: "hsl(var(--info-soft))" },
```

> Implementación: la pega Frontend (es código). Documentado acá **antes** de avisar a Frontend, según
> convención. Una vez en el sistema, conviene migrar los `emerald/orange` crudos a estos tokens (deuda → /pm).

### Decisión clave: resolución del conflicto de hues en el preview de import

Los 3 estados de fila del import (`nuevo` / `duplicado` / `sin nombre`) **no** mapean 1:1 a
success/warning/error, porque ámbar y rojo ya son dominio de cliente. Se separan por **tratamiento**:

| Estado fila | Color | Por qué |
|---|---|---|
| ✅ **Nuevo** | `success` (verde) | verde está libre; es el estado esperado, va suave (no grita) |
| ⏭️ **Duplicado (omitido)** | **`muted` / neutral gris** | NO es un warning: es una omisión **intencional**. Gris = "excluido/inactivo", coincide con la fila atenuada. Esquiva el choque con `warm` (ámbar) |
| ⚠️ **Sin nombre (no importable)** | `warning` (ámbar oscuro) | único que pide atención; ámbar-oscuro ≠ ámbar-warm del chip de cliente (distinto tono + distinto contexto/columna) |
| ❌ **Fallido** (solo Pantalla Resultado) | `destructive` (rojo) | ahí SÍ es fallo real y no hay chips de cliente en pantalla → sin colisión |

---

## 3. Componentes — spec visual del Flow 3 (Importar contactos)

Referencia estructural: [flows.md](./flows.md) § "Flow 3". Diálogo base ya existe
(`src/components/ImportClientsDialog.tsx`): `Dialog` shadcn `sm:max-w-2xl max-h-[85vh] flex flex-col`.
No rediseño el contenedor; visto el contenido. Todos los estados especificados.

### 3.1 Step indicator (header)

- Posición: a la derecha del `DialogTitle`, misma fila. `text-xs text-muted-foreground tabular-nums`.
- Texto: `Paso 1/2` · `Paso 2/2`. En transitorios (Analizando / Importando) se oculta.
- Sin barra de pasos pesada: 2 pasos no la justifican (minimalismo, jerarquía al contenido).

### 3.2 Dropzone (Pantalla 1)

Contenedor: `rounded-2xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer`.

| Estado | Borde | Fondo | Icono | Texto |
|---|---|---|---|---|
| Default | `border-border` | — | `Upload` `text-muted-foreground/40` | "Arrastrá tu archivo acá o hacé clic" + restricciones `text-xs text-muted-foreground` |
| Hover | `border-primary/50` | — | idem | idem |
| **Drag-over** | `border-primary` | `bg-primary/5` | `text-primary` | idem (feedback de que va a soltar) |
| Error | `border-destructive/50` | `bg-destructive/5` | `AlertTriangle text-destructive` | mensaje inline `text-sm text-destructive` (ej: "Ese archivo es .pdf, necesito CSV/XLSX/XLS") |
| Cargando | `border-border` | — | `Loader2 animate-spin text-primary` | "Leyendo archivo…" |

- Link debajo: `Descargá la plantilla de ejemplo` → `text-sm text-primary hover:underline underline-offset-2`.
- **Frontend:** la dropzone debe implementar `onDragOver/onDragLeave/onDrop` (hoy promete drag&drop que no existe).

### 3.3 Segmented control "Importar como" (Pantalla 2 / hub)

Patrón segmented (shadcn `ToggleGroup` o tabs):
- Contenedor: `inline-flex rounded-lg bg-muted p-1 gap-1`.
- Segmento activo: `bg-card text-foreground shadow-sm` · inactivo: `text-muted-foreground`.
- Opciones: `Contactos` (default) | `Clientes`.
- Al elegir **Clientes** → revelar (disclosure) un `Select` "Estado:" con las MISMAS opciones/emojis del
  sistema (`🔥 Caliente` / `☀️ Tibio` / `❄️ Frío`), **default `❄️ Frío` (cold)**. Animar con fade/height.
- Jerarquía: este es el control **más fuerte** de la pantalla → va arriba de todo, con label claro.

### 3.4 Editor de mapeo "Columnas detectadas"

Card: `rounded-lg border bg-card p-3 space-y-2`. Cada fila de campo:
- `[icono] Label  →  [ Select de columna ▼ ]`. Icono+label `text-sm`, ancho fijo; Select a la derecha.
- Opciones del Select: las columnas del archivo + `— sin asignar`.
- Campo **Nombre sin mapear** (requerido): Select con `border-warning` + helper `text-xs text-warning`
  "Elegí qué columna tiene el nombre". Bloquea el CTA.
- Cambiar un mapeo **re-aplica en vivo** la tabla y el resumen (es comportamiento; nota para Frontend).
- "+N columnas → a notas" como chip `outline` con link `[ ver ]`.

### 3.5 Resumen (3 contadores) — el "héroe de confianza"

Es lo segundo que mira el usuario desconfiado. Layout: fila en `sm+`, apilado en mobile. Cada item =
chip suave `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium`:

| Item | Clases | Acción inline |
|---|---|---|
| ✅ N nuevos | `bg-success-soft text-success` + `CheckCircle` | — |
| ⏭️ N ya existen (excluidos) | `bg-muted text-muted-foreground` + `SkipForward` | `[ Incluir igual ]` `text-primary` |
| ⚠️ N sin nombre | `bg-warning-soft text-warning` + `AlertTriangle` | `[ ver ]` (scroll a esas filas) |

- Si un contador es 0 → no se muestra ese chip (no ruido).

### 3.6 Tabla de preview

- Header sticky `text-xs text-muted-foreground`; container `rounded-lg border max-h-[40vh] overflow-y-auto`.
- Columnas: `☐` (incluir) · `#` · Nombre · Tipo · Tel · **Estado**.
- Columna **Estado** = icono + label con el color de §2 (nuevo=success, dup=muted, sin-nombre=warning).
- **Filas con problema primero** (dup / sin-nombre arriba) → el usuario las ve sin scrollear.
- Fila excluida (checkbox off): `opacity-50`. Fila sin-nombre: no se puede incluir (checkbox disabled).
- Badge "Tipo" (Comp/Vend/Ambos): mantener el actual, pero **sacar `variant="destructive"` de Vendedor**
  (rojo) → usar `secondary`/`outline`, para no sumar otro rojo que compite con el estado de fila.
- **Responsive (mobile):** en `< sm` la tabla colapsa a lista de filas-card: línea 1 = `☐ Nombre` +
  chip de Estado a la derecha; línea 2 = Tipo · Tel en `text-xs text-muted-foreground`. Nada de scroll
  horizontal en celular (los agentes importan desde el teléfono).

### 3.7 Barra de progreso (Pantalla 4)

- `Progress` shadcn, fill `bg-primary`, track `bg-muted`, `h-2 rounded-full`.
- Label encima `text-sm`: "Importando contactos… **137/248**" (`tabular-nums`).
- Bloquear cierre del diálogo a mitad → si intenta cerrar, confirmar (nota Frontend).

### 3.8 Pantalla Resultado (5)

- Icono héroe: `CheckCircle h-12 w-12 text-success`. Título `text-lg font-semibold` "245 contactos importados".
- Desglose en líneas, **separando omitido de fallido**:
  - `⏭️ 12 omitidos (ya existían)` → `text-muted-foreground` + `SkipForward`.
  - `❌ 3 no se pudieron importar` → `text-destructive` + `AlertTriangle`, con sub-líneas agrupadas por
    causa (`text-xs`): "Teléfono con formato inválido (×2)", "Fecha de cumpleaños inválida (×1)".
- Botones: `[ Reintentar fallidos ]` (`variant="outline"`, **solo si fallidos > 0**) + `[ Cerrar ]` (default).

### 3.9 CTA primario (footer del hub)

- `Button` default (primary). Label dinámico: **"Importar N contactos"** / **"…N clientes"** según el
  segmented. N = solo incluidas + válidas.
- Disabled si: Nombre sin mapear · o N incluidas = 0 (→ microcopy "No hay contactos nuevos para importar").
- `Cancelar` a la izquierda (`variant="outline"`), consistente con el resto de los diálogos del proyecto.

---

## 4. Estados por componente (checklist de cobertura)

| Componente | default | hover | focus | drag-over | disabled | loading | error | excluido |
|---|---|---|---|---|---|---|---|---|
| Dropzone | ✓ | ✓ | ✓ ring | ✓ | — | ✓ | ✓ | — |
| Segmented "Importar como" | ✓ | ✓ | ✓ | — | — | — | — | — |
| Select de mapeo | ✓ | ✓ | ✓ | — | — | — | ✓ (req.) | — |
| Chips resumen | ✓ | — (link sí) | — | — | — | — | — | — |
| Fila de tabla | ✓ | ✓ | — | — | ✓ (sin-nombre) | — | — | ✓ opacity-50 |
| Progress | — | — | — | — | — | ✓ | — | — |
| CTA Importar | ✓ | ✓ | ✓ | — | ✓ | (→ pantalla 4) | — | — |

---

## 5. Notas para Frontend (T3)

1. **Pegar tokens** de §2 en `index.css` (light + dark) y `tailwind.config.ts`. Sin eso, los chips de
   estado no tienen color semántico.
2. **Sacar el rojo** del badge "Vendedor" en el preview (`variant="destructive"` → `secondary`/`outline`).
3. **Dropzone real:** `onDragOver/onDragLeave/onDrop`.
4. **Mapeo re-aplica en vivo** sobre tabla + resumen al cambiar un Select.
5. **Responsive de tabla:** card-list en `< sm` (no scroll horizontal).
6. Migración futura de `emerald/orange` crudos → tokens nuevos: deuda, no bloquea T3 (avisar a /pm).

## 6. Pendiente / scope

- Este doc cubre **fundaciones (referencia) + tokens de estado + Flow 3**. La librería de componentes
  completa (botones/inputs/cards/etc. ya implementados) **no** está documentada retroactivamente — es
  una tarea aparte si se quiere un design-system.md exhaustivo (ticket para /pm).
- **No existe ticket `ui`** para este trabajo: pedirle a /pm que cree uno (sub-tarea del spike UX
  `86aj3kf0b` o ticket UI propio) para no perder tracking.
