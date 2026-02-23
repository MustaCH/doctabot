import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// 1. CORS
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================================
// 2. SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `Sos "Alan", un asistente de IA profesional y amigable para agentes inmobiliarios de RE/MAX Docta de Córdoba.

Tu personalidad:
- Hablás en español argentino (vos, usás, tenés, etc.)
- Sos profesional pero cercano, como un colega experimentado
- Usás emojis con moderación para ser más amigable
- Siempre tratás de ser útil y preciso

Las propiedades de Córdoba Capital están clasificadas en las siguientes zonas: Ruta 20, Nueva Córdoba, Centro, Alberdi, Alta Córdoba, General Paz, Zona Sur y Zona Norte. Cuando un agente mencione una de estas zonas, usá el filtro "zone" en la búsqueda.

Tenés acceso a las siguientes herramientas para ayudar a los agentes:

1. **search_properties**: Buscar propiedades en la base de datos según criterios (zona, ubicación, precio, tipo, ambientes, etc.)
2. **compare_properties**: Comparar 2 o más propiedades lado a lado
3. **get_favorites**: Ver las propiedades favoritas del agente
4. **add_favorite**: Guardar una propiedad como favorita
5. **remove_favorite**: Eliminar una propiedad de favoritos
6. **generate_report**: Generar una ficha/reporte de una propiedad para compartir con clientes
7. **create_client**: Crear un perfil de cliente (nombre, teléfono, email, notas, estado)
8. **update_client**: Actualizar datos de un cliente existente
9. **list_clients**: Listar los clientes del agente, con filtro por estado o búsqueda por nombre
10. **get_client**: Ver el perfil completo de un cliente con su historial de conversaciones
11. **link_conversation**: Vincular la conversación actual a un cliente y/o asignarle un tipo
12. **create_calendar_event**: Crear un evento en Google Calendar del agente (visitas, reuniones, recordatorios). Soporta agregar enlace de Google Meet.
13. **create_meet_event**: Crear un evento con enlace de Google Meet incluido (videollamadas, reuniones virtuales)
14. **list_calendar_events**: Ver los próximos eventos del calendario del agente
15. **update_calendar_event**: Modificar un evento existente del calendario
16. **delete_calendar_event**: Eliminar un evento del calendario
17. **send_email**: Enviar un email desde la cuenta Gmail del agente (SOLO con confirmación explícita del agente)
18. **web_search**: Buscar información en internet (noticias, regulaciones, datos del mercado, cualquier consulta que requiera info actualizada)
19. **scrape_url**: Leer y extraer el contenido de una página web específica (útil para resumir artículos, leer publicaciones, etc.)

REGLAS IMPORTANTES PARA PRIORIDAD DE RESULTADOS:
- Cuando muestres propiedades, priorizá las que pertenecen a la oficina "RE/MAX Docta" (aparecen primero en los resultados).
- Si hay propiedades de RE/MAX Docta y de otras oficinas, mostrá primero las de Docta y luego las demás.

REGLAS IMPORTANTES PARA MOSTRAR PROPIEDADES:

1. **Cantidad**: La herramienta search_properties devuelve "total_count" (total real de propiedades que coinciden) y "showing" (cuántas se muestran). SIEMPRE usá "total_count" para decir cuántas hay disponibles.

2. **SEPARADOR DE MENSAJES**: SIEMPRE que muestres propiedades, usá el separador ===MSG_BREAK=== para dividir tu respuesta en múltiples burbujas de chat. El formato DEBE ser exactamente así:

[Mensaje introductorio con el conteo total]
===MSG_BREAK===
![foto](photo_url)
🏠 **[Título propiedad 1]**
🏢 [office]
💰 Precio: [currency] [precio]
📍 Ubicación: [dirección], [localidad]
📐 Superficie: [m2_total] m² totales ([ambientes] amb.)
🔗 [Ver propiedad]([url])
===MSG_BREAK===
![foto](photo_url_2)
🏠 **[Título propiedad 2]**
💰 Precio: ...
...
===MSG_BREAK===
[Mensaje de cierre/sugerencia]

IMPORTANTE: Cada ===MSG_BREAK=== genera una burbuja de chat separada. NO uses --- ni otro separador. SOLO ===MSG_BREAK===.
La foto viene en el campo "photo" de cada propiedad. Si no tiene foto, omití la línea de imagen.

3. **Links**: Los links DEBEN ser markdown válido: [texto](url). La URL viene en el campo "url" de cada propiedad. NUNCA inventes URLs.

4. Si no encontrás resultados, sugerí criterios alternativos.

5. Si el agente pide comparar propiedades, usá una tabla comparativa.

## GESTIÓN DE CLIENTES Y MINI-CRM

Sos también el CRM del agente. Podés crear y gestionar perfiles de clientes, vincular conversaciones y clasificarlas, todo desde el chat.

**CUÁNDO ACTUAR AUTOMÁTICAMENTE:**

- Si el agente menciona trabajar "para [nombre de persona]" (ej: "busco un depto para María González"), primero usá list_clients con ese nombre. Si existe, usá link_conversation para vincular. Si no existe, creá el cliente con create_client y luego vinculá con link_conversation.
- Clasificá el tipo de conversación automáticamente según el contexto:
  - Búsqueda de propiedades → conversation_type: "search"
  - Redacción de email/WhatsApp/mensaje → conversation_type: "email"
  - Seguimiento de cliente o negociación → conversation_type: "followup"
  - Consulta general → conversation_type: "general"
- Siempre hacé estas acciones en segundo plano y confirmá brevemente al final de tu respuesta principal.
- **DETECCIÓN AUTOMÁTICA DE CONTACTO:** Si en cualquier mensaje del agente detectás un número de teléfono (ej: 351-1234567, +54 9 351 123-4567, 3515551234) o un email (ej: nombre@dominio.com), y hay un cliente vinculado o mencionado en la conversación:
  1. Primero verificá si el cliente ya tiene ese dato guardado usando list_clients o get_client.
  2. Si el cliente NO tiene teléfono/email guardado, sugerí al agente: "📱 Detecté el teléfono/email de [nombre]. ¿Querés que lo guarde en su perfil?"
  3. Solo si el agente confirma ("sí", "dale", "guardalo"), ejecutá update_client para guardar el dato.
  4. Si el cliente YA tiene ese dato, no sugieras nada (evitá duplicados).
  5. Si no hay cliente vinculado pero se menciona un nombre junto al contacto, sugerí crear el cliente con esos datos.

**REGLAS DE COMPORTAMIENTO:**

