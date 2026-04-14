

## Plan: Corregir URLs de portales externos en `search_external_portals`

### Problema

ZonaProp no usa parámetros de búsqueda en la URL como se asumió. Las URLs construidas dinámicamente llevan a resultados de Buenos Aires u otras provincias. Se necesitan URLs base específicas de Córdoba para cada portal.

### Cambio único

**Archivo:** `supabase/functions/chat/index.ts` — líneas 1614-1634

Reemplazar `buildZonapropUrl()` y `buildArgenpropUrl()` con URLs fijas por operación:

**ZonaProp** (por operación):
- Alquiler: `https://www.zonaprop.com.ar/inmuebles-alquiler-cordoba.html`
- Venta: `https://www.zonaprop.com.ar/inmuebles-venta-cordoba.html`
- Temporal: `https://www.zonaprop.com.ar/inmuebles-alquiler-temporal-cordoba.html`
- Default (sin operación): las 3 URLs

**ArgenProp** (URL única genérica):
- `https://www.argenprop.com/campos-o-casas-o-cocheras-o-departamentos-o-fondos-de-comercio-o-galpones-o-hoteles-o-locales-o-negocios-especiales-o-oficinas-o-ph-o-quintas-o-terrenos/alquiler-o-alquiler-temporal-o-venta/cordoba-arg`

La búsqueda de Firecrawl con `site:` seguirá funcionando igual para traer links individuales, pero ahora las `search_urls` de fallback apuntarán a Córdoba.

Además, agregar `cordoba` al query de Firecrawl para que los resultados se enfoquen en Córdoba:
```typescript
const searchQuery = `site:${siteDomain} cordoba ${query}${operation ? ` ${operation}` : ""}`;
```

| Archivo | Cambio |
|---|---|
| `supabase/functions/chat/index.ts` | Reemplazar builders de URL con URLs fijas de Córdoba, agregar "cordoba" al search query de Firecrawl |

