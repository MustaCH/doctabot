# flows.md

**Proyecto:** doctabot — asistente IA "Alan" (RE/MAX Docta)
**Dueño:** /ux-designer
**Última actualización:** 2026-06-17

---

## Contexto transversal

El North Star de Alan es que el agente **ejecute acciones de valor** (agendar visitas, redactar
mensajes a clientes, vincular propiedad↔cliente, atender matches proactivos), no que acumule
inventario ni use a Alan como un buscador más. Dos superficies remaban en contra y se rediseñaron
en el sprint de optimización (tickets `[opt]` 86aj1f16b y 86aj1f1yd):

1. **Primer contacto** (empty-state del chat + chips + tutorial) vendía el subconjunto menos
   diferenciador (buscar/favoritos = cualquier portal).
2. **Centro de Control** (dashboard) premiaba acumular (contar Propiedades/Contactos/Favoritos) y
   estaba escondido a dos toques dentro de Perfil.

**Decisión de tono (validada con Nacho, 2026-06-14):** registro **fuerte / proactivo** — Alan se
presenta como "tu mano derecha" que actúa, con la búsqueda en segundo plano. Este registro manda
sobre todo el copy de onboarding.

---

## Flow 1 — Primer contacto ("Alan actúa, no solo busca")

Archivos: `src/pages/Chat.tsx` (empty-state + chips), `src/pages/Tutorial.tsx` (pasos).

```
[Usuario abre el chat, conversación vacía]
        │
        ▼
[Empty-state]  ── copy proactivo + 4 chips ──┐
        │                                     │
        │ toca un chip                         │ escribe/dicta libre
        ▼                                     ▼
[handleSend(prompt autocontenido)] ───► [Alan responde / ejecuta]

[Onboarding separado: /tutorial] (primera vez, swipeable, "Omitir" siempre visible)
```

### Empty-state — wireframe

```
┌───────────────────────────────┐
│            [avatar Alan]       │
│        ¡Hola! Soy Alan 👋      │
│  Soy tu mano derecha en        │
│  RE/MAX Docta. Agendo visitas, │
│  redacto los mensajes a tus    │
│  clientes, conecto propiedades │
│  con quien las busca y te aviso │
│  de cada match. También busco  │
│  propiedades, obvio 😉         │
│                                │
│  ( 🔎 Buscar departamentos…)   │
│  ( ✍️ Redactá un WhatsApp…)    │
│  ( 📅 Agendá una visita…)      │
│  ( ✨ ¿Qué podés hacer por mí?)│
└───────────────────────────────┘
```

**Chips** (antes: 3 pasivos — Buscar / Ver agenda / Listar clientes). Ahora **1 búsqueda + 2 acciones
+ 1 descubrimiento**, todos prompts de **primer turno autocontenidos** (no asumen `[cliente]` ni
"esta propiedad", así no rompen en frío):

| Chip | Tipo | Ícono lucide |
|---|---|---|
| "Buscar departamentos en Nueva Córdoba" | búsqueda | `Search` |
| "Redactá un WhatsApp para un cliente" | acción | `PenLine` |
| "Agendá una visita para esta semana" | acción | `CalendarPlus` |
| "¿Qué podés hacer por mí?" | descubrimiento | `Sparkles` |

