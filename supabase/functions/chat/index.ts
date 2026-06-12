// Chat edge function — thin orchestrator.
// Heavy logic lives in ./_shared/*. See refactor notes:
//   - prompt.ts            → SYSTEM_PROMPT + buildContextualPrompt + buildAIMessages
//   - tools/definitions.ts → AI Gateway tool schemas (30 tools)
//   - tools/executor.ts    → executeTool dispatcher
//   - tools/validators.ts  → input sanitizers
//   - tools/google.ts      → Calendar/Gmail helpers
//   - auth.ts              → JWT validation + profile lookup
//   - supervisor.ts        → quality supervisor + retry loop + logging
//   - notifications.ts     → push notifications + n8n webhook
//   - title.ts             → auto-generated conversation titles
//   - sse.ts               → SSE streaming response
//   - cors.ts              → shared CORS headers + MAX_MESSAGE_LENGTH

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, MAX_MESSAGE_LENGTH, validateAttachmentSizes } from "./_shared/cors.ts";
import { authenticateRequest } from "./_shared/auth.ts";
import { buildContextualPrompt, buildAIMessages } from "./_shared/prompt.ts";
import { toolDefinitions } from "./_shared/tools/definitions.ts";
import { executeTool } from "./_shared/tools/executor.ts";
import { getValidCalendarToken } from "./_shared/tools/google.ts";
import { generateTitle } from "./_shared/title.ts";
import { runSupervisorEval, logSupervisorResult } from "./_shared/supervisor.ts";
import { streamTurn } from "./_shared/stream-turn.ts";
import { sendPushNotification, notifyN8nWebhook } from "./_shared/notifications.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const requestStartTime = Date.now();

  try {
    const { messages, conversationId } = await req.json();
    // Using Gemini API key directly (OpenAI-compatible endpoint) instead of Lovable AI Gateway
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
    // Alias kept for downstream functions that expect "apiKey"
    const LOVABLE_API_KEY = GEMINI_API_KEY;

    // Validate message lengths to prevent abuse
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (typeof m.content === "string" && m.content.length > MAX_MESSAGE_LENGTH) {
          return new Response(JSON.stringify({ error: "Mensaje demasiado largo" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Tope de tamaño de adjuntos (el límite de content no cubre el base64 de imágenes).
    const attachmentSizeError = validateAttachmentSizes(messages);
    if (attachmentSizeError) {
      return new Response(JSON.stringify({ error: attachmentSizeError }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate
    const authResult = await authenticateRequest(req, supabaseUrl, supabase);
    if (authResult instanceof Response) return authResult;
    const { userId, agentName, agentCode } = authResult;

    // Rate limiting propio (control de costo). Límites configurables por env. Fail-open:
    // si la función todavía no está deployada (rlError), no bloqueamos el chat.
    const RL_MAX = parseInt(Deno.env.get("CHAT_RATE_LIMIT_MAX") ?? "30", 10);
    const RL_WINDOW = parseInt(Deno.env.get("CHAT_RATE_LIMIT_WINDOW_SECONDS") ?? "300", 10);
    const { data: rlAllowed, error: rlError } = await supabase.rpc("check_chat_rate_limit", {
      p_user_id: userId,
      p_max: RL_MAX,
      p_window_seconds: RL_WINDOW,
    });
    if (!rlError && rlAllowed === false) {
      return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Esperá un momento e intentá de nuevo." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    const currentMessages: any[] = [
      { role: "system", content: contextualPrompt },
      ...buildAIMessages(messages),
    ];

    // Gemini OpenAI-compatible endpoint (no Lovable Gateway). Single primary model.
    const PRIMARY_MODEL = "gemini-2.5-pro";
    const AI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const aiHeaders = { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" };
    // Timeout por llamada al modelo: si Gemini cuelga, se aborta (cada iteración del turno
    // es un fetch nuevo con su propia señal). max_tokens acota la respuesta y hace que
    // finish_reason:"length" sea significativo (lo maneja streamTurn).
    const AI_TIMEOUT_MS = 60_000;
    const AI_MAX_TOKENS = 8192;

    const resilientAIFetch = async (body: Record<string, any>): Promise<Response> => {
      return fetch(AI_URL, {
        method: "POST",
        headers: aiHeaders,
        body: JSON.stringify({ ...body, model: PRIMARY_MODEL, max_tokens: AI_MAX_TOKENS }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    };

    const toolLoopDeps = { resilientAIFetch, executeTool, toolCtx, toolDefinitions };

    // Primera llamada con stream:true. Validamos el status ANTES de abrir el stream al
    // cliente para preservar el contrato 429/402 que el front espera por HTTP status.
    const firstRes = await resilientAIFetch({ messages: currentMessages, tools: toolDefinitions, stream: true });
    if (!firstRes.ok) {
      if (firstRes.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (firstRes.status === 402) return new Response(JSON.stringify({ error: "Payment required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error: ${firstRes.status}`);
    }

    // Mensaje del usuario para el supervisor (filtra SILENT THOUGHTS de transcripción).
    let userMessage = messages[messages.length - 1]?.content ?? "";
    userMessage = userMessage.replace(/^SILENT THOUGHTS:[\s\S]*?(?=\S)/i, "").trim();
    if (!userMessage) userMessage = messages[messages.length - 1]?.content ?? "";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let clientOpen = true;
        const emit = (text: string) => {
          if (!clientOpen) return;
          try {
            const chunk = JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          } catch {
            clientOpen = false; // cliente desconectado; streamTurn sigue drenando Gemini
          }
        };

        let finalContent = "";
        let streamFailed = false;
        try {
          const result = await streamTurn(toolLoopDeps, { messages: currentMessages, emit, firstResponse: firstRes });
          finalContent = result.content;
        } catch (err) {
          console.error("streamTurn error:", err);
          // Persistimos el mensaje de error para que la conversación sea consistente al recargar.
          finalContent = "Lo siento, hubo un problema generando la respuesta. ¿Podés intentar de nuevo?";
          emit(finalContent);
          streamFailed = true;
        }

        try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* noop */ }
        try { controller.close(); } catch { /* noop */ }

        // Trabajo de fondo: persistencia + supervisor + título + push. Desacoplado del
        // cliente: corre aunque se haya desconectado.
        const background = (async () => {
          try {
            if (finalContent && conversationId) {
              const admin = createClient(supabaseUrl, supabaseServiceKey);
              await admin.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: finalContent });
              await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
            }

            if (conversationId && messages.length === 1 && userId && !streamFailed) {
              generateTitle(messages, finalContent, conversationId, supabase, GEMINI_API_KEY);
            }

            if (streamFailed) {
              // El turno falló: no corre el supervisor (no tiene sentido evaluar el mensaje de error).
              notifyN8nWebhook({ type: "empty_response", conversationId: conversationId || null, userId, userMessage, alanResponse: finalContent, verdict: "error", reason: "stream_error", score: 0, retryCount: 0 });
            } else if (finalContent) {
              const supervisorResult = await runSupervisorEval({ content: finalContent, userMessage, apiKey: LOVABLE_API_KEY });
              logSupervisorResult({ supabaseUrl, supabaseServiceKey, conversationId: conversationId || null, userId, userMessage, finalContent, result: supervisorResult });

              const shouldNotify = supervisorResult.verdict === "error" || supervisorResult.verdict === "rejected";
              if (shouldNotify) {
                notifyN8nWebhook({
                  type: supervisorResult.verdict === "error" ? "supervisor_error" : "persistent_rejection",
                  conversationId: conversationId || null,
                  userId,
                  userMessage,
                  alanResponse: finalContent,
                  verdict: supervisorResult.verdict,
                  reason: supervisorResult.reason,
                  score: supervisorResult.score,
                  retryCount: supervisorResult.retryCount,
                });
              }
            } else {
              notifyN8nWebhook({ type: "empty_response", conversationId: conversationId || null, userId, userMessage, alanResponse: "", verdict: "error", reason: "empty", score: 0, retryCount: 0 });
            }

            const elapsed = Date.now() - requestStartTime;
            if (elapsed > 1500 && userId && conversationId && finalContent) {
              sendPushNotification({ supabaseUrl, supabaseServiceKey, userId, conversationId, content: finalContent });
            }
          } catch (bgErr) {
            console.error("background task error:", bgErr);
          }
        })();

        // Mantener viva la función para el trabajo de fondo tras cerrar la respuesta.
        const edgeRuntime = (globalThis as any).EdgeRuntime;
        if (edgeRuntime?.waitUntil) {
          edgeRuntime.waitUntil(background);
        } else {
          await background; // fallback local/test
        }
      },
    });

    return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: "Error al procesar la solicitud" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
