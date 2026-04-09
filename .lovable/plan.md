

## Plan: Tolerancia de presupuesto en el matching de propiedades

### Problema

El matching actual exige que el precio de la propiedad sea **exactamente** menor o igual al `budget_max` del cliente. Ejemplo: propiedad a 170K USD y cliente con presupuesto hasta 160K → no matchea, aunque la diferencia es solo 6% y es negociable.

### Solución

Agregar un **margen de tolerancia del 15%** sobre el `budget_max` del cliente. Si el precio excede el presupuesto pero está dentro de ese margen, incluir al cliente como match pero con una etiqueta diferenciada que indique que requiere negociación.

### Cambios

**Archivo:** `src/hooks/use-property-matches.ts` (líneas 132-144)

- Si `property.price <= budget_max` → match exacto: `💰 Presupuesto compatible`
- Si `property.price <= budget_max * 1.15` → match con tolerancia: `💰 Presupuesto negociable (~X% sobre máx.)`
- Ambos cuentan como criterio válido para el matching

Ejemplo concreto: cliente con budget_max = 160K, propiedad = 170K → 170/160 = 1.0625 = 6.25% sobre máximo → aparece como "Presupuesto negociable (~6% sobre máx.)"

Si la propiedad fuera 190K → 18.75% sobre máximo → NO matchea (excede 15%).

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/hooks/use-property-matches.ts` | Agregar lógica de tolerancia 15% en budget match |

Un cambio muy acotado, solo en la sección de budget match (líneas 132-144).

