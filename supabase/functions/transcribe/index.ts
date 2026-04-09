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
    // Validate authentication
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

    const fileName = audioFile?.name || "";
    const mimeType = audioFile.type || "";

    // Detect format from filename and mime type
    let audioFormat = "wav"; // safe fallback
    if (fileName.endsWith(".webm") || mimeType.includes("webm")) {
      audioFormat = "webm";
    } else if (fileName.endsWith(".mp3") || mimeType.includes("mp3") || mimeType.includes("mpeg")) {
      audioFormat = "mp3";
    } else if (fileName.endsWith(".mp4") || mimeType.includes("mp4")) {
      audioFormat = "mp4";
    } else if (fileName.endsWith(".ogg") || mimeType.includes("ogg")) {
      audioFormat = "ogg";
    } else if (fileName.endsWith(".aac") || mimeType.includes("aac")) {
      audioFormat = "aac";
    } else if (fileName.endsWith(".wav") || mimeType.includes("wav")) {
      audioFormat = "wav";
    }

    console.log(`Transcribing: file=${fileName}, mime=${mimeType}, format=${audioFormat}, size=${audioFile.size}`);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    // Convert audio to base64 in chunks to avoid stack overflow
    const arrayBuffer = await audioFile.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const CHUNK = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const base64Audio = btoa(binary);

    // Use Gemini to transcribe the audio
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: base64Audio,
                  format: audioFormat,
                },
              },
              {
                type: "text",
                text: "Transcribí este audio exactamente como fue dicho. Devolvé SOLO el texto transcripto, sin comillas, sin explicaciones, sin nada extra. Si no hay audio o no se entiende, devolvé una cadena vacía.",
              },
            ],
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI transcription error:", response.status, errText);
      throw new Error(`Transcription failed: ${response.status}`);
    }

    const aiData = await response.json();
    const transcript = aiData.choices?.[0]?.message?.content?.trim() ?? "";

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
