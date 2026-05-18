## Diagnóstico

Alan ejecutó `search_properties({ locality: "Nueva Córdoba", property_type: "Departamento" })` y la búsqueda devolvió 0 resultados, pero **hay 90 propiedades reales en Nueva Córdoba** en la base.

La causa es un **mismatch de tildes**:

- Alan envía `"Nueva Córdoba"` (con tilde, como lo escribe el usuario).
- En la base, los valores están guardados **sin tilde**:
  - `zone = "nueva cordoba"`
  - `locality = "Nueva Cordoba, Cordoba, Capital, Córdoba"`
  - `zone_neighborhood = "nueva cordoba"`
- El executor en `supabase/functions/chat/_shared/tools/executor.ts` (case `search_properties`, líneas 36–137) arma los filtros con `q.ilike("locality", "%Nueva Córdoba%")` directo sobre la tabla `properties`, **sin pasar por `unaccent`**. `ILIKE` es case-insensitive pero **NO** accent-insensitive, así que `"%Nueva Córdoba%"` no matchea `"Nueva Cordoba"`.

La RPC `search_properties_filtered` ya usa `unaccent` (memoria "Accent-insensitive Search"), pero el tool de Alan no la usa — consulta `properties` directamente, así que se pierde esa normalización.

Síntoma adicional: cualquier búsqueda con tildes (Córdoba, Argüello, Güemes, etc.) sufre el mismo problema y devuelve falsos negativos.

## Solución

Normalizar las strings de filtro **antes** de armar los `ILIKE`, removiendo diacríticos en el lado del cliente. Esto funciona porque los datos en BD ya están almacenados sin tildes para `zone`, `locality`, `zone_neighborhood`, `zone_city`. Es un cambio mínimo, sin tocar el schema ni la RPC.

### Cambios

**Archivo: `supabase/functions/chat/_shared/tools/executor.ts`**

1. Agregar un helper `stripAccents(s: string)` que use `s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")`.
2. En el case `search_properties`, después del `sanitizePattern`, aplicar `stripAccents` a los campos de texto que vienen del usuario y se usan en `ILIKE` contra columnas geográficas/título: `zone`, `locality`, `neighborhood`, `city`, `titleSearch`, `office`. (No tocar `operation`, `property_type`, `currency`, que ya están en formas canónicas sin acentos en BD.)
3. Dejar los fallbacks existentes (search en `title` cuando no hay match) intactos — ahora también funcionarán mejor porque la query estará normalizada.

### Por qué no usar la RPC `search_properties_filtered`

La RPC no expone los filtros de `ambientes`, `habitaciones`, `office`, `currency` que Alan sí necesita. Migrar a la RPC implicaría agregar parámetros y otra firma — más invasivo y propenso a otro conflicto de overload como el que acabamos de arreglar en el buscador del Explorer.

## Verificación

Después del fix:
1. Probar con `supabase--curl_edge_functions` invocando `chat` con un mensaje "Buscar departamentos en Nueva Córdoba" y revisar logs.
2. O más directo: pedirle a Alan en la app la misma consulta y confirmar que devuelve resultados.
3. Probar también una zona con tilde menos común (ej. "Güemes") para validar el patrón.

## Nota

Si en el futuro aparecen propiedades scrapeadas con tildes guardadas en BD (ej. `"Nueva Córdoba"` con tilde), este enfoque dejaría de cubrir 100% de los casos y habría que migrar a una RPC con `unaccent` en ambos lados. Por ahora todos los datos relevados están sin tilde, así que el strip del lado del input es suficiente.