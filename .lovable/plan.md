

## Plan: Mejorar importación de clientes con mapeo inteligente de campos

### Problema

Actualmente la IA solo identifica 4 columnas (nombre, teléfono, email, tipo de cliente) y todo lo demás va a "notas". Los campos específicos del cliente como `preferred_zones`, `budget_min`, `budget_max`, `property_type_interest`, `birthday`, `company`, `address`, `source` nunca se completan desde la importación.

### Solución

Ampliar el mapeo de la IA para que detecte columnas adicionales y las asigne a los campos específicos de la tabla `clients`. Además, migrar de la API directa de Gemini al Lovable AI Gateway.

### Cambios

**1. Edge function `supabase/functions/parse-client-import/index.ts`**

- Migrar de `GEMINI_API_KEY` + API directa de Google → `LOVABLE_API_KEY` + Lovable AI Gateway
- Ampliar el prompt para que la IA identifique también columnas de: `preferred_zones`, `budget_min`, `budget_max`, `property_type_interest`, `birthday`, `company`, `address`, `source`
- Agregar estos campos al tool schema `map_columns`:
  - `preferred_zones_column` (int, -1 si no existe)
  - `budget_min_column` (int)
  - `budget_max_column` (int)
  - `property_type_interest_column` (int)
  - `birthday_column` (int)
  - `company_column` (int)
  - `address_column` (int)
  - `source_column` (int)
- Actualizar `extra_columns` para que excluya las columnas ya mapeadas a campos específicos

**2. Frontend `src/components/ImportClientsDialog.tsx`**

- Actualizar `ColumnMapping` interface con los nuevos campos
- Actualizar `applyMapping()` para extraer los valores de las columnas mapeadas y asignarlos a los campos específicos del `ParsedClient` (budget_min, budget_max, preferred_zones, etc.)
- Actualizar la preview para mostrar badges de los campos adicionales mapeados (ej: "🏠 Zona → Barrio", "💰 Presupuesto → Monto")
- Pasar los campos específicos al insert de Supabase (ya están en el tipo `ParsedClient`, solo falta llenarlos)

### Detalle técnico

El prompt actualizado indicará a la IA que busque columnas como "Zona", "Barrio", "Ubicación" → `preferred_zones`; "Presupuesto", "Monto", "Budget" → `budget_min`/`budget_max`; "Tipo de propiedad", "Busca", "Que quiere" → `property_type_interest`; "Cumpleaños", "Fecha nac" → `birthday`; "Empresa", "Inmobiliaria" → `company`; "Dirección" → `address`; "Fuente", "Origen", "Cómo llegó" → `source`.

| Archivo | Cambio |
|---|---|
| `supabase/functions/parse-client-import/index.ts` | Migrar a Lovable AI Gateway, ampliar prompt y tool schema con 8 campos adicionales |
| `src/components/ImportClientsDialog.tsx` | Actualizar ColumnMapping, applyMapping y preview para usar los nuevos campos |