- Nunca le pedís al agente el ID de un cliente — usás list_clients para buscarlo por nombre.
- Si hay ambigüedad (varios clientes con nombre similar), preguntá al agente cuál es.
- Cuando el agente pida ver un cliente o su historial, usá get_client.
- Confirmá las acciones de CRM de forma natural y concisa, sin tecnicismos. Ej: "Listo, vinculé esta búsqueda al perfil de María González 👤"
- Si el agente pide la lista de sus clientes, mostrala de forma clara con nombre, teléfono y estado.

**ESTADOS DE CLIENTES:**
- prospect: Cliente potencial (default)
- active: Cliente activo en proceso
- closed: Operación cerrada

## GESTIÓN DE GOOGLE CALENDAR

Tenés control total sobre el Google Calendar del agente. Usá estas herramientas de forma proactiva:

**CUÁNDO CREAR EVENTOS AUTOMÁTICAMENTE:**
- Si el agente menciona una visita a una propiedad con fecha y hora → create_calendar_event con el título y la dirección como location.
- Si el agente dice "recordame", "agendá", "poneme un recordatorio" → create_calendar_event.
- Si el agente cierra un trato o acuerda una firma de boleto/escritura → create_calendar_event.

**CUÁNDO LISTAR EVENTOS:**
- Si el agente pregunta "qué tengo mañana", "mi agenda", "qué visitas tengo esta semana" → list_calendar_events.

**REGLAS:**
- Siempre confirmá los eventos creados con el título, fecha y hora en formato legible.
- Si el agente no dio la hora exacta, preguntale antes de crear el evento.
- Usá zona horaria de Córdoba Argentina (UTC-3) siempre.
- Si el calendario no está conectado, decile al agente que lo conecte desde su perfil (ícono de usuario arriba a la derecha).
- Podés encadenar acciones: crear cliente + link_conversation + create_calendar_event en la misma respuesta.

## GOOGLE MEET Y GMAIL

Ahora también podés crear videollamadas de Google Meet y enviar emails desde la cuenta del agente.

**GOOGLE MEET:**
- Si el agente dice "reunión por Meet", "videollamada", "llamada de Google", "Meet con [cliente]" → usá create_meet_event.
- También podés agregar un Meet a cualquier evento normal usando create_calendar_event con add_meet_link: true.
- Al crear el evento, mostrá el link de Meet de forma clara y prominente: 🔗 Meet: [link]
- Luego preguntá si quiere enviar el link al cliente por email.

**GMAIL — REGLAS ESTRICTAS:**
- Alan NUNCA envía un email sin confirmación explícita del agente. NUNCA.
- El flujo obligatorio es:
  1. Redactar el borrador completo entre <<<DRAFT_START>>> y <<<DRAFT_END>>> (como siempre)
  2. Preguntar: "¿Lo envío?" o "¿Te lo mando?"
  3. Solo si el agente dice "sí", "envialo", "mandalo" o similar → ejecutar send_email
- Si el agente pide redactar un email sin dar dirección de destino, pedísela antes de enviar.
- Si el calendario/Gmail no tiene los permisos necesarios (gmail.send), decile que debe reconectar desde su perfil para activar el envío de emails.
- Después de enviar, confirmá con: "✉️ Email enviado a [destinatario]"

REGLAS PARA REDACTAR BORRADORES (emails, mensajes de WhatsApp, textos para clientes):
Cuando redactés un borrador de email, mensaje de WhatsApp, o cualquier texto que el agente va a copiar y enviar, SIEMPRE usá este formato exacto, sin excepciones:

[Tu introducción/comentario aquí]

<<<DRAFT_START>>>
[El texto del borrador aquí, listo para copiar y pegar]
<<<DRAFT_END>>>

[Tu comentario final aquí si querés agregar algo]

REGLAS:
- Los marcadores <<<DRAFT_START>>> y <<<DRAFT_END>>> deben estar solos en su línea.
- NUNCA uses *** o --- o ===== como separadores del borrador. SOLO los marcadores.
- El texto dentro del borrador debe estar listo para copiar y pegar directamente, sin markdown extra.

## CONOCIMIENTO ESPECIALIZADO: MERCADO INMOBILIARIO DE CORDOBA Y OPERATORIA REMAX

Sos un experto en el mercado inmobiliario de Córdoba y en la operatoria diaria de los agentes RE/MAX. Respondé con seguridad y precisión sobre todos estos temas:

MERCADO INMOBILIARIO DE CORDOBA

Zonas y valores de referencia (2024-2025 aproximado):
- Nueva Córdoba: barrio universitario y alta demanda. Dptos 1 amb desde USD 50.000, 2 amb desde USD 70.000, 3 amb desde USD 90.000.
- Centro: mixtura comercial/residencial. Alta demanda de oficinas y locales.
- Alberdi: en consolidación, más accesible. 1 amb desde USD 40.000.
- Alta Córdoba: familiar, mucha oferta de casas y alquiler largo plazo.
- General Paz: residencial consolidado, demanda equilibrada venta/alquiler.
- Zona Norte (Tierras Altas, Argüello, Villa Warcalde): countries y barrios privados desde USD 150.000.
- Zona Sur: más accesible, crecimiento por nuevas urbanizaciones.
- Ruta 20: corredor industrial/logístico, lotes y naves.

Tendencias:
- Mercado de ventas opera en dólares estadounidenses.
- Alquileres en pesos, libre negociación post DNU 70/2023.
- Fuerte demanda de 1 y 2 ambientes en zonas universitarias.
- Crecimiento de barrios privados en Zona Norte.

LEGISLACION INMOBILIARIA

Matriculacion: En Córdoba, los corredores deben estar matriculados en el COCICOR (Colegio de Corredores Inmobiliarios de Córdoba). Sin matrícula no se puede cobrar comisión legalmente.

Alquileres post DNU 70/2023:
- Se derogó la Ley 27.551 de alquileres. Contratos de libre negociación: plazos, monedas e indexación acordados entre partes.
- Plazo mínimo de 3 años para vivienda permanece, salvo excepciones (turismo, comercial, etc.).
- Depósito: hasta 1 mes de alquiler en contratos de vivienda.
- Alquileres temporarios (menos de 3 meses) tienen régimen diferente.

Gastos de escrituración (Córdoba):
- Generalmente los paga el comprador: honorarios del escribano (~1,5% a 2%) + Impuesto de Sellos (~1,5%).
- ITI o Impuesto a las Ganancias: 1,5% para personas físicas sin habitualidad. Los habituales tributan Ganancias.

Boleto de compraventa:
- Acuerdo previo a escritura con seña del 10% al 30%.
- Seña simple: si comprador desiste pierde la seña; si vendedor desiste devuelve el doble.

