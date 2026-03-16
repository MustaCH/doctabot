

# Plan: Evolución a CRM Inmobiliario Completo

## Estado actual

La app ya cuenta con: chat con IA (Alan), gestión de clientes con perfiles enriquecidos, propiedades con búsqueda/filtros/favoritos, vinculación cliente-propiedad, eventos con sync a Google Calendar, dashboard con pipeline/alertas, importación CSV/Excel, y panel de super admin.

---

## Nuevas funcionalidades propuestas

### 1. Búsqueda global unificada
- Barra de búsqueda accesible desde cualquier pantalla (header global) que busque simultáneamente en clientes, propiedades y conversaciones.
- Resultados agrupados por categoría con navegación directa.

### 2. Ficha de cliente enriquecida (página dedicada)
- Crear una ruta `/clients/:id` con vista completa del cliente: datos personales, propiedades vinculadas, timeline de interacciones, eventos, y notas.
- **Timeline de actividad**: registro cronológico de acciones (propiedad vinculada, estado cambiado, evento creado, conversación iniciada).
- Requiere nueva tabla `client_activity_log` (client_id, user_id, action_type, description, metadata jsonb, created_at).

### 3. Notas y seguimiento por cliente
- Agregar un sistema de notas rápidas (tipo sticky notes) vinculadas a cada cliente, con fecha y posibilidad de marcar como "acción pendiente".
- Tabla `client_notes` (id, client_id, user_id, content, is_action, is_done, created_at).
- Mostrar notas pendientes en el Dashboard como "Tareas del día".

### 4. Matching automático propiedad-cliente
- Cuando se carga una nueva propiedad o se actualiza una existente, Alan sugiere automáticamente clientes que podrían estar interesados basándose en: zonas preferidas, rango de presupuesto, tipo de propiedad buscada.
- Botón "Ver matches" en cada propiedad y notificación en el dashboard.
- Implementación: query en el frontend que cruza `clients.preferred_zones`, `budget_min/max`, y `property_type_interest` contra los datos de la propiedad.

### 5. Compartir propiedad por WhatsApp/Email
- Botón en la tarjeta de propiedad para generar un mensaje pre-armado con foto, precio, ubicación y link, listo para enviar por WhatsApp (vía `wa.me` deep link) o copiar al portapapeles.
- Opción de enviar por email usando la integración de Gmail ya existente (tool `send_email`).

### 6. Kanban visual de propiedades por cliente
- En la ficha del cliente, mostrar las propiedades vinculadas como un board Kanban con columnas: Sugerida → Enviada → Visitada → (Cerrada / Descartada).
- Drag & drop para cambiar estado (en desktop), tap para cambiar en mobile.

### 7. Recordatorios y notificaciones push
- Implementar notificaciones push vía Service Worker (ya existe `use-sw-update.ts`).
- Notificar: eventos del día, clientes estancados, nuevas propiedades que matchean con algún cliente.
- Tabla `notification_preferences` para configurar qué notificaciones recibir.

### 8. Reportes y métricas avanzadas
- Expandir el Dashboard con:
  - **Gráfico de embudo**: Prospectos → Activos → Cerrados (conversión).
  - **Propiedades más compartidas/visitadas** (basado en `client_properties`).
  - **Actividad semanal**: gráfico de barras con acciones por día.
  - **Tasa de conversión**: % de prospectos que pasan a activos y a cerrados.

### 9. Etiquetas/Tags personalizados
- Permitir al agente crear tags de colores para organizar clientes (ej: "Urgente", "VIP", "Inversor", "Primera vivienda").
- Tabla `tags` (id, user_id, name, color) y `client_tags` (client_id, tag_id).
- Filtrar clientes por tags en la lista.

### 10. Historial de interacciones con el cliente
- Registrar automáticamente cuándo se envía una propiedad, se realiza una visita, se llama, etc.
- Actualizar `last_contact_at` automáticamente al vincular propiedades o crear eventos.
- Mostrar este historial en la ficha del cliente.

---

## Mejoras generales de UX

### A. Navegación inferior persistente (mobile)
- Reemplazar la navegación actual (que obliga a ir a Perfil para acceder a otras secciones) con una bottom navigation bar fija con iconos: Chat, Propiedades, Clientes, Dashboard, Perfil.
- Esto reduce la fricción y mejora la navegabilidad drásticamente.

### B. Modo oscuro persistente
- Agregar toggle de tema claro/oscuro en Perfil, persistido en localStorage.

### C. Pull-to-refresh
- En listas de clientes y propiedades, implementar pull-to-refresh para actualizar datos.

### D. Estados vacíos mejorados
- Ilustraciones y CTAs claros cuando no hay clientes, propiedades favoritas, o eventos.

### E. Búsqueda dentro de la lista de clientes
- Agregar campo de búsqueda por nombre/teléfono/email en el header de Clientes (actualmente solo filtra por tipo).

---

## Esquema de base de datos (nuevas tablas)

```text
client_activity_log
├── id (uuid, PK)
├── client_id (uuid, FK → clients)
├── user_id (uuid)
├── action_type (text: 'property_linked', 'status_changed', 'note_added', 'event_created', 'call_logged')
├── description (text)
├── metadata (jsonb)
└── created_at (timestamptz)

client_notes
├── id (uuid, PK)
├── client_id (uuid, FK → clients)
├── user_id (uuid)
├── content (text)
├── is_action (boolean, default false)
├── is_done (boolean, default false)
└── created_at (timestamptz)

tags
├── id (uuid, PK)
├── user_id (uuid)
├── name (text)
├── color (text)
└── created_at (timestamptz)

client_tags
├── id (uuid, PK)
├── client_id (uuid, FK → clients)
├── tag_id (uuid, FK → tags)
└── created_at (timestamptz)
```

---

## Orden de implementación sugerido

| Prioridad | Feature | Impacto |
|-----------|---------|---------|
| 1 | **Navegación inferior persistente** | Alto — mejora toda la experiencia |
| 2 | **Búsqueda de clientes** | Alto — funcionalidad básica faltante |
| 3 | **Compartir propiedad por WhatsApp** | Alto — uso diario del agente |
| 4 | **Matching automático propiedad-cliente** | Alto — diferenciador clave |
| 5 | **Ficha de cliente dedicada con timeline** | Alto — visión 360° del cliente |
| 6 | **Notas/tareas por cliente** | Medio — seguimiento estructurado |
| 7 | **Tags personalizados** | Medio — organización flexible |
| 8 | **Kanban de propiedades por cliente** | Medio — visualización del proceso |
| 9 | **Reportes avanzados** | Medio — insights para el agente |
| 10 | **Notificaciones push** | Medio — engagement y retención |

