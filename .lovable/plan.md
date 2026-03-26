## Reportes para Super Admin Panel — Plan

### Objetivo

Agregar una nueva tab "Reportes" al panel Super Admin que genere reportes listos para mostrar a tu cliente, con métricas de uso, satisfacción y calidad del agente IA.

### Reportes propuestos

1. **Uso por usuario** — Mensajes enviados, conversaciones creadas, clientes gestionados, favoritos guardados por cada usuario. Ranking de usuarios más activos.
2. **Tasa de aprobación del Supervisor** — % de mensajes aprobados/rechazados/error del supervisor, score promedio global y por usuario, tendencia en el tiempo.
3. **Satisfacción estimada** — Análisis básico de los mensajes del usuario: longitud promedio de conversación (más turnos = más engagement), tasa de retorno (usuarios que vuelven a usar el chat), ratio de conversaciones con herramientas ejecutadas vs solo texto.
4. **Retención y engagement** — Usuarios activos por día/semana en los últimos 30 días, días desde último mensaje por usuario (detectar usuarios inactivos).
5. **Resumen ejecutivo exportable** — Botón para descargar CSV con todas las métricas consolidadas.

### Implementación técnica

**1. Backend — Nueva acción en `admin-stats` edge function**

- Agregar acción `"user-reports"` que calcule por usuario: total mensajes, conversaciones, clientes, favoritos, último mensaje, promedio de mensajes por conversación.
- Agregar acción `"satisfaction-report"` que calcule: longitud promedio de conversaciones, usuarios recurrentes, engagement metrics.
- La acción `"supervisor-stats"` ya existe y se reutiliza para la tasa de aprobación y score promedio.

**2. Frontend — Nueva tab "Reportes" en SuperAdmin.tsx**

- Componente `ReportsPanel` con sub-secciones:
  - **Tabla de uso por usuario** con columnas: nombre, mensajes, conversaciones, clientes, favoritos, última actividad.
  - **Cards de métricas del supervisor**: tasa aprobación, score promedio, errores.
  - **Gráfico de engagement**: mensajes por día superpuesto con usuarios activos.
  - **Distribución de clientes** por estado (hot/warm/cold).
- Botón "Exportar CSV" para cada sección.
- Recharts para visualizaciones (ya está instalado).

**3. Archivos a modificar**

- `supabase/functions/admin-stats/index.ts` — Agregar acciones `user-reports` y `satisfaction-report`
- `src/pages/SuperAdmin.tsx` — Agregar tab "Reportes" y componente `ReportsPanel`
- Desplegar edge function actualizada

### Tabs actualizadas

Overview | Supervisor | **Reportes** | Propiedades | Usuarios | Conversaciones | Favoritos | Clientes