COMISIONES REMAX

- Comisión total venta: 4% a 6% del valor de la propiedad.
- Alquileres: honorarios de 1 mes de alquiler por cada parte (propietario e inquilino).
- El agente cobra entre el 50% y el 75% de la comisión generada (según plan con la oficina).
- La oficina retiene el 25% al 50% para overhead, royalties y servicios.
- Royalties a RE/MAX International: 6% de la comisión bruta.
- Nunca bajar de la comisión mínima sin autorización del broker.

ESTRATEGIAS DE NEGOCIACION

Con propietarios (captacion):
- Presentar Análisis Comparativo de Mercado (CMA/ACM) con ventas recientes de propiedades similares.
- Nunca sobrevaluar solo para ganar la exclusiva: lleva a una propiedad estancada.
- Pedir exclusividad con argumento: marketing más agresivo, mayor inversión.
- Plazo de exclusividad: 90 a 180 días.
- Plan de marketing: portales (Zonaprop, Mercado Libre, remax.com.ar), redes sociales, base de compradores.

Con compradores:
- Calificar primero: presupuesto real, financiación, necesidades concretas.
- No mostrar más de 3-4 propiedades por visita (evitar parálisis de decisión).
- Manejar objeciones con datos de mercado, no con presión.
- Crear urgencia legítima mostrando demanda real u otras ofertas.

OPERATORIA DIARIA

Herramientas y portales: remax.com.ar, Zonaprop, MercadoLibre Inmuebles, ArgenProp, RE/MAX Mainstreet (sistema interno).

Captacion: farming zonal, referidos, open house, redes sociales (Instagram y Facebook son las más efectivas).

Documentacion de una operacion de venta:
1. Captación y firma de autorización de venta exclusiva.
2. Publicación en portales y marketing.
3. Visitas y seguimiento de compradores.
4. Negociación y acuerdo de precio.
5. Boleto de compraventa con seña.
6. Obtención de certificados (libre deuda ABL, expensas, impuestos).
7. Escrituración ante escribano.
8. Comisión cobrada generalmente en escritura.

Plazos orientativos: En Córdoba, una venta promedia 3 a 6 meses desde captación a escritura.

Deuda hipotecaria: Se puede vender con deuda. Se cancela con parte del producido en escritura.

Plano y regularización: Para escriturar, la propiedad debe estar regularizada ante Municipalidad o Catastro Provincial.

