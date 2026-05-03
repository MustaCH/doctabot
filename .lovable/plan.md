## Plan: Corregir lógica de presupuesto de clientes

### Problema

Cuando el agente carga un solo valor de presupuesto, el sistema lo guarda en `budget_min` y lo muestra como "Desde USD X". Esto es incorrecto: un solo dato de presupuesto representa el **maximo** que el cliente puede pagar.

Datos reales: 27 clientes tienen `budget_min` sin `budget_max`. Son todos casos donde el agente puso un solo número que deberia ser el tope.

Ademas, el sistema de matching no usa los campos estructurados de presupuesto (solo extrae numeros de las notas), y la tolerancia es 15% en vez de 30%.

### Cambios

#### 1. Migrar datos existentes (SQL migration)

Mover `budget_min` a `budget_max` en todos los registros donde solo hay `budget_min` y no `budget_max`:

```sql
UPDATE clients 
SET budget_max = budget_min, budget_min = NULL 
WHERE budget_min IS NOT NULL AND budget_max IS NULL;
```

#### 2. Corregir las tool definitions del AI (edge function)

En `supabase/functions/chat/_shared/tools/definitions.ts`:
- Cambiar la descripcion de `budget_min` y `budget_max` para que el AI entienda: si el cliente dice un solo numero, ponerlo en `budget_max`.
- Descripcion de budget_max: "Presupuesto maximo del cliente. Si el cliente menciona un solo número, usarlo aqui."
- Descripcion de budget_min: "Presupuesto minimo (solo si el cliente da un rango explicito con dos valores)"

Hacer lo mismo en el bloque de `update_client`.

#### 3. Corregir el display en la lista de clientes

En `src/pages/Clients.tsx`, funcion `formatBudget`:
- Cuando solo hay `budget_min` (sin max): mostrar "Hasta USD X" en vez de "Desde USD X" (por si quedan datos legacy).
- Mejor aun: tratarlo como max conceptualmente.

#### 4. Agregar matching estructurado de presupuesto

En `src/hooks/use-property-matches.ts`, despues de la seccion de Type matching (linea 357), agregar logica real de budget:

- Si el cliente tiene `budget_max`: la propiedad matchea si `property.price <= budget_max * 1.30`
- Si el cliente tiene `budget_min` y `budget_max`: la propiedad matchea si `property.price >= budget_min * 0.85` AND `property.price <= budget_max * 1.30`
- Agregar razon "Presupuesto" a los matches
- Misma moneda (o ignorar si no hay dato de moneda)

#### 5. Actualizar tolerancia en notas

En `use-property-matches.ts`, cambiar `BUDGET_TOLERANCE` de 1.15 a 1.30.

#### 6. Corregir morning-matches (edge function)

En `supabase/functions/morning-matches/index.ts`:
- Misma logica: si solo hay `budget_min`, tratarlo como max
- Ajustar tolerancia a 30%

### Archivos a modificar

- Nueva migracion SQL (data fix)
- `supabase/functions/chat/_shared/tools/definitions.ts` (descripciones AI)
- `src/pages/Clients.tsx` (display)
- `src/hooks/use-property-matches.ts` (matching + tolerancia)
- `supabase/functions/morning-matches/index.ts` (matching backend)
- Memoria: `mem://features/crm-matching-automatico.md`
