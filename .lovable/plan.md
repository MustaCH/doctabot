

## Plan: Búsqueda de propiedades insensible a tildes

### Problema

La búsqueda `ilike` en PostgreSQL diferencia "duplex" de "dúplex" porque `ilike` solo ignora mayúsculas/minúsculas, no acentos.

### Solución

Crear una función SQL `unaccent` y usarla en la búsqueda mediante un filtro RPC o cambiando la query.

**Opción elegida:** Normalizar los acentos en el cliente antes de buscar y usar `unaccent()` de PostgreSQL en el servidor.

### Cambios

**1. Migración SQL: habilitar extensión unaccent + crear función de búsqueda**

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION search_properties(search_term text)
RETURNS SETOF properties
LANGUAGE sql STABLE
AS $$
  SELECT * FROM properties
  WHERE unaccent(coalesce(title,'')) ilike '%' || unaccent(search_term) || '%'
     OR unaccent(coalesce(address,'')) ilike '%' || unaccent(search_term) || '%'
     OR unaccent(coalesce(locality,'')) ilike '%' || unaccent(search_term) || '%'
     OR unaccent(coalesce(zone,'')) ilike '%' || unaccent(search_term) || '%'
     OR unaccent(coalesce(office,'')) ilike '%' || unaccent(search_term) || '%';
$$;
```

**2. `src/pages/Properties.tsx`** — Cuando hay `searchQuery`, usar `.rpc('search_properties', { search_term })` en lugar del `ilike` directo, y luego aplicar los demás filtros (operation, type, price) encima con la query builder normal. Alternativamente, ampliar la función RPC para recibir todos los filtros.

Dado que combinar RPC con filtros adicionales es complejo, la opción más simple y robusta es:

**Opción simplificada:** No usar RPC. En el `or()` del ilike, normalizar el término de búsqueda removiendo tildes en el cliente con JS (`normalize('NFD').replace(...)`) y hacer **dos búsquedas OR** — una con tildes y otra sin. Pero esto no resuelve datos con tildes en la DB.

**Opción final (la más limpia):** Crear una **generated column** `search_text` sin acentos, o usar la función `unaccent` directamente en el filtro SQL.

La solución más práctica sin romper la query builder existente:

1. Migración: `CREATE EXTENSION IF NOT EXISTS unaccent;`
2. En `Properties.tsx` línea 86-89: reemplazar el `or()` con un filtro raw que use `unaccent()`:

```typescript
if (searchQuery.trim()) {
  const q = searchQuery.trim().replace(/'/g, "''");
  query = query.or(
    `title.ilike.%${q}%,address.ilike.%${q}%,locality.ilike.%${q}%,zone.ilike.%${q}%,office.ilike.%${q}%`
  );
}
```

Esto no basta porque `ilike` no quita acentos. Necesitamos usar `.filter()` o `.textSearch()` — pero ninguno aplica `unaccent`.

**Solución definitiva:** Crear una función RPC que reciba todos los parámetros de búsqueda y filtros.

### Plan final concreto

| Archivo | Cambio |
|---|---|
| Migración SQL | `CREATE EXTENSION IF NOT EXISTS unaccent;` + función `search_properties_filtered(search_term, op_filter, type_filter, price_min, price_max, page_size, page_offset)` que usa `unaccent()` en las comparaciones |
| `src/pages/Properties.tsx` | Cuando hay `searchQuery`, llamar a la función RPC en vez del query builder directo. Sin searchQuery, mantener el query builder actual |

La función RPC devolverá las propiedades filtradas con `unaccent()` aplicado tanto al término de búsqueda como a los campos de la DB, garantizando que "duplex" y "dúplex" devuelvan los mismos resultados.