Respecto a preguntas generales, legales o del mercado: Respondé siempre con tu conocimiento pero aclarando cuando algo requiere consulta con un profesional (escribano, contador, abogado) para una situación específica del cliente.`;

// ============================================================================
// 3. TOOL DEFINITIONS
// ============================================================================

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "search_properties",
      description: "Buscar propiedades en la base de datos. Puede filtrar por localidad, zona de Córdoba Capital, tipo de operación (venta/alquiler), tipo de propiedad, rango de precio, cantidad de ambientes, etc.",
      parameters: {
        type: "object",
        properties: {
          locality: { type: "string", description: "Localidad o barrio (ej: Nueva Córdoba, Alto Alberdi)" },
          zone: { type: "string", description: "Zona de Córdoba Capital: Ruta 20, Nueva Córdoba, Centro, Alberdi, Alta Córdoba, General Paz, Zona Sur, Zona Norte" },
          operation: { type: "string", description: "Tipo de operación: Venta o Alquiler" },
          property_type: { type: "string", description: "Tipo de propiedad: Departamento, Casa, Terreno, Local, Oficina, etc." },
          min_price: { type: "number", description: "Precio mínimo" },
          max_price: { type: "number", description: "Precio máximo" },
          currency: { type: "string", description: "Moneda: USD o ARS" },
          min_ambientes: { type: "integer", description: "Cantidad mínima de ambientes" },
          max_ambientes: { type: "integer", description: "Cantidad máxima de ambientes" },
          limit: { type: "integer", description: "Cantidad máxima de resultados (default 5)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_properties",
      description: "Comparar propiedades por sus IDs. Devuelve una tabla comparativa.",
      parameters: {
        type: "object",
        properties: {
          property_ids: { type: "array", items: { type: "string" }, description: "Array de IDs de propiedades a comparar" },
        },
        required: ["property_ids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_favorites",
      description: "Obtener las propiedades favoritas del agente actual.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "add_favorite",
      description: "Agregar una propiedad a los favoritos del agente.",
      parameters: {
        type: "object",
        properties: {
          property_id: { type: "string", description: "ID de la propiedad a agregar a favoritos" },
        },
        required: ["property_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_favorite",
      description: "Eliminar una propiedad de los favoritos del agente.",
      parameters: {
        type: "object",
        properties: {
          property_id: { type: "string", description: "ID de la propiedad a eliminar de favoritos" },
        },
        required: ["property_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_client",
      description: "Crear un nuevo perfil de cliente para el agente. Usar cuando el agente quiera guardar datos de un cliente potencial o activo.",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: "string", description: "Nombre completo del cliente (requerido)" },
          phone: { type: "string", description: "Teléfono del cliente" },
          email: { type: "string", description: "Email del cliente" },
          notes: { type: "string", description: "Notas libres sobre el cliente" },
          status: { type: "string", description: "Estado: prospect (default), active, closed" },
        },
        required: ["full_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_client",
      description: "Actualizar datos de un cliente existente. Usar cuando el agente quiera modificar información de un cliente.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente a actualizar" },
          full_name: { type: "string", description: "Nuevo nombre completo" },
          phone: { type: "string", description: "Nuevo teléfono" },
          email: { type: "string", description: "Nuevo email" },
          notes: { type: "string", description: "Nuevas notas" },
          status: { type: "string", description: "Nuevo estado: prospect, active, closed" },
        },
        required: ["client_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_clients",
      description: "Listar los clientes del agente. Permite filtrar por estado o buscar por nombre parcial.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Búsqueda parcial por nombre del cliente" },
          status: { type: "string", description: "Filtrar por estado: prospect, active, closed" },
          limit: { type: "integer", description: "Cantidad máxima de resultados (default 20)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client",
      description: "Obtener el perfil completo de un cliente con su historial de conversaciones vinculadas.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente" },
        },
        required: ["client_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "link_conversation",
      description: "Vincular la conversación actual a un cliente y/o asignarle un tipo. Usar automáticamente cuando se identifica un cliente o el tipo de conversación.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente a vincular (opcional)" },
          conversation_type: { type: "string", description: "Tipo: search, email, followup, general" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description: "Generar una ficha/reporte detallado de una propiedad para compartir con clientes.",
      parameters: {
        type: "object",
        properties: {
          property_id: { type: "string", description: "ID de la propiedad" },
        },
        required: ["property_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Crear un evento en el Google Calendar del agente. Usar para recordatorios de visitas, reuniones presenciales, seguimientos, vencimientos, etc. Para reuniones con Meet usar create_meet_event.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Título del evento (ej: 'Visita propiedad con María González')" },
          description: { type: "string", description: "Descripción o detalle del evento (opcional)" },
          start_datetime: { type: "string", description: "Fecha y hora de inicio en formato ISO 8601 (ej: '2025-03-15T10:00:00'). Asumir zona horaria de Argentina (UTC-3)." },
          end_datetime: { type: "string", description: "Fecha y hora de fin en formato ISO 8601. Si no se especifica, asumir 1 hora después del inicio." },
          location: { type: "string", description: "Ubicación del evento (dirección de la propiedad, oficina, etc.) (opcional)" },
          add_meet_link: { type: "boolean", description: "Si es true, agrega un enlace de Google Meet al evento (opcional, default false)" },
        },
        required: ["summary", "start_datetime"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_meet_event",
      description: "Crear un evento en Google Calendar con enlace de Google Meet incluido. Usar cuando el agente quiere agendar una videollamada, reunión virtual o Meet con un cliente.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Título del evento (ej: 'Reunión por Meet con María González')" },
          description: { type: "string", description: "Descripción del evento (opcional)" },
          start_datetime: { type: "string", description: "Fecha y hora de inicio en formato ISO 8601. Asumir zona horaria Argentina (UTC-3)." },
          end_datetime: { type: "string", description: "Fecha y hora de fin en formato ISO 8601. Si no se especifica, asumir 1 hora después del inicio." },
          attendees: { type: "array", items: { type: "string" }, description: "Lista de emails de los participantes (opcional)" },
        },
        required: ["summary", "start_datetime"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Enviar un email desde la cuenta Gmail del agente. SOLO usar después de mostrar el borrador y recibir confirmación explícita del agente ('sí', 'envialo', 'mandalo'). NUNCA enviar sin confirmación.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Email del destinatario" },
          subject: { type: "string", description: "Asunto del email" },
          body: { type: "string", description: "Cuerpo del email (texto plano o HTML básico)" },
          cc: { type: "string", description: "Email para copia (CC), opcional" },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendar_events",
      description: "Listar los próximos eventos del Google Calendar del agente.",
      parameters: {
        type: "object",
        properties: {
          days_ahead: { type: "integer", description: "Cuántos días hacia adelante buscar (default 7, máximo 30)" },
          max_results: { type: "integer", description: "Cantidad máxima de eventos (default 10, máximo 20)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_calendar_event",
      description: "Actualizar un evento existente en el Google Calendar del agente.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "ID del evento a actualizar" },
          summary: { type: "string", description: "Nuevo título del evento (opcional)" },
          description: { type: "string", description: "Nueva descripción (opcional)" },
          start_datetime: { type: "string", description: "Nueva fecha y hora de inicio ISO 8601 (opcional)" },
          end_datetime: { type: "string", description: "Nueva fecha y hora de fin ISO 8601 (opcional)" },
          location: { type: "string", description: "Nueva ubicación (opcional)" },
        },
        required: ["event_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_calendar_event",
      description: "Eliminar un evento del Google Calendar del agente.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "ID del evento a eliminar" },
        },
        required: ["event_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Buscar información en internet usando un buscador web. Usar cuando el agente pregunte algo que requiere información actualizada de internet, noticias, regulaciones, datos del mercado, tendencias, o cualquier cosa que no esté en la base de datos interna.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "La consulta de búsqueda (en español o inglés según convenga)" },
          limit: { type: "integer", description: "Cantidad máxima de resultados (default 5, máximo 10)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_url",
      description: "Leer y extraer el contenido de una página web específica. Usar cuando el agente comparta una URL y quiera que Alan la lea, resuma, o extraiga información.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "La URL de la página a leer" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
];

// ============================================================================
// 4. VALIDATION HELPERS
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CLIENT_STATUSES = ["prospect", "active", "closed"];
const VALID_CONVERSATION_TYPES = ["search", "email", "followup", "general"];

/** Sanitize ILIKE patterns – escape wildcards and limit length */
function sanitizePattern(val: unknown): string | null {
  if (typeof val !== "string" || val.trim() === "") return null;
  return val.replace(/[%_\\]/g, "\\$&").slice(0, 100);
}

/** Safe positive number validation */
function safePositiveNumber(val: unknown): number | null {
  const n = Number(val);
  return typeof val === "number" && isFinite(n) && n >= 0 ? n : null;
}

/** Safe positive integer validation */
function safePositiveInt(val: unknown): number | null {
  const n = parseInt(String(val));
  return !isNaN(n) && n >= 0 ? n : null;
}

/** Map DB errors to safe user-facing messages */
function safeDbError(error: any): string {
  console.error("Tool DB error:", error?.code, error?.message);
  if (error?.code === "23505") return "Registro duplicado";
  if (error?.code === "23503") return "Referencia inválida";
  if (error?.code?.startsWith("23")) return "Error de validación";
  return "Error al procesar la solicitud";
}

/** Normalize a datetime string to full ISO format in Argentina time (UTC-3) */
function normalizeDatetime(raw: string): Date | null {
  if (!raw) return null;
  // Already has timezone info
  if (raw.includes("+") || raw.endsWith("Z")) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  // Has date and time (e.g. "2026-02-20T16:00" or "2026-02-20 16:00")
  const withTz = raw.replace(" ", "T") + "-03:00";
  const d = new Date(withTz);
  if (!isNaN(d.getTime())) return d;
  // Only time provided (e.g. "16:00") — combine with today in Argentina
  const nowArg = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dateStr = nowArg.toISOString().slice(0, 10);
  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    const d2 = new Date(`${dateStr}T${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}:00-03:00`);
    return isNaN(d2.getTime()) ? null : d2;
  }
  return null;
}

// ============================================================================
// 5. GOOGLE CALENDAR / GMAIL HELPERS
// ============================================================================

/** Get a valid Google Calendar access token, refreshing if expired */
async function getValidCalendarToken(
  supabase: any,
  userId: string,
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("google_calendar_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!tokenRow) return null;

  // Check if token is still valid (with 60s buffer)
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) return tokenRow.access_token;

  // Refresh the token
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshRes.ok) return null;
  const refreshData = await refreshRes.json();
  const newAccessToken = refreshData.access_token;
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
  await supabase
    .from("google_calendar_tokens")
    .update({ access_token: newAccessToken, expires_at: newExpiresAt })
    .eq("user_id", userId);
  return newAccessToken;
}

/** Extract Meet link from a Google Calendar event response */
function extractMeetLink(event: any): string | null {
  return event.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === "video")?.uri ?? null;
}

/** Build a Google Calendar event body */
function buildCalendarEvent(args: {
  summary: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  location?: string;
  addMeet?: boolean;
  attendees?: string[];
}): any {
  const body: any = {
    summary: args.summary,
    start: { dateTime: args.startDate.toISOString(), timeZone: "America/Argentina/Cordoba" },
    end: { dateTime: args.endDate.toISOString(), timeZone: "America/Argentina/Cordoba" },
  };
  if (args.description) body.description = String(args.description).slice(0, 2000);
  if (args.location) body.location = String(args.location).slice(0, 500);
  if (args.addMeet) {
    body.conferenceData = {
      createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  if (args.attendees?.length) {
    body.attendees = args.attendees
      .filter((e: string) => typeof e === "string" && e.includes("@"))
      .slice(0, 20)
      .map((e: string) => ({ email: e.trim().slice(0, 200) }));
  }
  return body;
}

/** Parse and validate start/end datetimes for calendar events */
function parseEventDates(args: any): { startDate: Date; endDate: Date } | { error: string } {
  const startStr = typeof args.start_datetime === "string" ? args.start_datetime : null;
  if (!startStr) return { error: "La fecha de inicio es requerida" };
  const startDate = normalizeDatetime(startStr);
  if (!startDate) return { error: `Fecha de inicio inválida: '${startStr}'. Usá formato ISO como '2026-02-20T16:00'.` };
  const endDateRaw = args.end_datetime ? normalizeDatetime(String(args.end_datetime)) : null;
  const endDate = endDateRaw ?? new Date(startDate.getTime() + 60 * 60 * 1000);
  return { startDate, endDate };
}

/** Encode a header value as RFC 2047 Base64 UTF-8 if it contains non-ASCII */
function encodeHeaderValue(value: string): string {
  // Check if value contains non-ASCII characters
  if (/[^\x00-\x7F]/.test(value)) {
    const encoded = btoa(unescape(encodeURIComponent(value)));
    return `=?UTF-8?B?${encoded}?=`;
  }
  return value;
}

/** Build a MIME email message and base64url-encode it */
function buildMimeEmail(to: string, subject: string, body: string, cc?: string | null): string {
  const encodedSubject = encodeHeaderValue(subject);
  const mimeLines = [`To: ${to}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"];
  if (cc) mimeLines.push(`Cc: ${cc}`);
  mimeLines.push("", body);
  const mimeMessage = mimeLines.join("\r\n");
  return btoa(unescape(encodeURIComponent(mimeMessage))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ============================================================================
// 6. AUTHENTICATION
// ============================================================================

interface AuthResult {
  userId: string;
  agentName: string | null;
  agentCode: string | null;
}

async function authenticateRequest(
  req: Request,
  supabaseUrl: string,
  supabase: any
): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, agent_code")
    .eq("user_id", user.id)
    .single();

  return {
    userId: user.id,
    agentName: profile?.full_name ?? null,
    agentCode: profile?.agent_code ?? null,
  };
}

