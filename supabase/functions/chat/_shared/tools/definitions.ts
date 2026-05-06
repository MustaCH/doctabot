// Tool definitions for the AI Gateway (OpenAI-compatible function-calling format)

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "search_properties",
      description: "Buscar propiedades en la base de datos. Puede filtrar por localidad, zona, barrio, ciudad, tipo de operación (venta/alquiler/alquiler temporario), tipo de propiedad, rango de precio, ambientes, habitaciones, etc.",
      parameters: {
        type: "object",
        properties: {
          locality: { type: "string", description: "Localidad o barrio (ej: Nueva Córdoba, Alto Alberdi)" },
          zone: { type: "string", description: "Zona de Córdoba Capital: Ruta 20, Nueva Córdoba, Centro, Alberdi, Alta Córdoba, General Paz, Zona Sur, Zona Norte" },
          neighborhood: { type: "string", description: "Barrio estructurado (ej: nueva cordoba, general paz, villa allende). Viene del campo zone_neighborhood de la propiedad." },
          city: { type: "string", description: "Ciudad (ej: cordoba, villa allende, mendiolaza, alta gracia). Viene del campo zone_city." },
          title: { type: "string", description: "Buscar por palabras clave en el título de la propiedad (ej: Las Tipas, Country Cañuelas, Manantiales II). Útil cuando la zona o barrio específico no es una localidad estándar sino un desarrollo o loteo." },
          operation: { type: "string", description: "Tipo de operación: Venta, Alquiler o Alquiler temporario" },
          property_type: { type: "string", description: "Tipo de propiedad: Departamento, Casa, Terreno, Local, Oficina, etc." },
          min_price: { type: "number", description: "Precio mínimo" },
          max_price: { type: "number", description: "Precio máximo" },
          currency: { type: "string", description: "Moneda: USD o ARS" },
          min_ambientes: { type: "integer", description: "Cantidad mínima de ambientes" },
          max_ambientes: { type: "integer", description: "Cantidad máxima de ambientes" },
          min_habitaciones: { type: "integer", description: "Cantidad mínima de dormitorios/habitaciones" },
          max_habitaciones: { type: "integer", description: "Cantidad máxima de dormitorios/habitaciones" },
          office: { type: "string", description: "Filtrar por oficina: 'REMAX Docta' para propiedades propias de la oficina, vacío para todas las propiedades de RE/MAX Córdoba" },
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
      description: "Crear un nuevo perfil de cliente para el agente. Capturá la mayor cantidad de datos posibles: tipo de cliente, cumpleaños, empresa, zonas de interés, presupuesto, etc.",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: "string", description: "Nombre completo del cliente (requerido)" },
          phone: { type: "string", description: "Teléfono del cliente" },
          email: { type: "string", description: "Email del cliente" },
          notes: { type: "string", description: "Notas libres sobre el cliente" },
          status: { type: "string", description: "Estado: hot (caliente/interesado, default), warm (tibio/en seguimiento), cold (frío/sin actividad)" },
          client_type: { type: "string", description: "Tipo: buyer (compra/alquila, default), seller (vende/alquila su propiedad), both" },
          birthday: { type: "string", description: "Fecha de cumpleaños formato YYYY-MM-DD" },
          company: { type: "string", description: "Empresa u ocupación" },
          address: { type: "string", description: "Dirección actual del cliente" },
          preferred_zones: { type: "string", description: "Zonas de interés (ej: 'Nueva Córdoba, Centro')" },
          budget_min: { type: "number", description: "Presupuesto mínimo (solo si el cliente da un rango explícito con dos valores)" },
          budget_max: { type: "number", description: "Presupuesto máximo del cliente. Si el cliente menciona un solo número de presupuesto, usarlo aquí como budget_max" },
          budget_currency: { type: "string", description: "Moneda del presupuesto: USD (default) o ARS" },
          property_type_interest: { type: "string", description: "Tipo de propiedad buscada (ej: 'Departamento 2 amb')" },
          source: { type: "string", description: "Fuente: referido, portal, redes, cartel, otro" },
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
      description: "Actualizar datos de un cliente existente. Podés actualizar cualquier campo del perfil CRM.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente a actualizar" },
          full_name: { type: "string", description: "Nuevo nombre completo" },
          phone: { type: "string", description: "Nuevo teléfono" },
          email: { type: "string", description: "Nuevo email" },
          notes: { type: "string", description: "Nuevas notas" },
          status: { type: "string", description: "Nuevo estado: hot (caliente), warm (tibio), cold (frío)" },
          client_type: { type: "string", description: "Tipo: buyer, seller, both" },
          birthday: { type: "string", description: "Cumpleaños formato YYYY-MM-DD" },
          company: { type: "string", description: "Empresa u ocupación" },
          address: { type: "string", description: "Dirección actual" },
          preferred_zones: { type: "string", description: "Zonas de interés" },
          budget_min: { type: "number", description: "Presupuesto mínimo (solo si el cliente da un rango explícito)" },
          budget_max: { type: "number", description: "Presupuesto máximo. Si el cliente da un solo número, usarlo aquí" },
          budget_currency: { type: "string", description: "Moneda: USD o ARS" },
          property_type_interest: { type: "string", description: "Tipo de propiedad buscada" },
          source: { type: "string", description: "Fuente del cliente" },
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
          status: { type: "string", description: "Filtrar por estado: hot, warm, cold" },
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
  {
    type: "function",
    function: {
      name: "search_external_portals",
      description: "Buscar propiedades en portales inmobiliarios externos (ZonaProp y ArgentProp). Devuelve URLs de propiedades encontradas en esos portales.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Búsqueda libre (ej: 'departamento 2 ambientes nueva córdoba')" },
          operation: { type: "string", description: "venta o alquiler" },
          property_type: { type: "string", description: "departamento, casa, terreno, local, etc." },
          location: { type: "string", description: "Barrio o zona (ej: nueva-cordoba, centro)" },
          portals: { type: "array", items: { type: "string" }, description: "Portales a buscar: zonaprop, argenprop. Default: ambos" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_property_to_client",
      description: "Guardar/vincular una propiedad al perfil de un cliente. Podés pasar client_id/property_id si los tenés, o client_name/property_title para que se busquen automáticamente.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente (opcional si pasás client_name)" },
          client_name: { type: "string", description: "Nombre del cliente para buscar su ID automáticamente" },
          property_id: { type: "string", description: "ID de la propiedad (opcional si pasás property_title)" },
          property_title: { type: "string", description: "Título o dirección de la propiedad para buscar su ID automáticamente" },
          status: { type: "string", description: "Estado: sugerida (default), enviada, visitada, descartada" },
          notes: { type: "string", description: "Nota sobre por qué esta propiedad le sirve al cliente" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_client_properties",
      description: "Listar las propiedades vinculadas a un cliente con sus estados y notas.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente" },
          status: { type: "string", description: "Filtrar por estado: sugerida, enviada, visitada, descartada" },
        },
        required: ["client_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_client_property",
      description: "Eliminar la vinculación de una propiedad con un cliente.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente" },
          property_id: { type: "string", description: "ID de la propiedad a desvincular" },
        },
        required: ["client_id", "property_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_client_property",
      description: "Actualizar el estado o las notas de una propiedad vinculada a un cliente.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente" },
          property_id: { type: "string", description: "ID de la propiedad" },
          status: { type: "string", description: "Nuevo estado: sugerida, enviada, visitada, descartada" },
          notes: { type: "string", description: "Nuevas notas" },
        },
        required: ["client_id", "property_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_client_event",
      description: "Crear un evento/fecha importante para un cliente (cumpleaños, aniversario de compra, vencimiento de contrato, etc.). Se sincroniza automáticamente con Google Calendar si está conectado.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente" },
          client_name: { type: "string", description: "Nombre del cliente (se busca automáticamente si no tenés el ID)" },
          event_type: { type: "string", description: "Tipo: birthday, purchase_anniversary, contract_expiry, followup, custom" },
          title: { type: "string", description: "Título del evento (ej: 'Cumpleaños de María González')" },
          event_date: { type: "string", description: "Fecha del evento en formato YYYY-MM-DD" },
          recurrence: { type: "string", description: "Recurrencia: yearly (default), once, monthly" },
          notes: { type: "string", description: "Notas adicionales (opcional)" },
        },
        required: ["title", "event_date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_client_events",
      description: "Listar los eventos/fechas importantes de un cliente o todos los próximos eventos del agente.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente (opcional, si no se pasa muestra todos)" },
          days_ahead: { type: "integer", description: "Mostrar eventos en los próximos N días (default 90)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_client_event",
      description: "Eliminar un evento/fecha importante de un cliente. También lo elimina de Google Calendar si estaba sincronizado.",
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
      name: "create_client_note",
      description: "Crear una nota o tarea pendiente para un cliente. Usar cuando el agente quiera dejar un recordatorio, una observación o una acción pendiente sobre un cliente.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente" },
          client_name: { type: "string", description: "Nombre del cliente (se busca automáticamente si no tenés el ID)" },
          content: { type: "string", description: "Contenido de la nota o tarea" },
          is_action: { type: "boolean", description: "true si es una tarea/acción pendiente, false si es solo una nota informativa (default false)" },
        },
        required: ["content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_client_notes",
      description: "Listar las notas y tareas pendientes de un cliente.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "ID del cliente" },
          show_done: { type: "boolean", description: "Incluir tareas completadas (default false)" },
        },
        required: ["client_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_client_note",
      description: "Marcar una tarea/nota de cliente como completada o pendiente.",
      parameters: {
        type: "object",
        properties: {
          note_id: { type: "string", description: "ID de la nota/tarea" },
          is_done: { type: "boolean", description: "true para marcar como completada, false para pendiente" },
        },
        required: ["note_id", "is_done"],
        additionalProperties: false,
      },
    },
  },
];
