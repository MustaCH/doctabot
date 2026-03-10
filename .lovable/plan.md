

## Plan: Sistema de Supervisión de Respuestas de Alan

### Concepto

Agregar una capa de validación invisible entre la respuesta final de Alan y su envío al usuario. Un segundo modelo (más rápido/barato, `gemini-2.5-flash-lite`) evalúa la respuesta contra la solicitud del usuario y decide si aprobarla o rechazarla. Si rechaza, Alan regenera la respuesta (máximo 2 reintentos). Todos los resultados de supervisión se registran en una tabla para análisis desde el Super Admin Panel.

### Cambios

#### 1. Nueva tabla `supervisor_logs`

```sql
CREATE TABLE public.supervisor_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  user_id uuid,
  user_message text NOT NULL,
  alan_response text NOT NULL,
  verdict text NOT NULL,          -- 'approved', 'rejected', 'error'
  rejection_reason text,          -- motivo si fue rechazada
  score integer,                  -- 1-10 calidad estimada
  retry_count integer DEFAULT 0,  -- cuántas veces se reintentó
  latency_ms integer,             -- tiempo que tomó la supervisión
  created_at timestamptz DEFAULT now()
);
```

RLS: solo lectura vía service role (admin-stats). Sin acceso público directo.

#### 2. Modificar Edge Function `chat/index.ts`

Después de obtener la respuesta final de Alan (línea ~1700) y antes de retornar el SSE:

- Llamar a `gemini-2.5-flash-lite` con un prompt de supervisor que recibe: mensaje del usuario + respuesta de Alan.
- El supervisor usa **tool calling** para retornar un JSON estructurado: `{ verdict: "approved"|"rejected", score: 1-10, reason: string }`.
- Si `verdict === "rejected"` y `retry_count < 2`: regenerar respuesta de Alan con feedback del supervisor.
- Registrar el log en `supervisor_logs`.
- Si el supervisor falla (error de red, timeout), aprobar por defecto y loguear como `verdict: "error"`.

```text
Usuario envía mensaje
        ↓
  Alan genera respuesta (existente)
        ↓
  Supervisor evalúa (gemini-2.5-flash-lite)
        ↓
  ¿Aprobada? → Sí → Devolver respuesta + log
             → No → Regenerar con feedback (max 2 reintentos) → log
```

#### 3. Modificar Edge Function `admin-stats/index.ts`

Agregar acciones:
- `"supervisor-stats"`: totales de approved/rejected/error, tasa de aprobación, score promedio, últimos 30 días agrupados por día.
- `"supervisor-logs"`: listado paginado con búsqueda, incluyendo nombre del usuario.

#### 4. Modificar `SuperAdmin.tsx`

Agregar nueva pestaña **"Supervisor"** con:
- **Cards resumen**: total evaluaciones, tasa de aprobación (%), score promedio, errores críticos.
- **Gráfico de línea**: aprobaciones vs rechazos por día (últimos 30 días).
- **Tabla de logs**: fecha, usuario, extracto del mensaje, extracto de respuesta, veredicto (badge color), score, motivo de rechazo, reintentos. Con paginación, búsqueda y exportación CSV.
- **Filtros**: por veredicto (approved/rejected/error) y por rango de score.

### Consideraciones técnicas

- **Latencia**: el supervisor agrega ~1-2s por request (flash-lite es rápido). El usuario solo ve "Alan pensando" un poco más.
- **Costo**: flash-lite es el modelo más barato disponible, ideal para evaluación rápida.
- **Resiliencia**: si el supervisor falla, la respuesta pasa igual (fail-open) para no bloquear al usuario.
- **Prompt del supervisor**: evaluará relevancia, precisión, formato correcto (tarjetas, borradores), y ausencia de alucinaciones.

