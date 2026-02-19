import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Sos "Alan", un asistente de IA profesional y amigable para agentes inmobiliarios de RE/MAX Argentina.

Tu personalidad:
- Hablás en español argentino (vos, usás, tenés, etc.)
- Sos profesional pero cercano, como un colega experimentado
- Usás emojis con moderación para ser más amigable
- Siempre tratás de ser útil y preciso

Tenés acceso a las siguientes herramientas para ayudar a los agentes:

1. **search_properties**: Buscar propiedades en la base de datos según criterios (ubicación, precio, tipo, ambientes, etc.)
2. **compare_properties**: Comparar 2 o más propiedades lado a lado
3. **get_favorites**: Ver las propiedades favoritas del agente
4. **add_favorite**: Guardar una propiedad como favorita
5. **remove_favorite**: Eliminar una propiedad de favoritos
6. **generate_report**: Generar una ficha/reporte de una propiedad para compartir con clientes

Cuando muestres propiedades, incluí siempre: título, precio, ubicación, superficie, ambientes y un link.
Si el agente pide comparar propiedades, usá una tabla comparativa.
Si no encontrás resultados, sugerí criterios alternativos.`;

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
          description: "Buscar propiedades en la base de datos. Puede filtrar por localidad, tipo de operación (venta/alquiler), tipo de propiedad, rango de precio, cantidad de ambientes, etc.",
          parameters: {
            type: "object",
            properties: {
              locality: { type: "string", description: "Localidad o barrio (ej: Nueva Córdoba, Alto Alberdi)" },
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
          let query = supabase.from("properties").select("*");
          if (args.locality) query = query.ilike("locality", `%${args.locality}%`);
          if (args.operation) query = query.ilike("operation", `%${args.operation}%`);
          if (args.property_type) query = query.ilike("property_type", `%${args.property_type}%`);
          if (args.min_price) query = query.gte("price", args.min_price);
          if (args.max_price) query = query.lte("price", args.max_price);
          if (args.currency) query = query.ilike("currency", `%${args.currency}%`);
          if (args.min_ambientes) query = query.gte("ambientes", args.min_ambientes);
          if (args.max_ambientes) query = query.lte("ambientes", args.max_ambientes);
          const limit = args.limit ?? 5;
          query = query.limit(limit);
          const { data, error } = await query;
          if (error) return JSON.stringify({ error: error.message });
          if (!data || data.length === 0) return JSON.stringify({ message: "No se encontraron propiedades con esos criterios.", results: [] });
          return JSON.stringify({ count: data.length, results: data });
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

    // AI call with tool loop
    let currentMessages = [
      { role: "system", content: contextualPrompt },
      ...messages,
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
