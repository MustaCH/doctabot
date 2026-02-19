import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

5. Si el agente pide comparar propiedades, usá una tabla comparativa.`;


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, conversationId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Build tools
    const tools = [
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
    ];

    // Get user_id from auth header
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: { user } } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = user?.id ?? null;
    }

    // Execute tool calls
    async function executeTool(name: string, args: any): Promise<string> {
      switch (name) {
        case "search_properties": {
          // Build base filter (without limit) for counting
          let baseQuery = supabase.from("properties").select("*", { count: "exact", head: true });
          let dataQuery = supabase.from("properties").select("*");
          
          const applyFilters = (q: any) => {
            if (args.zone) q = q.ilike("zone", `%${args.zone}%`);
            if (args.locality) q = q.ilike("locality", `%${args.locality}%`);
            if (args.operation) q = q.ilike("operation", `%${args.operation}%`);
            if (args.property_type) q = q.ilike("property_type", `%${args.property_type}%`);
            if (args.min_price) q = q.gte("price", args.min_price);
            if (args.max_price) q = q.lte("price", args.max_price);
            if (args.currency) q = q.ilike("currency", `%${args.currency}%`);
            if (args.min_ambientes) q = q.gte("ambientes", args.min_ambientes);
            if (args.max_ambientes) q = q.lte("ambientes", args.max_ambientes);
            return q;
          };
          
          baseQuery = applyFilters(baseQuery);
          dataQuery = applyFilters(dataQuery);
          
          const limit = args.limit ?? 5;
          dataQuery = dataQuery.limit(limit);
          
          const [countResult, dataResult] = await Promise.all([baseQuery, dataQuery]);
          const totalCount = countResult.count ?? 0;
          const { data, error } = dataResult;
          
          if (error) return JSON.stringify({ error: error.message });
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
          const { data, error } = await supabase.from("properties").select("*").in("id", args.property_ids);
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ properties: data });
        }
        case "get_favorites": {
          if (!userId) return JSON.stringify({ error: "Usuario no autenticado" });
          const { data, error } = await supabase
            .from("favorites")
            .select("property_id, properties(*)")
            .eq("user_id", userId);
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ favorites: data });
        }
        case "add_favorite": {
          if (!userId) return JSON.stringify({ error: "Usuario no autenticado" });
          const { error } = await supabase.from("favorites").insert({ user_id: userId, property_id: args.property_id });
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ success: true, message: "Propiedad agregada a favoritos" });
        }
        case "remove_favorite": {
          if (!userId) return JSON.stringify({ error: "Usuario no autenticado" });
          const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq("property_id", args.property_id);
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ success: true, message: "Propiedad eliminada de favoritos" });
        }
        case "generate_report": {
          const { data, error } = await supabase.from("properties").select("*").eq("id", args.property_id).single();
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ property: data, instruction: "Generá una ficha profesional y detallada de esta propiedad para compartir con clientes. Incluí todos los datos relevantes de forma organizada." });
        }
        default:
          return JSON.stringify({ error: "Tool not found" });
      }
    }

    // Current date/time in Argentina (UTC-3)
    const now = new Date();
    const argTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const dateStr = argTime.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    const timeStr = argTime.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    const contextualPrompt = `${SYSTEM_PROMPT}\n\nFecha y hora actual en Argentina: ${dateStr}, ${timeStr}.`;

    // Build messages for AI, converting attachments to multimodal content
    const buildAIMessages = (msgs: any[]) => {
      return msgs.map((m: any) => {
        if (m.role === "user" && m.attachments?.length) {
          const content: any[] = [];
          for (const att of m.attachments) {
            if (att.type === "image") {
              content.push({
                type: "image_url",
                image_url: { url: `data:${att.mimeType};base64,${att.base64}` },
              });
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
    };

    let currentMessages = [
      { role: "system", content: contextualPrompt },
      ...buildAIMessages(messages),
    ];

    // First call - non-streaming to handle tool calls
    let aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: currentMessages,
        tools,
        stream: false,
      }),
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
        const result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments));
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      // Call AI again with tool results - stream the final response
      aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: currentMessages,
          tools,
          stream: false,
        }),
      });

      if (!aiResponse.ok) throw new Error(`AI error: ${aiResponse.status}`);
      aiData = await aiResponse.json();
      choice = aiData.choices?.[0];
    }

    // Now stream the final response
    const finalMessages = [...currentMessages];
    if (choice?.message?.content) {
      // Already have a complete response, stream it
      finalMessages.push(choice.message);
    }

    // Make streaming call for the final answer
    const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: choice?.finish_reason === "tool_calls" ? currentMessages : [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
          ...(choice?.message ? [{ role: "assistant", content: choice.message.content }] : []),
        ].filter(m => m.role !== "assistant" || m.content),
        stream: true,
      }),
    });

    if (!streamResponse.ok) throw new Error(`Stream error: ${streamResponse.status}`);

    // If we already have a complete non-streamed response, convert it to SSE
    if (choice?.message?.content && choice.finish_reason !== "tool_calls") {
      const content = choice.message.content;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // Send as a single SSE event
          const chunk = JSON.stringify({
            choices: [{ delta: { content }, finish_reason: null }],
          });
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    return new Response(streamResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
