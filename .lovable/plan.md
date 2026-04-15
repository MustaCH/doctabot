

## Problema: Los matches matutinos no se renderizan como cards

### Causa raíz

El parser de `PropertyCard` (`parsePropertyCard`) requiere el emoji `🏠` para activar el renderizado como tarjeta de propiedad. Necesita líneas estructuradas con emojis específicos:
- `🏠 **Título**` → título
- `💰 Precio` → precio  
- `📍 Ubicación` → ubicación
- `🔗 [Ver propiedad](url)` → link

Pero `formatPropertyLine` en `morning-matches/index.ts` genera una sola línea plana:
```
**VENTA DUPLEX 3 DORMITORIOS** · USD 180.000 · Pampas de Manantiales · 158 m² · 4 amb. · [Ver propiedad](url)
```

Sin `🏠`, el parser devuelve `null` y el contenido se renderiza como markdown plano.

### Solución

Cambiar `formatPropertyLine` para que genere el formato de emojis que `parsePropertyCard` espera. Pero como el morning-matches envía **múltiples propiedades en un solo mensaje**, y `parsePropertyCard` solo detecta **una card por mensaje**, necesitamos que el mensaje use `===MSG_BREAK===` para separar cada propiedad en su propio mensaje... pero eso no aplica aquí porque es un insert directo, no streaming.

**Enfoque práctico**: Como el morning-matches mete varias propiedades en un solo mensaje, no podemos convertir cada una en una card individual (el parser solo soporta una por mensaje). Lo mejor es:

1. Reformatear `formatPropertyLine` para que cada propiedad tenga las líneas con emojis (`🏠`, `💰`, `📍`, `🔗`) separadas por `\n`
2. Actualizar `AssistantContent` para detectar mensajes con **múltiples** bloques `🏠` y renderizar múltiples `PropertyCard` en secuencia, en lugar de solo uno

### Cambios

**1. `supabase/functions/morning-matches/index.ts`** — Reformatear `formatPropertyLine`:
```typescript
function formatPropertyLine(p: PropertyRow): string {
  const lines: string[] = [];
  if (p.title) lines.push(`🏠 **${p.title}**`);
  if (p.price) lines.push(`💰 ${p.currency || "USD"} ${p.price.toLocaleString("es-AR")}`);
  if (p.address) lines.push(`📍 ${p.address}`);
  const surfaceParts: string[] = [];
  if (p.m2_total) surfaceParts.push(`${p.m2_total} m²`);
  if (p.ambientes) surfaceParts.push(`${p.ambientes} amb.`);
  if (surfaceParts.length) lines.push(`📐 ${surfaceParts.join(" · ")}`);
  if (p.url) lines.push(`🔗 [Ver propiedad](${p.url})`);
  return lines.join("\n");
}
```

Eliminar el separador `---\n` entre propiedades (ya no es necesario).

**2. `src/components/ChatMessage.tsx`** — Soportar múltiples cards en un mensaje:
Actualizar `AssistantContent` para que, cuando el contenido tenga múltiples bloques `🏠`, los separe y renderice cada uno como `PropertyCard`, con el texto introductorio y los "Coincide por" como markdown normal.

**3. `src/components/PropertyCard.tsx`** — Agregar función `parseMultiplePropertyCards` que divida el contenido por bloques `🏠` y devuelva un array de cards + texto intercalado.

### Archivos a tocar
- `supabase/functions/morning-matches/index.ts` — reformatear output
- `src/components/ChatMessage.tsx` — renderizar múltiples cards
- `src/components/PropertyCard.tsx` — agregar parser multi-card

