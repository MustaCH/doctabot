Detecté la causa principal: Alan está usando nombres de estado antiguos (`inactive`, `active`, `prospect`, `closed`) en el prompt, pero la base real del CRM solo acepta la escala de temperatura: `hot`, `warm`, `cold`. Por eso cuando Alan manda `status='inactive'`, la herramienta lo descarta como inválido y cae al valor por defecto `hot`.

Plan de implementación:

1. Alinear el prompt de Alan con los estados reales del CRM
   - Reemplazar la sección de estados antiguos por:
     - `hot`: caliente
     - `warm`: tibio
     - `cold`: frío
   - Indicar explícitamente que si el usuario dice “frío”, “inactivo”, “sin actividad”, “baja prioridad” o similares, Alan debe enviar `status='cold'`, no `inactive`.

2. Hacer la herramienta más tolerante a sinónimos
   - Agregar una normalización centralizada de estados antes de crear o actualizar clientes.
   - Mapear automáticamente:
     - `inactive`, `frio`, `frío`, `cold`, `sin actividad`, `inactivo` → `cold`
     - `active`, `warm`, `tibio`, `seguimiento` → `warm`
     - `prospect`, `hot`, `caliente`, `interesado` → `hot`
   - Aplicar esta normalización tanto en `create_client` como en `update_client`.

3. Evitar falsos “creado como caliente”
   - Cambiar la lógica actual que ante un estado inválido crea el cliente como `hot` silenciosamente.
   - Si Alan manda un estado reconocible pero antiguo como `inactive`, quedará como `cold`.
   - Si manda un estado totalmente desconocido, recién ahí se usará el default `hot`, pero el prompt debería evitarlo.

4. Revisar carga/importación de contactos
   - Mantener coherencia con la escala `hot/warm/cold` en los puntos de carga masiva.
   - Donde hoy la importación visual fija `status: 'hot'`, no lo tocaría salvo que quieras que el importador permita elegir una calificación para toda la tanda. El bug reportado por Alan se explica por la herramienta conversacional, no por el importador visual.

5. Desplegar y verificar
   - Desplegar nuevamente la función `chat`.
   - Probar casos como:
     - “Creá a Mauri Quiñones como frío” → debe quedar `cold`.
     - “Cargalo como inactivo” → debe quedar `cold`.
     - “Cambiá a Pacho a tibio” → debe quedar `warm`.
     - “Cambiá a X a caliente” → debe quedar `hot`.

Archivos a modificar:
- `supabase/functions/chat/_shared/prompt.ts`
- `supabase/functions/chat/_shared/tools/validators.ts`
- `supabase/functions/chat/_shared/tools/executor.ts`

No hace falta migración de base de datos: la tabla ya usa correctamente `hot`, `warm`, `cold`; el problema está en la interpretación y validación de Alan.