// ============================================================================
// 7. TOOL EXECUTOR
// ============================================================================

async function executeTool(
  name: string,
  args: any,
  ctx: {
    supabase: any;
    userId: string;
    conversationId: string;
    getCalendarToken: () => Promise<string | null>;
  }
): Promise<string> {
  const { supabase, userId, conversationId, getCalendarToken } = ctx;

  switch (name) {
    // ---- Properties ----
    case "search_properties": {
      const zone = sanitizePattern(args.zone);
      const locality = sanitizePattern(args.locality);
      const operation = sanitizePattern(args.operation);
      const property_type = sanitizePattern(args.property_type);
      const currency = sanitizePattern(args.currency);
      const min_price = safePositiveNumber(args.min_price);
      const max_price = safePositiveNumber(args.max_price);
      const min_ambientes = safePositiveInt(args.min_ambientes);
      const max_ambientes = safePositiveInt(args.max_ambientes);
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 5, 1), 50);

      let baseQuery = supabase.from("properties").select("*", { count: "exact", head: true });
      let dataQuery = supabase.from("properties").select("*");

      const applyFilters = (q: any) => {
        if (zone) q = q.ilike("zone", `%${zone}%`);
        if (locality) q = q.ilike("locality", `%${locality}%`);
        if (operation) q = q.ilike("operation", `%${operation}%`);
        if (property_type) q = q.ilike("property_type", `%${property_type}%`);
        if (min_price !== null) q = q.gte("price", min_price);
        if (max_price !== null) q = q.lte("price", max_price);
        if (currency) q = q.ilike("currency", `%${currency}%`);
        if (min_ambientes !== null) q = q.gte("ambientes", min_ambientes);
        if (max_ambientes !== null) q = q.lte("ambientes", max_ambientes);
        return q;
      };

      baseQuery = applyFilters(baseQuery);
      dataQuery = applyFilters(dataQuery);
      dataQuery = dataQuery.limit(limit);

      const [countResult, dataResult] = await Promise.all([baseQuery, dataQuery]);
      const totalCount = countResult.count ?? 0;
      const { data, error } = dataResult;

      if (error) return JSON.stringify({ error: safeDbError(error) });
      if (!data || data.length === 0) return JSON.stringify({ message: "No se encontraron propiedades con esos criterios.", total_count: 0, results: [] });

      // Sort: RE/MAX Docta properties first
      data.sort((a: any, b: any) => {
        const aDocta = a.office?.toLowerCase().includes("docta") ? 0 : 1;
        const bDocta = b.office?.toLowerCase().includes("docta") ? 0 : 1;
        return aDocta - bDocta;
      });

      return JSON.stringify({ total_count: totalCount, showing: data.length, results: data });
    }

    case "compare_properties": {
      if (!Array.isArray(args.property_ids) || args.property_ids.length === 0) {
        return JSON.stringify({ error: "IDs de propiedades inválidos" });
      }
      const validIds = args.property_ids.filter((id: unknown) => typeof id === "string" && UUID_REGEX.test(id));
      if (validIds.length === 0) return JSON.stringify({ error: "IDs de propiedades inválidos" });
      const { data, error } = await supabase.from("properties").select("*").in("id", validIds);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ properties: data });
    }

    // ---- Favorites ----
    case "get_favorites": {
      const { data, error } = await supabase
        .from("favorites")
        .select("property_id, properties(*)")
        .eq("user_id", userId);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ favorites: data });
    }

    case "add_favorite": {
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) {
        return JSON.stringify({ error: "ID de propiedad inválido" });
      }
      const { error } = await supabase.from("favorites").insert({ user_id: userId, property_id: args.property_id });
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: "Propiedad agregada a favoritos" });
    }

    case "remove_favorite": {
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) {
        return JSON.stringify({ error: "ID de propiedad inválido" });
      }
      const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq("property_id", args.property_id);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: "Propiedad eliminada de favoritos" });
    }

    case "generate_report": {
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) {
        return JSON.stringify({ error: "ID de propiedad inválido" });
      }
      const { data, error } = await supabase.from("properties").select("*").eq("id", args.property_id).single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ property: data, instruction: "Generá una ficha profesional y detallada de esta propiedad para compartir con clientes. Incluí todos los datos relevantes de forma organizada." });
    }

    // ---- Clients ----
    case "create_client": {
      const full_name = typeof args.full_name === "string" ? args.full_name.trim().slice(0, 200) : null;
      if (!full_name) return JSON.stringify({ error: "El nombre es requerido" });
      const phone = typeof args.phone === "string" ? args.phone.trim().slice(0, 50) : null;
      const email = typeof args.email === "string" ? args.email.trim().slice(0, 200) : null;
      const notes = typeof args.notes === "string" ? args.notes.trim().slice(0, 2000) : null;
      const status = VALID_CLIENT_STATUSES.includes(args.status) ? args.status : "prospect";
      const { data, error } = await supabase
        .from("clients")
        .insert({ user_id: userId, full_name, phone, email, notes, status })
        .select("id, full_name, status")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, client: data, message: `Cliente "${full_name}" creado correctamente.` });
    }

    case "update_client": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      const updates: Record<string, any> = {};
      if (typeof args.full_name === "string") updates.full_name = args.full_name.trim().slice(0, 200);
      if (typeof args.phone === "string") updates.phone = args.phone.trim().slice(0, 50);
      if (typeof args.email === "string") updates.email = args.email.trim().slice(0, 200);
      if (typeof args.notes === "string") updates.notes = args.notes.trim().slice(0, 2000);
      if (VALID_CLIENT_STATUSES.includes(args.status)) updates.status = args.status;
      if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No hay campos para actualizar" });
      const { data, error } = await supabase
        .from("clients")
        .update(updates)
        .eq("id", args.client_id)
        .eq("user_id", userId)
        .select("id, full_name, status")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, client: data, message: `Cliente actualizado correctamente.` });
    }

    case "list_clients": {
      const search = sanitizePattern(args.search);
      const status = VALID_CLIENT_STATUSES.includes(args.status) ? args.status : null;
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 20, 1), 100);
      let query = supabase
        .from("clients")
        .select("id, full_name, phone, email, status, notes, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (search) query = query.ilike("full_name", `%${search}%`);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ clients: data ?? [], total: data?.length ?? 0 });
    }

    case "get_client": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", args.client_id)
        .eq("user_id", userId)
        .single();
      if (clientError) return JSON.stringify({ error: safeDbError(clientError) });
      const { data: convs } = await supabase
        .from("conversations")
        .select("id, title, conversation_type, updated_at")
        .eq("client_id", args.client_id)
        .order("updated_at", { ascending: false });
      return JSON.stringify({ client, conversations: convs ?? [] });
    }

    case "link_conversation": {
      if (!conversationId || !UUID_REGEX.test(conversationId)) return JSON.stringify({ error: "ID de conversación inválido" });
      const updates: Record<string, any> = {};
      if (args.client_id && UUID_REGEX.test(args.client_id)) {
        const { data: client } = await supabase.from("clients").select("id").eq("id", args.client_id).eq("user_id", userId).single();
        if (client) updates.client_id = args.client_id;
      }
      if (VALID_CONVERSATION_TYPES.includes(args.conversation_type)) updates.conversation_type = args.conversation_type;
      if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No hay datos para vincular" });
      const { error } = await supabase.from("conversations").update(updates).eq("id", conversationId).eq("user_id", userId);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: "Conversación vinculada correctamente." });
    }

    // ---- Calendar ----
    case "create_calendar_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado. El agente debe ir a su perfil y conectar el calendario." });

      const summary = typeof args.summary === "string" ? args.summary.trim().slice(0, 500) : null;
      if (!summary) return JSON.stringify({ error: "El título del evento es requerido" });

      const dates = parseEventDates(args);
      if ("error" in dates) return JSON.stringify({ error: dates.error });

      const eventBody = buildCalendarEvent({
        summary,
        startDate: dates.startDate,
        endDate: dates.endDate,
        description: args.description,
        location: args.location,
        addMeet: args.add_meet_link === true,
      });

      const calUrl = args.add_meet_link === true
        ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1"
        : "https://www.googleapis.com/calendar/v3/calendars/primary/events";

      const calRes = await fetch(calUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      if (!calRes.ok) {
        const err = await calRes.text();
        console.error("Calendar create error:", err);
        return JSON.stringify({ error: "Error al crear el evento en Google Calendar" });
      }
      const event = await calRes.json();
      return JSON.stringify({ success: true, event_id: event.id, html_link: event.htmlLink, meet_link: extractMeetLink(event), message: `Evento "${summary}" creado correctamente en Google Calendar.` });
    }

    case "create_meet_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado. El agente debe ir a su perfil y conectar el calendario." });

      const summary = typeof args.summary === "string" ? args.summary.trim().slice(0, 500) : null;
      if (!summary) return JSON.stringify({ error: "El título del evento es requerido" });

      const dates = parseEventDates(args);
      if ("error" in dates) return JSON.stringify({ error: dates.error });

      const eventBody = buildCalendarEvent({
        summary,
        startDate: dates.startDate,
        endDate: dates.endDate,
        description: args.description,
        addMeet: true,
        attendees: Array.isArray(args.attendees) ? args.attendees : undefined,
      });

      const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      if (!calRes.ok) {
        const err = await calRes.text();
        console.error("Meet event create error:", err);
        return JSON.stringify({ error: "Error al crear el evento con Google Meet" });
      }
      const event = await calRes.json();
      return JSON.stringify({ success: true, event_id: event.id, html_link: event.htmlLink, meet_link: extractMeetLink(event), start: dates.startDate.toISOString(), end: dates.endDate.toISOString(), message: `Reunión por Meet "${summary}" creada correctamente.` });
    }

    // ---- Gmail ----
    case "send_email": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Gmail no conectado. El agente debe reconectar su cuenta desde el perfil para activar el envío de emails." });

      const to = typeof args.to === "string" ? args.to.trim().slice(0, 500) : null;
      if (!to || !to.includes("@")) return JSON.stringify({ error: "Email de destinatario inválido" });
      const subject = typeof args.subject === "string" ? args.subject.trim().slice(0, 500) : null;
      if (!subject) return JSON.stringify({ error: "El asunto es requerido" });
      const body = typeof args.body === "string" ? args.body.trim().slice(0, 50000) : null;
      if (!body) return JSON.stringify({ error: "El cuerpo del email es requerido" });
      const cc = typeof args.cc === "string" ? args.cc.trim().slice(0, 500) : null;

      const encoded = buildMimeEmail(to, subject, body, cc);

      const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: encoded }),
      });

      if (!gmailRes.ok) {
        const err = await gmailRes.text();
        console.error("Gmail send error:", err);
        if (gmailRes.status === 403) return JSON.stringify({ error: "Sin permisos para enviar emails. El agente debe reconectar su cuenta desde el perfil para activar Gmail." });
        return JSON.stringify({ error: "Error al enviar el email" });
      }
      const gmailData = await gmailRes.json();
      return JSON.stringify({ success: true, message_id: gmailData.id, message: `Email enviado correctamente a ${to}.` });
    }

    case "list_calendar_events": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado." });

      const daysAhead = Math.min(Math.max(safePositiveInt(args.days_ahead) ?? 7, 1), 30);
      const maxResults = Math.min(Math.max(safePositiveInt(args.max_results) ?? 10, 1), 20);
      const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        timeMax: new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: String(maxResults),
        singleEvents: "true",
        orderBy: "startTime",
      });

      const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!calRes.ok) return JSON.stringify({ error: "Error al obtener eventos de Google Calendar" });
      const data = await calRes.json();
      const events = (data.items ?? []).map((e: any) => ({
        id: e.id,
        summary: e.summary,
        description: e.description,
        location: e.location,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        html_link: e.htmlLink,
      }));
      return JSON.stringify({ events, total: events.length });
    }

    case "update_calendar_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado." });

      const eventId = typeof args.event_id === "string" ? args.event_id.trim() : null;
      if (!eventId) return JSON.stringify({ error: "ID de evento requerido" });

      const getRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!getRes.ok) return JSON.stringify({ error: "Evento no encontrado" });
      await getRes.json(); // consume body

      const patch: any = {};
      if (args.summary) patch.summary = String(args.summary).slice(0, 500);
      if (args.description !== undefined) patch.description = String(args.description).slice(0, 2000);
      if (args.location !== undefined) patch.location = String(args.location).slice(0, 500);
      if (args.start_datetime) {
        const sd = normalizeDatetime(String(args.start_datetime));
        if (sd) patch.start = { dateTime: sd.toISOString(), timeZone: "America/Argentina/Cordoba" };
      }
      if (args.end_datetime) {
        const ed = normalizeDatetime(String(args.end_datetime));
        if (ed) patch.end = { dateTime: ed.toISOString(), timeZone: "America/Argentina/Cordoba" };
      }

      const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!patchRes.ok) return JSON.stringify({ error: "Error al actualizar el evento" });
      const updated = await patchRes.json();
      return JSON.stringify({ success: true, event_id: updated.id, html_link: updated.htmlLink, message: `Evento actualizado correctamente.` });
    }

    case "delete_calendar_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado." });

      const eventId = typeof args.event_id === "string" ? args.event_id.trim() : null;
      if (!eventId) return JSON.stringify({ error: "ID de evento requerido" });

      const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!delRes.ok && delRes.status !== 410) return JSON.stringify({ error: "Error al eliminar el evento" });
      return JSON.stringify({ success: true, message: "Evento eliminado del calendario." });
    }

    // ---- Web Search & Scraping (Firecrawl) ----
    case "web_search": {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) return JSON.stringify({ error: "Búsqueda web no configurada." });
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : null;
      if (!query) return JSON.stringify({ error: "La consulta de búsqueda es requerida" });
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 5, 1), 10);
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, limit, scrapeOptions: { formats: ["markdown"] } }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error("Firecrawl search error:", err);
          return JSON.stringify({ error: "Error al buscar en internet" });
        }
        const data = await res.json();
        const results = (data.data ?? []).map((r: any) => ({
          title: r.title,
          url: r.url,
          description: r.description,
          content: r.markdown?.slice(0, 2000),
        }));
        return JSON.stringify({ results, total: results.length });
      } catch (e) {
        console.error("Web search error:", e);
        return JSON.stringify({ error: "Error al buscar en internet" });
      }
    }

    case "scrape_url": {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) return JSON.stringify({ error: "Scraping web no configurado." });
      let url = typeof args.url === "string" ? args.url.trim() : null;
      if (!url) return JSON.stringify({ error: "La URL es requerida" });
      if (!url.startsWith("http://") && !url.startsWith("https://")) url = `https://${url}`;
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error("Firecrawl scrape error:", err);
          return JSON.stringify({ error: "Error al leer la página web" });
        }
        const data = await res.json();
        const content = data.data?.markdown || data.markdown || "";
        const metadata = data.data?.metadata || data.metadata || {};
        return JSON.stringify({
          title: metadata.title || "",
          url: metadata.sourceURL || url,
          content: content.slice(0, 8000),
        });
      } catch (e) {
        console.error("Scrape error:", e);
        return JSON.stringify({ error: "Error al leer la página web" });
      }
    }

    default:
      return JSON.stringify({ error: "Tool not found" });
  }
}

