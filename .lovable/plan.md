
## Problemas identificados

1. **Búsqueda no incluye el título**: Alan busca por `locality` y `zone`, pero muchas propiedades tienen la ubicación específica solo en el `title` (ej: "Las Tipas Manantiales"). Resultado: no encuentra nada aunque existan.

2. **No distingue propiedades de RE/MAX Docta**: De 3492 propiedades en la base, solo 393 son de la oficina "REMAX Docta". Cuando el agente pregunta "cuántas propiedades tenemos", Alan devuelve el total general en vez de las de Docta.

---

## Solución

### 1. Agregar parámetro `title` a `search_properties`

**Archivo**: `supabase/functions/chat/_shared/tools/definitions.ts`

- Agregar un parámetro `title` con descripción: "Buscar por palabras clave en el título de la propiedad (ej: Las Tipas, Country Cañuelas)"
- Agregar un parámetro `office` con descripción: "Filtrar por oficina: 'REMAX Docta' para solo propiedades propias, o vacío para todas"

**Archivo**: `supabase/functions/chat/_shared/tools/executor.ts`

- En el case `search_properties`, agregar filtro `ilike("title", ...)` cuando se pase `title`
- Agregar filtro `ilike("office", ...)` cuando se pase `office`
- Cuando no se encuentren resultados por `locality`, hacer un fallback automático buscando por `title` con el mismo texto (para cubrir casos como "Las Tipas" que no está en locality pero sí en title)

### 2. Actualizar el prompt de Alan

**Archivo**: `supabase/functions/chat/_shared/prompt.ts`

- Instruir a Alan que la base tiene propiedades de varias oficinas RE/MAX, pero que las de "REMAX Docta" son las propias
- Cuando el agente pregunte por "nuestras propiedades" o "cuántas tenemos", debe filtrar por `office: "REMAX Docta"`
- Cuando busque por nombre de barrio/zona y no encuentre resultados por locality, debe reintentar usando el parámetro `title`

### 3. Redeploy

Redesplegar la edge function `chat`.

---

## Detalle técnico

En `executor.ts`, la lógica de fallback por título sería:

```text
1. Buscar con los filtros normales (locality, zone, etc.)
2. Si locality fue provisto y resultados = 0, re-intentar reemplazando el filtro locality por un ilike en title
3. Devolver los resultados del fallback indicando que se buscó por título
```

Esto cubre el caso donde el agente escribe "Las Tipas" — Alan lo manda como `locality`, no encuentra nada, y automáticamente reintenta buscando en `title`.
