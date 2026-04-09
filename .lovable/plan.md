

## Plan: Fix de eliminación de cliente Paula + Mejoras de matching y UI

### Problema real con Paula

Paula (`5e6e8df3...`) **sigue existiendo** en la base de datos de Marcelo a pesar de múltiples intentos de borrado. El código de eliminación se ve correcto, pero hay un problema sutil: el `AlertDialogAction` del componente shadcn/ui **cierra el dialog antes de ejecutar el onClick**, lo que puede interrumpir el flujo async. Además, no hay verificación post-delete ni logging que permita diagnosticar fallas silenciosas.

### Cambios a implementar

#### 1. Fix definitivo del borrado de clientes
**Archivo:** `src/pages/ClientDetail.tsx`

- Cambiar `AlertDialogAction` por un `Button` dentro del `AlertDialog` que NO cierre automáticamente el dialog hasta que el delete se complete.
- Agregar verificación post-delete: después del `supabase.from("clients").delete()`, hacer un SELECT para confirmar que el registro ya no existe.
- Agregar logging detallado en cada paso del `Promise.all` para capturar qué query falla silenciosamente.
- Si el delete falla, mostrar un toast con el error específico.

#### 2. Eliminar manualmente a Paula de la DB
**Migración SQL:** Borrar el registro `5e6e8df3-ee1d-4564-afe7-1ca8dabe6737` directamente vía migración para resolver el problema inmediato de Marcelo.

#### 3. Mejorar algoritmo de matching (del plan anterior)
**Archivo:** `src/hooks/use-property-matches.ts`
- Requerir **al menos 2 criterios coincidentes** para mostrar un match (evitar falsos positivos solo por presupuesto).
- Fallback a `notes` si los campos estructurados están vacíos.

#### 4. Fix de botones superpuestos en cards
**Archivo:** `src/pages/Properties.tsx` o `src/components/PropertyCard.tsx`
- Mover botones de acción a una fila flex dentro del card body.

#### 5. Mostrar último contacto en diálogo de compatibles
**Archivo:** `src/components/PropertyMatchesDialog.tsx`
- Agregar `last_contact_at` formateado.

### Resumen de archivos

| Archivo | Cambio |
|---|---|
| `src/pages/ClientDetail.tsx` | Fix del dialog de eliminación + verificación post-delete |
| Migración SQL | Eliminar a Paula manualmente |
| `src/hooks/use-property-matches.ts` | Mínimo 2 criterios, fallback notas |
| `src/pages/Properties.tsx` | Fix layout botones superpuestos |
| `src/components/PropertyMatchesDialog.tsx` | Mostrar último contacto |