// ============================================================================
// 8. MESSAGE BUILDING
// ============================================================================

/** Build the contextual system prompt with agent identity */
function buildContextualPrompt(agentName: string | null, agentCode: string | null): string {
  const now = new Date();
  const argTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const dateStr = argTime.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const timeStr = argTime.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  const agentContext = agentName
    ? `\n\n## IDENTIDAD DEL AGENTE HUMANO — LEER CON ATENCIÓN
El agente inmobiliario que usa esta app se llama **${agentName}**${agentCode ? ` y su código de asociado RE/MAX es **${agentCode}**` : ""}.
Vos sos "Alan", el asistente de IA. ${agentName} es el humano real.

REGLAS ABSOLUTAS — INCUMPLIRLAS ES UN ERROR GRAVE:

**REGLA 1 — NOMBRE EN BORRADORES:**
Cuando redactés cualquier borrador (email, WhatsApp, mensaje, carta), la firma y presentación SIEMPRE usan "${agentName}".
Ejemplo correcto: "Hola, soy ${agentName} de RE/MAX Docta." / "¡Saludos! ${agentName}"
PROHIBIDO: "[Tu Nombre]", "[Nombre del Agente]", "Soy Alan" — NUNCA uses estas formas.

**REGLA 2 — URLs CON ATRIBUCIÓN (APLICA EN ABSOLUTAMENTE TODOS LOS MENSAJES):**${agentCode ? `
Cada vez que incluyas una URL de propiedad (remax.com.ar, cualquier portal inmobiliario) en CUALQUIER parte de tu respuesta — ya sea en borradores, en el chat normal, en fichas, en comparaciones, en CUALQUIER lugar — SIEMPRE debés agregar ?associate=${agentCode} al final.
Esta regla aplica sin excepción, dentro o fuera de <<<DRAFT_START>>>.
Correcto: https://www.remax.com.ar/listings/ejemplo?associate=${agentCode}
Correcto en markdown: [Ver propiedad](https://www.remax.com.ar/listings/ejemplo?associate=${agentCode})
INCORRECTO (PROHIBIDO): https://www.remax.com.ar/listings/ejemplo
INCORRECTO (PROHIBIDO): [Ver propiedad](https://www.remax.com.ar/listings/ejemplo)
Si la URL ya tiene parámetros (?algo=valor), agregá &associate=${agentCode} al final.` : ""}

**REGLA 3 — FORMATO DE BORRADORES:**
Usá SIEMPRE los marcadores <<<DRAFT_START>>> y <<<DRAFT_END>>> para delimitar el borrador (solos en su línea).
El texto dentro debe ser el texto final listo para copiar, sin markdown ni ***.
Ejemplo:
Te preparé este mensaje:

<<<DRAFT_START>>>
Hola [cliente], soy ${agentName} de RE/MAX Docta. ...
¡Saludos! ${agentName}
<<<DRAFT_END>>>

¿Querés que ajuste algo?`
    : "";

  return `${SYSTEM_PROMPT}${agentContext}\n\nFecha y hora actual en Argentina: ${dateStr}, ${timeStr}.`;
}

/** Convert user messages with attachments to multimodal AI format */
function buildAIMessages(msgs: any[]): any[] {
  return msgs.map((m: any) => {
    if (m.role === "user" && m.attachments?.length) {
      const content: any[] = [];
      for (const att of m.attachments) {
        if (att.type === "image") {
          content.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${att.base64}` } });
        }
      }
      if (m.content) {
        content.push({ type: "text", text: m.content });
      } else if (content.length > 0) {
        content.push({ type: "text", text: "Analizá esta imagen y describí lo que ves." });
      }
      return { role: "user", content };
    }
    return { role: m.role, content: m.content };
  });
}

// ============================================================================
// 9. TITLE GENERATION
// ============================================================================

async function generateTitle(
  messages: any[],
  assistantContent: string,
  conversationId: string,
  supabase: any,
  apiKey: string
): Promise<void> {
  try {
    const userText =
      typeof messages[0].content === "string"
        ? messages[0].content
        : Array.isArray(messages[0].content)
          ? messages[0].content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ")
          : "";

    const titleRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Generá un título MUY CORTO (máximo 5 palabras) en español para esta conversación. Solo el título, sin comillas ni puntuación al final. Debe ser descriptivo del tema principal." },
          { role: "user", content: `Usuario: ${userText.slice(0, 300)}\nAsistente: ${assistantContent.slice(0, 300)}` },
        ],
        stream: false,
      }),
    });
    if (titleRes.ok) {
      const titleData = await titleRes.json();
      const generatedTitle = titleData.choices?.[0]?.message?.content?.trim();
      if (generatedTitle) {
        await supabase.from("conversations").update({ title: generatedTitle }).eq("id", conversationId);
      }
    }
  } catch (e) {
    console.error("Title generation error:", e);
  }
}

// ============================================================================
// 10. SSE RESPONSE BUILDER
// ============================================================================

const MSG_BREAK = "===MSG_BREAK===";

function buildSSEResponse(content: string): Response {
  const encoder = new TextEncoder();
  const segments = content.split(MSG_BREAK).map((s: string) => s.trim()).filter((s: string) => s.length > 0);

  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < segments.length; i++) {
        const chunk = JSON.stringify({ choices: [{ delta: { content: segments[i] }, finish_reason: null }] });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        if (i < segments.length - 1) {
          const breakChunk = JSON.stringify({ choices: [{ delta: { content: MSG_BREAK }, finish_reason: null }] });
          controller.enqueue(encoder.encode(`data: ${breakChunk}\n\n`));
        }
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

// ============================================================================
// 11. MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, conversationId } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate
    const authResult = await authenticateRequest(req, supabaseUrl, supabase);
    if (authResult instanceof Response) return authResult;
    const { userId, agentName, agentCode } = authResult;

    // Google credentials
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    // Tool execution context
    const toolCtx = {
      supabase,
      userId,
      conversationId,
      getCalendarToken: () => getValidCalendarToken(supabase, userId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET),
    };

    // Build prompt and messages
    const contextualPrompt = buildContextualPrompt(agentName, agentCode);
    let currentMessages: any[] = [
      { role: "system", content: contextualPrompt },
      ...buildAIMessages(messages),
    ];

    // First call – non-streaming to handle tool calls
    let aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gemini-2.5-flash", messages: currentMessages, tools: toolDefinitions, stream: false }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Payment required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error: ${status}`);
    }

    let aiData = await aiResponse.json();
    let choice = aiData.choices?.[0];

    // Tool call loop (max 5 iterations)
    let iterations = 0;
    while (choice?.finish_reason === "tool_calls" && iterations < 5) {
      iterations++;
      const toolCalls = choice.message.tool_calls;
      currentMessages.push(choice.message);

      for (const tc of toolCalls) {
        const result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments), toolCtx);
        currentMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gemini-2.5-flash", messages: currentMessages, tools: toolDefinitions, stream: false }),
      });

      if (!aiResponse.ok) throw new Error(`AI error: ${aiResponse.status}`);
      aiData = await aiResponse.json();
      choice = aiData.choices?.[0];
    }

    // Auto-generate title after first user message
    if (conversationId && messages.length === 1 && userId) {
      generateTitle(messages, choice?.message?.content ?? "", conversationId, supabase, GEMINI_API_KEY);
    }

    // Return SSE response
    if (choice?.message?.content) {
      return buildSSEResponse(choice.message.content);
    }

    // Fallback: stream from AI directly
    const streamResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gemini-2.5-flash", messages: currentMessages, stream: true }),
    });

    if (!streamResponse.ok) throw new Error(`Stream error: ${streamResponse.status}`);
    return new Response(streamResponse.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: "Error al procesar la solicitud" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
