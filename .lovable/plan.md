

## Mejorar mensaje inicial de Morning Matches con contexto del cliente

### Problema
El mensaje dice "Encontré X propiedades que coinciden con los intereses de tu cliente" pero no dice **cuáles** son esos intereses. El agente no sabe por qué matchean sin leer cada "Coincide por".

### Solución
Agregar un resumen de la búsqueda del cliente después del título, construido dinámicamente desde sus datos estructurados y notas.

### Cambio en `supabase/functions/morning-matches/index.ts`

Agregar función `buildClientSearchSummary` que genere una línea como:

> 🔍 **Busca:** Duplex en Docta, hasta USD 110.000

Construida desde:
- `preferred_zones` + zonas extraídas de `notes` → zonas
- `property_type_interest` + tipos extraídos de `notes` → tipo
- `budget_min` / `budget_max` + `budget_currency` → presupuesto
- Si todo está vacío, mostrar la línea de notas directamente

Ejemplo de output:
```
🔔 **Nuevas propiedades para Aldana Ludueña**

🔍 **Busca:** Duplex en Docta · Hasta USD 110.000

Encontré 3 propiedades que coinciden:

🏠 **VENTA DUPLEX 3 DORM...**
💰 USD 105.000
📍 Docta
🔗 [Ver propiedad](url)
_Coincide por: 📍 Zona: docta, 💰 Presupuesto compatible, 🏗️ Tipo: duplex_
```

### Implementación

En el bloque de construcción del mensaje (líneas 372-375), insertar después del título:

```typescript
function buildClientSearchSummary(client: ClientRow): string {
  const parts: string[] = [];
  
  // Tipo
  const types = client.property_type_interest
    ?.split(",").map(t => t.trim()).filter(Boolean) || [];
  // Extraer tipo de notas si no hay estructurado
  if (types.length === 0 && client.notes) {
    const noteTypes = extractTypeFromTitle(client.notes);
    if (noteTypes.length) types.push(...noteTypes);
  }
  
  // Zonas
  const zones = client.preferred_zones
    ?.split(",").map(z => z.trim()).filter(Boolean) || [];
  if (client.notes) {
    const noteZones = extractClientZonesFromNotes(client.notes);
    for (const z of noteZones) {
      if (!zones.some(ez => ez.toLowerCase() === z)) zones.push(z);
    }
  }
  
  // Construir texto tipo + zona
  const typeStr = types.length ? types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join("/") : null;
  const zoneStr = zones.length ? zones.join(", ") : null;
  if (typeStr && zoneStr) parts.push(`${typeStr} en ${zoneStr}`);
  else if (typeStr) parts.push(typeStr);
  else if (zoneStr) parts.push(`en ${zoneStr}`);
  
  // Presupuesto
  if (client.budget_max) {
    const curr = client.budget_currency || "USD";
    parts.push(`Hasta ${curr} ${client.budget_max.toLocaleString("es-AR")}`);
  } else if (client.budget_min) {
    const curr = client.budget_currency || "USD";
    parts.push(`Desde ${curr} ${client.budget_min.toLocaleString("es-AR")}`);
  }
  
  // Fallback: si no hay datos estructurados, usar notas
  if (parts.length === 0 && client.notes) {
    return `🔍 **Busca:** ${client.notes.substring(0, 100)}`;
  }
  
  return parts.length ? `🔍 **Busca:** ${parts.join(" · ")}` : "";
}
```

Luego en las líneas del mensaje (372-375):
```typescript
const lines: string[] = [
  `🔔 **Nuevas propiedades para ${client.full_name}**\n`,
];
const summary = buildClientSearchSummary(client);
if (summary) lines.push(`${summary}\n`);
lines.push(`Encontré ${matchedProps.length} propiedad${matchedProps.length > 1 ? "es" : ""} que coincide${matchedProps.length > 1 ? "n" : ""}:\n`);
```

### Archivos
- `supabase/functions/morning-matches/index.ts` — agregar `buildClientSearchSummary` y actualizar template del mensaje
- Deploy de la edge function

