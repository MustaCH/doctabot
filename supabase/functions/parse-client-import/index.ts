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

Tu tarea es identificar qué columna corresponde a cada campo del cliente:

CAMPOS PRINCIPALES:
- "name": Nombre completo del cliente (OBLIGATORIO - debe existir)
- "phone": Teléfono del cliente
- "email": Email del cliente
- "client_type": Tipo de contacto (comprador/vendedor). Buscá columnas como "Tipo de Contacto", "Tipo", "Rol", etc.

CAMPOS ADICIONALES:
- "preferred_zones": Zona, barrio o ubicación de interés. Buscá columnas como "Zona", "Barrio", "Ubicación", "Localidad", "Sector", etc.
- "budget_min": Presupuesto mínimo. Buscá "Presupuesto mín", "Budget min", "Monto desde", etc.
- "budget_max": Presupuesto máximo. Buscá "Presupuesto máx", "Budget max", "Monto hasta", "Presupuesto", "Monto", etc. Si hay una sola columna de presupuesto, usala como budget_max.
- "property_type_interest": Tipo de propiedad que busca. Buscá "Tipo de propiedad", "Busca", "Qué quiere", "Interés", "Tipo inmueble", etc.
- "birthday": Fecha de cumpleaños/nacimiento. Buscá "Cumpleaños", "Fecha nac", "Birthday", "Nacimiento", etc.
- "company": Empresa o inmobiliaria. Buscá "Empresa", "Inmobiliaria", "Company", "Organización", etc.
- "address": Dirección del cliente. Buscá "Dirección", "Domicilio", "Address", etc.
- "source": Fuente u origen del contacto. Buscá "Fuente", "Origen", "Cómo llegó", "Source", "Referido", etc.

Usá la herramienta map_columns para devolver tu análisis.

REGLAS:
- Los índices son 0-based (la primera columna es 0).
- Si no encontrás una columna para un campo, devolvé -1.
- Para name, elegí la columna que más probablemente contenga el nombre completo. Si hay "nombre" y "apellido" separados, elegí la que tenga el nombre completo o la primera de ellas.
- "extra_columns" son los ÍNDICES de todas las columnas que NO fueron mapeadas a ningún campo específico. Estas se guardarán en notas.
- Para client_type_column: si encontrás una columna que indica si el contacto es "Vendedor", "Comprador", "Ambos", etc., devolvé su índice. Si no existe, devolvé -1.

ENCABEZADOS: ${JSON.stringify(headers)}

FILAS DE EJEMPLO:
${(sampleRows ?? []).map((r: string[], i: number) => `Fila ${i + 1}: ${JSON.stringify(r)}`).join("\n")}`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY 
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ functionDeclarations: [{
          name: "map_columns",
          description: "Maps spreadsheet columns to client fields",
          parameters: {
            type: "object",
            properties: {
              name_column: { type: "integer", description: "Index of the name column (0-based)" },
              phone_column: { type: "integer", description: "Index of the phone column, or -1 if not found" },
              email_column: { type: "integer", description: "Index of the email column, or -1 if not found" },
              client_type_column: { type: "integer", description: "Index of the client type column (vendedor/comprador), or -1 if not found" },
              preferred_zones_column: { type: "integer", description: "Index of the preferred zones/barrio/ubicación column, or -1 if not found" },
              budget_min_column: { type: "integer", description: "Index of the budget min column, or -1 if not found" },
              budget_max_column: { type: "integer", description: "Index of the budget max column, or -1 if not found" },
              property_type_interest_column: { type: "integer", description: "Index of the property type interest column, or -1 if not found" },
              birthday_column: { type: "integer", description: "Index of the birthday/fecha nacimiento column, or -1 if not found" },
              company_column: { type: "integer", description: "Index of the company/empresa column, or -1 if not found" },
              address_column: { type: "integer", description: "Index of the client address/dirección column, or -1 if not found" },
              source_column: { type: "integer", description: "Index of the source/fuente/origen column, or -1 if not found" },
              extra_columns: {
                type: "array",
                items: { type: "integer" },
                description: "Indices of all columns NOT mapped to any specific field, to include in notes",
              },
              has_name_split: { type: "boolean", description: "True if name is split across multiple columns (nombre/apellido)" },
              name_column_2: { type: "integer", description: "Index of second name column (apellido) if split, -1 otherwise" },
            },
            required: [
              "name_column", "phone_column", "email_column", "client_type_column",
              "preferred_zones_column", "budget_min_column", "budget_max_column",
              "property_type_interest_column", "birthday_column", "company_column",
              "address_column", "source_column",
              "extra_columns", "has_name_split", "name_column_2"
            ],
          },
        }]}],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
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
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI mapping failed");
    }

    const data = await response.json();
    const toolCall = data.candidates?.[0]?.content?.parts?.[0]?.functionCall;
    if (!toolCall?.args) {
      throw new Error("No mapping returned from AI");
    }

    const mapping = toolCall.args;

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
