import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { headers, sampleRows } = await req.json();

    if (!headers || !Array.isArray(headers) || headers.length === 0) {
      return new Response(JSON.stringify({ error: "No headers provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const prompt = `Sos un asistente que analiza archivos de datos de clientes inmobiliarios. Te doy los encabezados de columnas y algunas filas de ejemplo de un archivo CSV/Excel.

Tu tarea es identificar qué columna corresponde a:
- "name": Nombre completo del cliente (OBLIGATORIO - debe existir)
- "phone": Teléfono del cliente
- "email": Email del cliente
- "client_type": Tipo de contacto (comprador/vendedor). Buscá columnas como "Tipo de Contacto", "Tipo", "Rol", etc.

Usá la herramienta map_columns para devolver tu análisis.

REGLAS:
- Los índices son 0-based (la primera columna es 0).
- Si no encontrás una columna para phone, email o client_type, devolvé -1.
- Para name, elegí la columna que más probablemente contenga el nombre completo. Si hay "nombre" y "apellido" separados, elegí la que tenga el nombre completo o la primera de ellas.
- "extra_columns" son los ÍNDICES de todas las columnas que NO son name, phone, email ni client_type. Estas se guardarán en notas.
- Para client_type_column: si encontrás una columna que indica si el contacto es "Vendedor", "Comprador", "Ambos", etc., devolvé su índice. Si no existe, devolvé -1.

ENCABEZADOS: ${JSON.stringify(headers)}

FILAS DE EJEMPLO:
${(sampleRows ?? []).map((r: string[], i: number) => `Fila ${i + 1}: ${JSON.stringify(r)}`).join("\n")}`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        tools: [{
          type: "function",
          function: {
            name: "map_columns",
            description: "Maps spreadsheet columns to client fields",
            parameters: {
              type: "object",
              properties: {
                name_column: { type: "integer", description: "Index of the name column (0-based)" },
                phone_column: { type: "integer", description: "Index of the phone column, or -1 if not found" },
                email_column: { type: "integer", description: "Index of the email column, or -1 if not found" },
                client_type_column: { type: "integer", description: "Index of the client type column (vendedor/comprador), or -1 if not found" },
                extra_columns: {
                  type: "array",
                  items: { type: "integer" },
                  description: "Indices of all other columns to include in notes",
                },
                has_name_split: { type: "boolean", description: "True if name is split across multiple columns (nombre/apellido)" },
                name_column_2: { type: "integer", description: "Index of second name column (apellido) if split, -1 otherwise" },
              },
              required: ["name_column", "phone_column", "email_column", "client_type_column", "extra_columns", "has_name_split", "name_column_2"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "map_columns" } },
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes, intentá de nuevo en unos segundos" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI mapping failed");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No mapping returned from AI");
    }

    const mapping = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ mapping }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-client-import error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
