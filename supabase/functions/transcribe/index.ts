import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;
    if (!audioFile) throw new Error("No audio file provided");

    // Determine MIME type
    let mimeType = audioFile.type || "";
    const fileName = audioFile.name || "";

    // Fallback mime detection from extension
    if (!mimeType || mimeType === "application/octet-stream") {
      if (fileName.endsWith(".webm")) mimeType = "audio/webm";
      else if (fileName.endsWith(".mp4") || fileName.endsWith(".m4a")) mimeType = "audio/mp4";
      else if (fileName.endsWith(".ogg")) mimeType = "audio/ogg";
      else if (fileName.endsWith(".mp3")) mimeType = "audio/mp3";
      else if (fileName.endsWith(".aac")) mimeType = "audio/aac";
      else if (fileName.endsWith(".wav")) mimeType = "audio/wav";
      else mimeType = "audio/webm"; // safe default for browsers
    }

    console.log(`Transcribing: file=${fileName}, mime=${mimeType}, size=${audioFile.size}`);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    // Convert audio to base64 in chunks
    const arrayBuffer = await audioFile.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const CHUNK = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const base64Audio = btoa(binary);

    // Use native Gemini API (supports all audio MIME types)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Audio,
                  },
                },
                {
                  text: "Transcribí este audio exactamente como fue dicho. Devolvé SOLO el texto transcripto, sin comillas, sin explicaciones, sin nada extra. Si no hay audio o no se entiende, devolvé una cadena vacía.",
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI transcription error:", response.status, errText);
      throw new Error(`Transcription failed: ${response.status}`);
    }

    const aiData = await response.json();
    const transcript = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return new Response(JSON.stringify({ text: transcript }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
