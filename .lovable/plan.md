

## Problema: Morning Matches no distingue Compradores de Vendedores

### Diagnóstico

El código actual en `morning-matches/index.ts` **excluye completamente a los vendedores** (líneas 335 y 348: `.neq("client_type", "seller")`). Solo procesa compradores y los matchea contra propiedades nuevas.

Pero un **vendedor** necesita un match diferente: no busca propiedades para comprar, sino **compradores interesados en lo que él vende**. En el caso de Valentín Minguez (vendedor, notas: "Lote Docta Parque"), el sistema debería encontrar clientes compradores que buscan lotes en Docta — no mostrarle propiedades en venta.

### Solución: Flujo dual de matching

**Para compradores** (flujo actual): Propiedad nueva → matchear con clientes compradores por zona/tipo/presupuesto.

**Para vendedores** (flujo nuevo): Clientes compradores nuevos o propiedades nuevas del catálogo → buscar compradores que coincidan con lo que el vendedor ofrece. Pero esto es más complejo porque no sabemos el precio/zona exacta del vendedor desde sus datos estructurados.

**Enfoque práctico**: Como los datos del vendedor suelen estar en `notes` (ej: "Lote Docta Parque"), el matching de vendedores cruzaría:
1. Extraer del vendedor: tipo de propiedad que vende y zona (desde `notes`, `property_type_interest`, `preferred_zones`)
2. Buscar **clientes compradores** del mismo agente que buscan ese tipo en esa zona
3. Generar un mensaje diferente: "Encontré X compradores interesados en lo que vende tu cliente"

### Cambios en `supabase/functions/morning-matches/index.ts`

**1. Nuevo flujo para vendedores** después del flujo de compradores:

```typescript
// --- SELLER MATCHING: find buyers for sellers ---
const { data: sellers } = await admin
  .from("clients")
  .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes")
  .eq("user_id", userId)
  .eq("client_type", "seller");

const { data: buyers } = await admin
  .from("clients")
  .select("id, full_name, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, client_type, notes, phone, email, status")
  .eq("user_id", userId)
  .neq("client_type", "seller");
```

Para cada vendedor, extraer qué vende (tipo + zona desde notas/campos) y buscar compradores compatibles. Usar la misma lógica de zona obligatoria y tipo de propiedad.

**2. Mensaje diferenciado para vendedores**:

```
🔔 **Posibles compradores para el inmueble de Valentín Minguez**

🏷️ **Vende:** Lote en Docta

Encontré 2 compradores que podrían estar interesados:

👤 **Agustín Paz**
🔍 Busca: Lote en Docta · Hasta USD 45.000
📞 549351...
_Coincide por: 📍 Zona: Docta, 🏗️ Tipo: lote_

¿Querés que te prepare un mensaje para contactar a alguno?
```

**3. Deduplicación**: Usar `notified_matches` con un esquema `seller_client_id + buyer_client_id` para no repetir notificaciones. Se puede reutilizar la misma tabla usando `property_id` como el `buyer_client_id` (o agregar una columna `match_type`).

**4. Función `findSellerBuyerMatchReasons`**: Similar a `findMatchReasons` pero cruza los datos del vendedor (qué vende) contra los datos del comprador (qué busca).

**5. `buildSellerSummary`**: Genera la línea "🏷️ **Vende:** Lote en Docta" desde los datos del vendedor.

### Archivos a modificar
- `supabase/functions/morning-matches/index.ts` — agregar flujo de vendedores, nuevo formato de mensaje, funciones auxiliares
- Deploy de la edge function

### Lo que NO cambia
- El frontend `use-property-matches.ts` (matchea propiedades con clientes, no clientes con clientes)
- El flujo de compradores existente sigue igual

