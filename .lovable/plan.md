
## Alan como asistente todo en uno: Mini-CRM con gestión de clientes orquestada por IA

### Concepto central

Alan deja de ser solo un buscador de propiedades y pasa a ser el asistente operativo completo del agente. Todo se hace hablando con él: crear clientes, actualizarlos, ver su historial, clasificar conversaciones. Sin formularios, sin pantallas adicionales.

---

### Qué se va a construir

**1. Base de datos — Tabla `clients` + columnas en `conversations`**

Nueva tabla `clients`:
```text
id, user_id, full_name, phone, email, notes, status (prospect/active/closed), created_at, updated_at
```

Columnas nuevas en `conversations`:
- `client_id` (uuid, nullable, FK a clients)
- `conversation_type` (text, nullable: 'search' | 'email' | 'followup' | 'general')

Con RLS: solo el agente dueño puede leer/escribir sus clientes.

---

**2. Nuevas herramientas para Alan (edge function `chat/index.ts`)**

Se agregan 5 tools al array existente:

- **`create_client`** — Crea un perfil: nombre, teléfono, email, notas, estado
- **`update_client`** — Actualiza cualquier campo de un cliente por su ID
- **`list_clients`** — Lista clientes del agente, con filtro opcional por estado o búsqueda por nombre
- **`get_client`** — Detalle completo de un cliente: datos + historial de conversaciones vinculadas
- **`link_conversation`** — Vincula la conversación actual a un cliente y/o le asigna un tipo. Usa el `conversationId` que ya llega en el body del request, sin que el usuario tenga que saberlo.

Cada herramienta usa el `userId` ya disponible en la función (obtenido del token de auth) para garantizar que los agentes solo acceden a sus propios datos.

---

**3. Prompt del sistema actualizado**

Se agrega una sección en `SYSTEM_PROMPT` con instrucciones sobre cuándo y cómo usar las nuevas herramientas:

- Cuando el agente mencione trabajar "para [nombre de persona]", Alan debe buscar primero si existe ese cliente con `list_clients`, y si no existe, ofrecerse a crearlo.
- Alan debe vincular la conversación al cliente automáticamente (`link_conversation`) cuando se confirme o cree el perfil.
- Alan asigna el tipo de conversación según el contexto: búsqueda de propiedad → 'search', redacción de email/WhatsApp → 'email', seguimiento → 'followup', consulta general → 'general'.
- Cuando el agente pida ver un cliente o su historial, Alan usa `get_client`.
- Alan confirma las acciones de forma natural y concisa, sin tecnicismos.

Ejemplo de flujo natural:
```
Agente: "Busco un depto para María González, 3 amb, Nueva Córdoba"
Alan: [busca propiedades] + [crea/encuentra cliente + vincula conversación en background]
Alan: "Encontré 8 propiedades para María. Acá te muestro las mejores..."
```

---

**4. Sidebar — indicador visual de cliente vinculado**

En `Chat.tsx`, el query de `loadConversations` agrega un LEFT JOIN a `clients` para traer `client_name` y `conversation_type`.

En `ConversationList.tsx`, se actualiza la interfaz `Conversation` y el render de cada item para mostrar:
- Badge de tipo con emoji (🔍 búsqueda, ✉️ email, 🔔 seguimiento, 💬 general)
- Nombre del cliente debajo del título en texto más pequeño (color muted)

---

### Archivos a modificar

**Base de datos (migración SQL):**
- Crear tabla `clients` con RLS (solo owner puede CRUD)
- Agregar columnas `client_id` y `conversation_type` a `conversations`
- Agregar trigger `update_updated_at_column` a `clients`

**`supabase/functions/chat/index.ts`:**
- Agregar 5 nuevas tool definitions al array `tools`
- Agregar cases en `executeTool()` para cada herramienta nueva
- Agregar sección en `SYSTEM_PROMPT` con instrucciones del CRM

**`src/pages/Chat.tsx`:**
- Actualizar `loadConversations` para hacer JOIN con `clients` y obtener `client_name` y `conversation_type`
- Extender la interfaz `Conversation` local con los nuevos campos

**`src/components/ConversationList.tsx`:**
- Extender interfaz `Conversation` con `client_name?: string` y `conversation_type?: string`
- Renderizar badge de tipo y nombre de cliente en cada ítem de la lista

---

### Lo que NO cambia

- El flujo del chat es idéntico — el usuario no toca ningún formulario nuevo
- No se agrega ninguna pantalla ni ruta nueva
- Las conversaciones existentes no se ven afectadas (las nuevas columnas son nullable)
- La experiencia es 100% conversacional, Alan es el punto de entrada

---

### Seguridad

- Las herramientas de clientes verifican que `userId` exista antes de operar
- Todas las queries usan el `userId` del token autenticado, nunca un ID enviado por el cliente
- RLS en la tabla `clients` garantiza aislamiento entre agentes a nivel de base de datos
- Se reutilizan las mismas funciones de sanitización (`sanitizePattern`, `safePositiveInt`) ya existentes