> El chip de descubrimiento es la red de seguridad para el usuario nuevo que no quiere comprometerse
> con una acción concreta: Alan responde mostrando su rango (heurística #6, reconocer > recordar).

### Tutorial — 2 pasos nuevos

Se insertan **después de "Gestioná clientes"** y **antes del paso de agenda** (que NO se tocó), para
agrupar los tres "Alan hace por vos": conecta/avisa → redacta/envía → agenda.

1. **"Alan conecta propiedades con clientes 🔔"** (`Link2` + `BellRing`) — vincular + de dónde salen
   los matches (las conversaciones con 🔔 que Alan abre solo).
2. **"Alan redacta y manda por vos ✍️"** (`Mail` + `MessageCircle`) — distingue **email: Alan lo
   envía** (con confirmación previa, regla canónica) de **WhatsApp: Alan deja el botón** "Enviar por
   WhatsApp".

### Estados contemplados

| Pantalla | Inicial/vacío | Loading | Éxito | Error | Notas |
|---|---|---|---|---|---|
| Empty-state | ✓ (es el estado vacío del chat) | n/a | al enviar, monta la conversación | hereda manejo de error de `useChatMessages` | chips ocultos apenas hay mensajes |
| Chip → frío | usuario sin clientes/propiedades | — | Alan pide los datos que faltan conversacionalmente | — | por eso los prompts son autocontenidos |
| Tutorial | paso 1 de N, "Omitir" visible | n/a | "Comenzar" → `/`, set `alan_tutorial_done` | n/a | swipe + dots + back |

### Decisiones de UX (justificadas)

- **Reposicionar el copy hacia la acción** (heurística #2, lenguaje del usuario; #8, mostrar lo que
  importa): el primer contacto nombra lo diferenciador. Un agente que no descubre estas acciones
  nunca las pide.
- **Chips autocontenidos**: evita el dead-end de un prompt que asume contexto inexistente
  (prevención de errores, #5).
- **Dejar 1 chip de búsqueda**: la búsqueda sigue siendo el on-ramp más familiar; no se elimina, se
  reordena en jerarquía.

---

## Flow 2 — Centro de Control accesible + métrica de acciones

Archivos: `src/pages/Chat.tsx` (acceso en header), `src/pages/Dashboard.tsx` (card + back-nav).

```
[Chat header]
   [avatar Alan · título]      [▦ Centro de control] [◍ Perfil]
                                       │
                                       │ tap
                                       ▼
                              [/dashboard "Centro de Control"]
                                       │
                              [← Atrás] → navigate(-1) (vuelve al chat, no a Perfil)
```

### Acceso desde el header

Botón nuevo a la **izquierda del Perfil** (el avatar/cuenta queda como ancla más a la derecha,
convención estándar). Ícono `LayoutDashboard` — distinto de los íconos de los chips y de
Search/CalendarDays/Users (requisito del ticket). `aria-label="Centro de control"` (botón solo-ícono).

### Métrica de acciones — card "Acciones (7d)"

Las 4 metric-cards contaban inventario acumulado. Se reemplaza **Favoritos** (la más vanidosa, y ya
tiene su propia sección) por **"Acciones (7d)"** y se la mueve a **arriba-izquierda** (primera que se
ve en la grilla 2×2 → máximo refuerzo del hábito).

```
Acciones (7d) = client_properties (status='enviada', updated_at ≥ hoy-7d)
              + client_events     (created_at ≥ hoy-7d)
              + client_notes      (is_action ∧ is_done, created_at ≥ hoy-7d)
```

Ícono `Zap` (color `text-orange-500`), todas las queries scopeadas por `.eq("user_id", user.id)`.

```
┌──────────┬──────────┐
│ ⚡ N      │ 🔎 N      │
│ Acciones │ Propied.  │
│  (7d)    │           │
├──────────┼──────────┤
│ 👥 N      │ 💬 N      │
│ Contactos│ Convers.  │
└──────────┴──────────┘
```

### Estados contemplados

| Elemento | Vacío | Loading | Éxito | Notas |
|---|---|---|---|---|
| Card Acciones | `0` (semana sin actividad) | skeleton (grilla ya lo cubre) | número | las secciones de abajo (Esta semana / Tareas) dan el detalle |
| Acceso header | siempre visible | n/a | navega a `/dashboard` | — |

### Decisiones de UX (justificadas)

- **Sacar el dashboard de adentro de Perfil** (heurística #7, eficiencia; #1, visibilidad): a 1 toque
  desde donde el agente vive (el chat).
- **`navigate(-1)` en el "Atrás"** (heurística #3, control y libertad): antes volvía siempre a Perfil;
  ahora vuelve a donde entraste (chat o perfil). Coherencia con la nueva entrada.
- **Acciones como primera card**: la jerarquía visual comunica qué importa. Contar inventario pasa a
  segundo plano.

---

## Flow 3 — Importar contactos desde CSV/XLSX (rediseño)

Archivos: `src/components/ImportClientsDialog.tsx` (front), `supabase/functions/parse-client-import/index.ts`
(mapeo IA). Punto de entrada: botón `Upload` en el header de `src/pages/Clients.tsx`.
Ticket: `86aj3kf0b` ([spike/ux]). Alimenta T3 (implementación de robustez).

### Contexto

- **Usuario objetivo:** agente RE/MAX Docta que tiene su cartera de contactos en una planilla
  (export de otro CRM, Excel propio, contactos del teléfono) y la quiere meter al sistema de una.
- **Objetivo del usuario (job):** "que mis contactos queden adentro, bien, sin tener que revisar
  uno por uno". No quiere mapear columnas ni pelear con formatos.
- **Estado emocional:** apurado y con algo de desconfianza ("¿me va a importar cualquier cosa?").
  Es una acción de **una sola vez por cartera**, alto valor, con miedo a romper/duplicar datos.
- **Pre-requisitos:** estar logueado. Archivo CSV/XLSX/XLS ≤ 20MB con al menos un encabezado + 1 fila.

### Auditoría del flujo viejo (fricciones detectadas)

| # | Severidad | Fricción | Heurística |
|---|---|---|---|
| 1 | 🔴 | Todo entra como **Cliente + estado `hot`** hardcodeado, sin elección ni aviso → contamina pipeline | #1, #2 |
| 2 | 🔴 | **Cero detección de duplicados** (ni contra existentes ni dentro del archivo) | #5 |
| 3 | 🔴 | Filas sin nombre se **descartan en silencio** (`.filter(full_name)`) | #1, #9 |
| 4 | 🟠 | El **mapeo de IA no se puede corregir** (badges read-only) | #3, #6 |
| 5 | 🟠 | Error de import **opaco y destructivo**: 1 fila mala marca como error todo el lote de 20; sin razón ni retry | #9 |
| 6 | 🟡 | **Drag & drop prometido que no funciona** (solo `onClick`, no hay `onDrop`) | #2, #4 |
| 7 | 🟡 | Sin indicador de paso | #1 |
| 8 | 🟡 | No se pueden **excluir filas puntuales** (todo o nada) | #3 |

### Decisiones de producto (cerradas con Nacho, 2026-06-17)

- **Destino por defecto = `Contacto`** (`is_client: false`, sin estado de pipeline). Toggle opcional
  "marcar como Cliente" → habilita selector de estado con default **`cold`** (nunca más `hot` masivo).
- **Duplicados:** detectar por teléfono/email (contra existentes **y** dentro del archivo),
  **excluir por defecto**, con opción de re-incluir.

### User flow (rediseñado)

El esqueleto sigue siendo de 2 pasos visibles (no agrego fricción): la pantalla de **Revisar** se
convierte en el hub donde se configura destino, se corrige el mapeo y se ven los problemas.

```
[Clients header → botón Importar]
        │
        ▼
[Paso 1/2 · Subir archivo]
        │  drag&drop real o click; valida formato + tamaño ANTES de subir
        │  ── archivo inválido ──► error inline en la misma dropzone (no toast suelto)
        ▼
[Analizando con IA…]  (transitorio, spinner + nombre de archivo)
        │  ── falla la IA ──► vuelve a Paso 1 con error claro + "reintentar"
        ▼
[Paso 2/2 · Revisar y configurar]  ◄────────── hub editable
        │   ├─ Importar como: (Contacto | Cliente→estado)
        │   ├─ Columnas detectadas (editable: re-mapear / quitar)
        │   ├─ Resumen: ✅ nuevos · ⚠️ duplicados (excluidos) · ❌ sin nombre
        │   └─ Tabla con estado por fila + excluir individual
        │
        │  click "Importar N contactos"   (N = solo incluidos y válidos)
        ▼
[Importando…]  (barra de progreso + contador X/N)
        │
        ▼
[Resultado]  ✅ N importados · ⏭️ N omitidos (duplicados) · ❌ N fallaron (con razón)
             └─ [Reintentar fallidos]   [Cerrar]
```

### Wireframes pantalla-por-pantalla

#### Pantalla 1 — Subir archivo (Paso 1/2)

```
┌──────────────────────────────────────────────┐
│  📄 Importar contactos                Paso 1/2 │
├──────────────────────────────────────────────┤
│                                                │
│   ┌────────────────────────────────────────┐  │
│   │            ⬆ (icono upload)            │  │
│   │   Arrastrá tu archivo acá              │  │
│   │   o hacé clic para elegirlo            │  │
│   │   CSV, XLSX o XLS · máx. 20MB          │  │
│   └────────────────────────────────────────┘  │
│        (la dropzone resalta al arrastrar)      │
│                                                │
│   ¿No sabés cómo armar el archivo?             │
│   → Descargá la plantilla de ejemplo           │
│                                                │
├──────────────────────────────────────────────┤
│                                  [ Cancelar ]  │
└──────────────────────────────────────────────┘
```

Elementos: dropzone funcional (drag **y** click), restricciones visibles, link a **plantilla de
ejemplo** (heurística #10, baja el miedo del usuario nuevo). Sin paso de "configuración" todavía:
no pedir decisiones antes de que haya datos.

Estados:
- Inicial: dropzone vacía.
- Arrastrando encima: dropzone resaltada (feedback, #1).
- Archivo inválido (formato/tamaño/vacío): **error inline en la dropzone** ("Ese archivo es .pdf,
  necesito CSV/XLSX/XLS"), no un toast que desaparece (#9).
- Subiendo/leyendo: spinner breve.

#### Pantalla 2 — Analizando con IA (transitorio)

```
┌──────────────────────────────────────────────┐
│              (spinner)                         │
│        Analizando columnas con IA…             │
│   Identificando nombres, teléfonos y emails    │
│   en "cartera_2024.xlsx"                        │
└──────────────────────────────────────────────┘
```

Estados: loading (igual que hoy) · error IA → vuelve a Paso 1 con mensaje + "reintentar"
(hoy el catch tira a `upload` con toast; mantener pero con copy accionable).

#### Pantalla 3 — Revisar y configurar (Paso 2/2) · el hub

```
┌───────────────────────────────────────────────────────┐
│  📄 Importar contactos                         Paso 2/2 │
├───────────────────────────────────────────────────────┤
│  Importar como:   ( ● Contactos )  ( ○ Clientes )       │
│      └─ si Clientes →  Estado: [ Cold ▼ ]               │
│                                                         │
│  Columnas detectadas (tocá para corregir)               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 👤 Nombre   → [ Nombre completo      ▼ ]         │   │
│  │ 📱 Teléfono → [ Celular              ▼ ]         │   │
│  │ 📧 Email    → [ — (sin asignar)      ▼ ]         │   │
│  │ 🏷️ Tipo     → [ Tipo de contacto     ▼ ]         │   │
│  │ 📝 3 columnas más → a notas   [ ver ]            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌── Resumen ───────────────────────────────────────┐  │
│  │ ✅ 248 nuevos                                     │  │
│  │ ⚠️ 12 ya existen → excluidos   [ Incluir igual ]  │  │
│  │ ❌ 3 sin nombre → no se importan  [ ver ]         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ☐ | # | Nombre        | Tipo | Tel      | Estado │   │
│  │ ───┼───┼──────────────┼──────┼──────────┼─────── │   │
│  │ ☑ │ 1 │ Juan Pérez    │ Comp │ 351...   │ ✅ nuevo│   │
│  │ ☑ │ 2 │ Ana Gómez     │ Vend │ 351...   │ ✅ nuevo│   │
│  │ ☐ │ 3 │ Juan Pérez    │ Comp │ 351...   │ ⚠️ dup  │   │
│  │ ☐ │ 4 │ (sin nombre)  │ —    │ 351...   │ ❌ sin nom│  │
│  └─────────────────────────────────────────────────┘   │
│  Problemas primero · mostrando 50 de 263                │
├───────────────────────────────────────────────────────┤
│             [ Cancelar ]   [ Importar 248 contactos ]   │
└───────────────────────────────────────────────────────┘
```

Elementos clave:
- **"Importar como"** arriba de todo: decisión más importante, visible antes de apretar Importar.
  El label del CTA refleja el destino ("Importar 248 **contactos**" / "**clientes**").
- **Columnas detectadas editables:** cada campo es un `select` con las columnas del archivo + "sin
  asignar". Corregir el mapeo **re-aplica en vivo** sobre la tabla y el resumen. Resuelve fricción #4
  y, de paso, #3: si hay muchas "sin nombre", casi siempre es que la columna de nombre está mal
  mapeada → corregirla las recupera a todas de un saque.
- **Resumen accionable** (los 3 contadores): es el corazón del AC#3. Duplicados y sin-nombre dejan de
  ser silenciosos. "Incluir igual" y "ver" son las salidas de control (#3).
- **Tabla con estado por fila + checkbox de exclusión:** filas con problema ordenadas primero, para
  que el usuario las vea sin scrollear las 263. El CTA cuenta solo incluidas + válidas.

Estados (wizard / tabla):
- Sin nombre mapeado (name = "sin asignar"): CTA disabled + aviso "Elegí qué columna tiene el nombre"
  (prevención de errores, #5; el nombre es el único campo obligatorio).
- Todos duplicados/excluidos (N incluidas = 0): CTA disabled + microcopy "No hay contactos nuevos
  para importar" (estado *sin resultados* del wizard).
- Tabla > 50 filas: "mostrando 50 de N", pero **las filas con problema se muestran siempre** (no se
  esconden en la fila 200).

#### Pantalla 4 — Importando

```
┌──────────────────────────────────────────────┐
│              (barra de progreso)               │
│        Importando contactos…  137/248          │
└──────────────────────────────────────────────┘
```

Progreso real (X/N), no solo spinner: el usuario ve que avanza en cargas grandes (#1).
No permitir cerrar el diálogo a la mitad sin confirmación (evita import parcial accidental, #3).

#### Pantalla 5 — Resultado

```
┌──────────────────────────────────────────────┐
│                    ✅                          │
│           245 contactos importados             │
│                                                │
│   ⏭️ 12 omitidos (ya existían)                 │
│   ❌ 3 no se pudieron importar                 │
│        → "Teléfono con formato inválido" (×2)  │
│        → "Fecha de cumpleaños inválida" (×1)   │
│                                                │
│        [ Reintentar fallidos ]   [ Cerrar ]    │
└──────────────────────────────────────────────┘
```

Resuelve la fricción #5: el resultado dice **qué** falló y **por qué**, agrupado por causa, con la
opción de **reintentar solo los fallidos** (no re-importar todo). Distingue *omitidos* (decisión del
usuario / duplicados) de *fallidos* (error real) — no los mezcla en un "N no se pudieron importar".

### Estados contemplados (matriz)

| Pantalla | Inicial/vacío | Loading | Éxito | Sin resultados | Error | Específicos |
|---|---|---|---|---|---|---|
| 1 Subir | ✓ dropzone vacía | ✓ leyendo | → Paso 2 | n/a | ✓ inline (formato/tamaño/vacío) | drag-over resaltado |
| 2 Analizando | n/a | ✓ | → Paso 2 | n/a | ✓ IA falla → vuelve a P1 + retry | — |
| 3 Revisar | — (siempre con datos) | re-aplica mapeo en vivo | CTA enabled | ✓ "no hay nuevos" → CTA disabled | name sin mapear → CTA disabled | dup excluidos, sin-nombre, >50 filas |
| 4 Importando | n/a | ✓ progreso X/N | → Resultado | n/a | error de red corta → muestra parcial en Resultado | confirmar antes de cerrar |
| 5 Resultado | n/a | n/a | ✓ importados | n/a | ✓ fallidos con razón + retry | omitidos ≠ fallidos |

### Justificación de decisiones clave

- **Mantener 2 pasos visibles** (no agregar un paso de "configuración" aparte): el flujo más corto.
  Destino + mapeo + validación viven todos en el hub de Revisar, donde el usuario ya tiene los datos
  a la vista para decidir con contexto (#6, reconocer > recordar).
- **Default `Contacto` (no Cliente) y `cold` (no `hot`):** importar en masa es volcar una cartera
  cruda, no calificar leads. El default no debe ensuciar el pipeline; quien quiera calificarlos lo
  hace explícito (revierte la fricción #1).
- **Mapeo editable que re-aplica en vivo:** convierte el "sin nombre / mal mapeado" de error
  terminal a algo que el usuario corrige en 2 clics. Un solo control resuelve #3 y #4 a la vez.
- **Excluir duplicados por default, no bloquear:** el camino seguro es el default (no duplicar), pero
  el usuario mantiene el control para incluirlos (#3, libertad). El merge/actualizar se evaluó y se
  pospone (ver follow-ups) para no inflar T3.
- **Resultado que separa *omitido* de *fallido*:** son cosas distintas (decisión vs error) y mezclarlas
  asusta. Agrupar fallos por causa + retry selectivo respeta #9.

### Notas para UI Designer

- El **"Importar como" (Contacto/Cliente)** es el control jerárquicamente más fuerte de la pantalla
  de Revisar: va arriba de todo y debe leerse como decisión, no como filtro. El selector de estado
  aparece **solo** si se elige Cliente (disclosure progresivo).
- El **resumen de 3 contadores** (✅/⚠️/❌) es el segundo foco. Usar color semántico, pero que ⚠️ y ❌
  no parezcan errores fatales: son informativos y accionables. Definir el acento dentro del design
  system (no hardcodear como el `text-orange-500` del Flow 2).
- En la tabla, el **estado por fila** (nuevo/dup/sin-nombre) es la columna que más mira el usuario
  desconfiado; que tenga peso visual. Las filas excluidas (checkbox off) deben verse atenuadas.
- Los íconos ya en uso en el diálogo (`Upload`, `FileSpreadsheet`, `CheckCircle`, `AlertTriangle`)
  se mantienen; sumar el de progreso y el de "omitido" (⏭️ / `SkipForward`).

### Notas para Frontend (T3)

- **Detección de duplicados scopeada por `userId`** (regla #2 de CLAUDE.md: las edge functions
  bypassean RLS; toda query a datos del usuario filtra por `.eq("user_id", userId)`). Comparar por
  teléfono normalizado y/o email, contra `clients` existentes **y** dentro del propio archivo.
- **Import por lotes con aislamiento de fallos:** hoy un error en un lote de 20 marca los 20 como
  fallidos. Al fallar un lote, reintentar **fila por fila** para reportar exactamente cuáles fallaron
  y con qué causa (alimenta la Pantalla 5). No contar como "error" lo que en realidad se omitió.
- **`status` ya no se hardcodea `hot`:** depende del toggle (Contacto → `is_client:false` sin status
  relevante; Cliente → `is_client:true` + status elegido, default `cold`). Respetar enums cerrados
  `hot|warm|cold` y `buyer|seller|both` (CLAUDE.md #8).
- **Dropzone real:** implementar `onDragOver`/`onDragLeave`/`onDrop` además del `onClick`, o ajustar
  el copy. Hoy promete drag&drop que no existe (#6).
- **Normalización de fechas (`birthday`) y montos antes de insertar:** son las causas probables de los
  fallos silenciosos del lote. Validar/parsear en cliente y, si no se puede normalizar, mandar a notas
  o marcar la fila como problema en vez de romper el insert.
- **Plantilla de ejemplo descargable:** un CSV con las columnas que la IA reconoce bien (Nombre,
  Teléfono, Email, Tipo de contacto, Zona, Presupuesto, …) — baja la tasa de mapeos raros.
- **Confirmar antes de cerrar durante "Importando"** (evita import parcial por cierre accidental).

---

## Notas para UI Designer

- La card "Acciones (7d)" es el **héroe** de la grilla — merece distinción visual (el `text-orange-500`
  es un placeholder; definí el acento dentro del design system). Las otras 3 cards son secundarias.
- En el empty-state, la jerarquía es: avatar → título → **copy proactivo** → chips. Los 4 chips deben
  leerse como acciones, no como links de navegación.
- Íconos compuestos en el tutorial (`Link2`+`BellRing`, `Mail`+`MessageCircle`) siguen el patrón ya
  existente (`Mic`+`FileText`).

## Follow-ups / deuda (avisar al PM, no resueltos acá)

1. **`client_notes` no tiene `completed_at`** → "tareas completadas en 7 días" usa `created_at` como
   proxy (cuenta notas-acción creadas en la ventana y ya marcadas done). Si se quiere medir
   *completadas* con precisión, hace falta que Backend agregue `completed_at`. Ticket para `/backend`.
2. **Tutorial quedó en 11 pasos** (eran 9). Aceptable y skippeable, pero cerca del límite de fatiga;
   evaluar a futuro fusionar pasos de bajo valor (Favoritos/Voz) o seccionar.
3. **Zero-state de la card Acciones**: hoy muestra `0` plano. A futuro, considerar un microcopy o que
   el tap scrollee a "Tareas pendientes" para no desmotivar al usuario nuevo.
4. **Import — merge/actualizar duplicados (pospuesto)**: el rediseño del Flow 3 excluye duplicados por
   default. Ofrecer "actualizar el registro existente con los datos del archivo" se evaluó y se dejó
   fuera de T3 para no inflar el alcance. Si Nacho lo quiere, es un ticket nuevo para `/pm` (impacta
   diseño del preview + lógica de upsert en Backend).
5. **Import — plantilla de ejemplo descargable** (Flow 3, Pantalla 1): hace falta generar el CSV de
   ejemplo. Tarea chica de Frontend/contenido; coordinar con el copy de columnas que la IA reconoce.
