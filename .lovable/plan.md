

## Plan: Búsqueda de propiedades en portales externos (ZonaProp y ArgentProp)

### Enfoque

Agregar una nueva herramienta `search_external_portals` que construye URLs de búsqueda en ZonaProp y ArgentProp según los criterios del agente, y opcionalmente usa Firecrawl para scrapear los resultados y devolver links directos a propiedades.

### Cambios en `supabase/functions/chat/index.ts`

**1. Agregar instrucción al system prompt** (~línea 56)

Agregar la herramienta 30 `search_external_portals` en la lista de herramientas del prompt, explicando que busca propiedades en ZonaProp y ArgentProp y devuelve URLs de resultados.

Agregar regla: "Si el agente pide buscar en portales externos, en ZonaProp, en ArgentProp, o en internet propiedades → usá `search_external_portals`."

**2. Agregar tool definition** (~línea 704)

```typescript
{
  type: "function",
  function: {
    name: "search_external_portals",
    description: "Buscar propiedades en portales inmobiliarios externos (ZonaProp y ArgentProp). Devuelve URLs de propiedades encontradas.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Búsqueda libre (ej: 'departamento 2 ambientes nueva córdoba')" },
        operation: { type: "string", description: "venta o alquiler" },
        property_type: { type: "string", description: "departamento, casa, terreno, local, etc." },
        location: { type: "string", description: "Barrio o zona (ej: nueva-cordoba, centro)" },
        portals: { type: "array", items: { type: "string" }, description: "Portales a buscar: zonaprop, argenprop. Default: ambos" },
      },
      required: ["query"],
    },
  },
}
```

**3. Agregar handler** (~línea 1572)

La implementación:
1. Construye URLs de búsqueda para cada portal basándose en los parámetros (ZonaProp: `zonaprop.com.ar/[tipo]-[operacion]-[ubicacion].html`, ArgentProp: `argenprop.com/[tipo]-[operacion]-[ubicacion]`)
2. Usa Firecrawl search con `site:zonaprop.com.ar` y `site:argenprop.com` para obtener resultados reales con URLs
3. Devuelve título, URL y descripción de cada propiedad encontrada, más la URL de búsqueda general del portal

Esto permite que Alan devuelva links directos a propiedades en los portales externos.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/chat/index.ts` | Agregar tool definition, handler con Firecrawl `site:` search, e instrucciones en system prompt |

