## Diagnóstico

El buscador de `/properties` falla porque la RPC `search_properties_filtered` tiene **dos overloads** en la base de datos:

1. Versión vieja (7 parámetros: sin `neighborhood_filter` / `city_filter`)
2. Versión nueva (9 parámetros: con esos filtros)

Cuando el frontend la invoca con los 7 parámetros viejos, PostgREST no puede elegir cuál ejecutar y devuelve:

```
PGRST203 — Could not choose the best candidate function between: ...
```

Ese error explota en el `catch` de `loadProperties` (src/pages/Properties.tsx:119) y dispara el toast "Error al buscar propiedades". Lo verifiqué llamando directamente al endpoint REST.

## Solución

Eliminar la versión vieja (la de 7 parámetros) vía migración SQL, dejando solo la nueva — que ya soporta todos los filtros y mantiene compatibilidad con el llamado actual del frontend porque `neighborhood_filter` y `city_filter` tienen default `''`.

### Migración

```sql
DROP FUNCTION IF EXISTS public.search_properties_filtered(
  text, text, text, numeric, numeric, integer, integer
);
```

Esto deja activa solamente la firma de 9 argumentos (con defaults para los dos nuevos filtros), así el llamado actual desde `Properties.tsx` y cualquier llamado que pase los 9 parámetros sigue funcionando sin tocar código.

## Verificación

Tras aplicar la migración:
- Probar la RPC con `curl` (debe devolver filas, no PGRST203).
- Recargar `/properties` y confirmar que el listado aparece sin el toast de error.

## Nota

No hace falta tocar `src/pages/Properties.tsx` — el problema es 100% del schema. Si más adelante querés exponer los filtros de barrio/ciudad en la UI, basta con agregar los dos parámetros al `rpc()`.