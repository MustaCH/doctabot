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

import { corsHeaders, MAX_MESSAGE_LENGTH } from "./_shared/cors.ts";
import { authenticateRequest } from "./_shared/auth.ts";
import { buildContextualPrompt, buildAIMessages } from "./_shared/prompt.ts";
import { toolDefinitions } from "./_shared/tools/definitions.ts";
import { executeTool } from "./_shared/tools/executor.ts";
import { getValidCalendarToken } from "./_shared/tools/google.ts";
import { generateTitle } from "./_shared/title.ts";
import { buildSSEResponse } from "./_shared/sse.ts";
import { runSupervisorLoop, logSupervisorResult } from "./_shared/supervisor.ts";
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

    // Resilient fetch via Lovable AI Gateway: tries openai/gpt-5.2, falls back to gemini-2.5-flash on 5xx
    const PRIMARY_MODEL = "openai/gpt-5.2";
    const FALLBACK_MODEL = "google/gemini-2.5-flash";
    const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiHeaders = { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" };

    const resilientAIFetch = async (body: Record<string, any>): Promise<Response> => {
      const res = await fetch(AI_URL, { method: "POST", headers: aiHeaders, body: JSON.stringify({ ...body, model: PRIMARY_MODEL }) });
      if (res.status >= 500) {
        console.warn(`Primary model ${PRIMARY_MODEL} returned ${res.status}, falling back to ${FALLBACK_MODEL}`);
        return fetch(AI_URL, { method: "POST", headers: aiHeaders, body: JSON.stringify({ ...body, model: FALLBACK_MODEL }) });
      }
      return res;
    };

    // First call – non-streaming to handle tool calls
    let aiResponse = await resilientAIFetch({ messages: currentMessages, tools: toolDefinitions, stream: false });

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
    const executedTools: string[] = [];
    while (choice?.finish_reason === "tool_calls" && iterations < 5) {
      iterations++;
      const toolCalls = choice.message.tool_calls;
      currentMessages.push(choice.message);

      for (const tc of toolCalls) {
        const result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments), toolCtx);
        currentMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
        // Track successfully executed tools (no error in result)
        try {
          const parsed = JSON.parse(result);
          if (parsed.success || !parsed.error) {
            executedTools.push(tc.function.name);
          }
        } catch { executedTools.push(tc.function.name); }
      }

      aiResponse = await resilientAIFetch({ messages: currentMessages, tools: toolDefinitions, stream: false });

      if (!aiResponse.ok) throw new Error(`AI error: ${aiResponse.status}`);
      aiData = await aiResponse.json();
      choice = aiData.choices?.[0];
    }

    // Auto-generate title after first user message
    if (conversationId && messages.length === 1 && userId) {
      generateTitle(messages, choice?.message?.content ?? "", conversationId, supabase, GEMINI_API_KEY);
    }

    // ========== SUPERVISOR LAYER ==========
    let finalContent = choice?.message?.content ?? "";

    if (finalContent) {
      // Filter out "SILENT THOUGHTS" leaked from transcription models
      let userMessage = messages[messages.length - 1]?.content ?? "";
      userMessage = userMessage.replace(/^SILENT THOUGHTS:[\s\S]*?(?=\S)/i, "").trim();
      if (!userMessage) userMessage = messages[messages.length - 1]?.content ?? "";

      const supervisorResult = await runSupervisorLoop({
        initialContent: finalContent,
        userMessage,
        currentMessages,
        executedTools,
        apiKey: LOVABLE_API_KEY,
        resilientAIFetch,
      });
      finalContent = supervisorResult.finalContent;

      // Log to supervisor_logs (fire-and-forget)
      logSupervisorResult({
        supabaseUrl,
        supabaseServiceKey,
        conversationId: conversationId || null,
        userId,
        userMessage,
        finalContent,
        result: supervisorResult,
      });

      // Notify n8n webhook on errors or empty responses (fire-and-forget)
      const shouldNotify = supervisorResult.verdict === "error" || !finalContent.trim() || (supervisorResult.verdict === "rejected" && supervisorResult.retryCount >= 2);
      if (shouldNotify) {
        notifyN8nWebhook({
          type: !finalContent.trim() ? "empty_response" : supervisorResult.verdict === "error" ? "supervisor_error" : "persistent_rejection",
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
    }

    // Return SSE response
    if (finalContent) {
      // Persist assistant message to DB BEFORE streaming to client
      // This ensures the message is saved even if the client disconnects mid-stream
      if (conversationId) {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        await supabaseAdmin.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: finalContent,
        });
        await supabaseAdmin.from("conversations").update({
          updated_at: new Date().toISOString(),
        }).eq("id", conversationId);
      }

      // Send push notification if response took >1.5s (fire-and-forget)
      // Faster responses are assumed to mean the user is actively viewing the chat.
      const elapsed = Date.now() - requestStartTime;
      if (elapsed > 1500 && userId && conversationId) {
        sendPushNotification({ supabaseUrl, supabaseServiceKey, userId, conversationId, content: finalContent });
      }
      return buildSSEResponse(finalContent);
    }

    const fallbackResponse = await resilientAIFetch({ messages: currentMessages, stream: false });

    if (!fallbackResponse.ok) throw new Error(`Fallback error: ${fallbackResponse.status}`);
    const fallbackData = await fallbackResponse.json();
    const fallbackContent = fallbackData.choices?.[0]?.message?.content || "Lo siento, no pude generar una respuesta. ¿Podés intentar de nuevo?";

    // Persist fallback message
    if (conversationId) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      await supabaseAdmin.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: fallbackContent,
      });
      await supabaseAdmin.from("conversations").update({
        updated_at: new Date().toISOString(),
      }).eq("id", conversationId);

      // Send push notification for fallback too
      const elapsed = Date.now() - requestStartTime;
      if (elapsed > 1500 && userId) {
        sendPushNotification({ supabaseUrl, supabaseServiceKey, userId, conversationId, content: fallbackContent });
      }
    }

    return buildSSEResponse(fallbackContent);
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: "Error al procesar la solicitud" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
