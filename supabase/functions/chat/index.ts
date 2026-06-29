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
import { buildContextualPrompt, buildAIMessages, buildActiveClientBlock } from "./_shared/prompt.ts";
import { toolDefinitions } from "./_shared/tools/definitions.ts";
import { executeTool } from "./_shared/tools/executor.ts";
import { getValidCalendarToken } from "./_shared/tools/google.ts";
import { generateTitle, regenerateTitle } from "./_shared/title.ts";
import { runSupervisorEval, logSupervisorResult } from "./_shared/supervisor.ts";
import { streamTurn } from "./_shared/stream-turn.ts";
import { extractListingSlugs, neutralizeFabricatedListings } from "./_shared/link-guardrail.ts";
import { MSG_BREAK } from "./_shared/alan-facts.ts";
import { fetchWithRetry } from "./_shared/retry.ts";
import { sendPushNotification, notifyN8nWebhook } from "./_shared/notifications.ts";
import { reportEdgeErrorBg } from "../_shared/observability.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    // Cliente vinculado a la conversación: lo releemos UNA vez (join) en el critical path
    // para que Alan no arranque ciego (keystone 86aj1f0vm). Scopeado por user_id (service_role
    // bypassa RLS). Fail-open: si no hay client_id, la query falla o no hay cliente, no se
    // inyecta nada y el chat sigue normal.
    let activeClientBlock = "";
    if (conversationId) {
      try {
        const { data: conv } = await supabase
          .from("conversations")
          .select("client_id, clients(full_name, status, client_type, phone, email, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, birthday, company)")
          .eq("id", conversationId)
          .eq("user_id", userId)
          .maybeSingle();
        if (conv?.client_id && conv.clients) {
          activeClientBlock = buildActiveClientBlock(conv.clients as any);
        }
      } catch (e) {
        console.error("active client lookup error:", e);
      }
    }

    // Build prompt and messages
    const contextualPrompt = buildContextualPrompt(agentName, agentCode);
    const systemContent = activeClientBlock ? `${contextualPrompt}\n\n${activeClientBlock}` : contextualPrompt;
    const currentMessages: any[] = [
      { role: "system", content: systemContent },
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

    // Retry con backoff para transitorios (5xx/429/red/timeout). Seguro: re-pide la generación a
    // Gemini sin re-ejecutar tools (los resultados ya están en `messages`). Evita que un blip
    // transitorio en una continuación del tool-loop tumbe el turno entero. Ver 86aj1ncj4.
    const resilientAIFetch = async (body: Record<string, any>): Promise<Response> => {
      const payload = JSON.stringify({ ...body, model: PRIMARY_MODEL, max_tokens: AI_MAX_TOKENS });
      return fetchWithRetry(() => fetch(AI_URL, {
        method: "POST",
        headers: aiHeaders,
        body: payload,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      }));
    };

    const toolLoopDeps = { resilientAIFetch, executeTool, toolCtx, toolDefinitions };

    // Guardarraíl de integridad de links: la ronda de texto final se bufferiza, así que antes de
    // volcarla validamos los listings de remax contra la tabla `properties` (única fuente de un
    // listing real — Alan solo los obtiene vía las tools que leen esa tabla). Un slug que no existe
    // en la DB lo fabricó el modelo → lo neutralizamos para no mandarle un link muerto al cliente
    // (remax redirige los listings inexistentes a la home). Fail-open: cualquier error deja el texto
    // intacto. Es la red determinista que respalda la regla de prompt "copiá el url exacto".
    const sanitizeFinal = async (text: string): Promise<string> => {
      try {
        const slugs = extractListingSlugs(text);
        if (slugs.length === 0) return text;
        const candidateUrls = slugs.map((s) => `https://www.remax.com.ar/listings/${s}`);
        const { data, error } = await supabase.from("properties").select("url").in("url", candidateUrls);
        if (error) return text; // no validable → no rompemos ni recortamos el turno
        const valid = new Set<string>();
        for (const row of (data ?? []) as Array<{ url: string | null }>) {
          const m = String(row.url ?? "").match(/\/listings\/([a-z0-9-]+)/i);
          if (m) valid.add(m[1].toLowerCase());
        }
        const { text: cleaned, removed } = neutralizeFabricatedListings(text, valid);
        if (removed.length === 0) return text;
        console.warn("link-guardrail: listings inexistentes neutralizados", { count: removed.length, slugs: removed });
        const n = removed.length;
        const aviso = `${MSG_BREAK}⚠️ Quité ${n} ${n === 1 ? "enlace" : "enlaces"} de propiedad que no pude verificar en el sistema (apuntaban a una página inexistente). Volvé a pedirme esas propiedades o usá las tarjetas de búsqueda, que traen el link correcto.`;
        return cleaned + aviso;
      } catch {
        return text;
      }
    };

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

    // Contexto del turno anterior (penúltimo user + último assistant) para que el supervisor
    // interprete follow-ups ("sí, dale", "mandáselo") en contexto. Solo con historial. Ver 86aj1f1up.
    const asText = (c: any): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ") : "";
    const priorContext = messages.length > 1
      ? {
          user: asText([...messages].slice(0, -1).reverse().find((m: any) => m.role === "user")?.content),
          assistant: asText([...messages].reverse().find((m: any) => m.role === "assistant")?.content),
        }
      : null;

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
        let executedTools: string[] = [];
        let streamFailed = false;
        let streamErrorMessage = "";
        try {
          const result = await streamTurn(toolLoopDeps, { messages: currentMessages, emit, firstResponse: firstRes, sanitizeFinal });
          finalContent = result.content;
          executedTools = result.executedTools;
        } catch (err) {
          console.error("streamTurn error:", err);
          // Guardamos el error real para mandarlo al webhook (observabilidad — ver 86aj1ncj4).
          streamErrorMessage = err instanceof Error ? err.message : String(err);
          // Instrumentación (86aj4276y): el catch del turno NO escribía en error_logs (solo pingeaba
          // n8n), dejando ciego el fallo más común del chat. Lo registramos con contexto para
          // diagnosticar el throw determinista del tool-loop tras search_properties.
          reportEdgeErrorBg({
            context: "chat-streamTurn",
            error: err,
            userId,
            metadata: {
              conversationId: conversationId ?? null,
              userMessage: typeof userMessage === "string" ? userMessage.slice(0, 300) : null,
              messagesLen: Array.isArray(messages) ? messages.length : null,
            },
          });
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
              // Defensa en profundidad (service_role bypassa RLS): el UPDATE scopeado por user_id
              // solo afecta la conversación si es del agente. Persistimos el mensaje SOLO si afectó
              // una fila, evitando escritura cross-tenant con un conversationId ajeno (viene crudo
              // del body). messages no tiene user_id: su dueño es transitivo vía conversation_id. Ver 86aj1n1tf.
              const { data: owned } = await admin
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", conversationId)
                .eq("user_id", userId)
                .select("id")
                .maybeSingle();
              if (owned) {
                await admin.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: finalContent });
              }
            }

            if (conversationId && messages.length === 1 && userId && !streamFailed) {
              generateTitle(messages, finalContent, conversationId, userId, supabase, GEMINI_API_KEY);
            } else if (conversationId && userId && !streamFailed && finalContent && messages.length > 1) {
              // Re-titulado (una sola vez, cap por title_locked): cuando la conversación cambió
              // de foco — al vincular un cliente (hito semántico) o al acumular ~6 mensajes —,
              // regeneramos el título con contexto acumulado. No pisa renames manuales. Ver 86aj1f24c.
              const linkedThisTurn = executedTools.includes("link_conversation");
              if (linkedThisTurn || messages.length >= 6) {
                const { data: conv } = await supabase
                  .from("conversations")
                  .select("client_id, clients(full_name)")
                  .eq("id", conversationId)
                  .eq("user_id", userId)
                  .maybeSingle();
                const clientName = (conv as any)?.clients?.full_name ?? null;
                const recentMessages = [...messages.slice(-5), { role: "assistant", content: finalContent }];
                regenerateTitle({ conversationId, userId, supabase, apiKey: GEMINI_API_KEY, recentMessages, clientName });
              }
            }

            if (streamFailed) {
              // El turno falló: no corre el supervisor (no tiene sentido evaluar el mensaje de error).
              notifyN8nWebhook({ type: "empty_response", conversationId: conversationId || null, userId, userMessage, alanResponse: finalContent, verdict: "error", reason: streamErrorMessage || "stream_error", score: 0, retryCount: 0 });
            } else if (finalContent) {
              const supervisorResult = await runSupervisorEval({ content: finalContent, userMessage, apiKey: LOVABLE_API_KEY, executedTools, priorContext });
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
              } else if (
                // Respuesta aprobada pero mediocre: alertamos para que la franja media no pase
                // silenciosa. Umbral configurable (default 5). Ver ticket 86aj1f157.
                supervisorResult.verdict === "approved" &&
                typeof supervisorResult.score === "number" &&
                supervisorResult.score > 0 &&
                supervisorResult.score <= parseInt(Deno.env.get("LOW_QUALITY_THRESHOLD") ?? "5", 10)
              ) {
                notifyN8nWebhook({
                  type: "low_quality",
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

            // Push: ya no usamos la heurística de latencia (con streaming real casi todo
            // turno supera el viejo umbral de 1.5s → push redundante). Disparamos cuando
            // hay una respuesta real; el service worker decide si MOSTRARLA según el foco
            // real del usuario (suprime si ya está mirando esta conversación). Ver sw.ts.
            if (userId && conversationId && finalContent && !streamFailed) {
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
    // Observabilidad (ticket 86aj18r6x): registrar el error en error_logs + ping n8n.
    reportEdgeErrorBg({ context: "chat", error: e });
    return new Response(JSON.stringify({ error: "Error al procesar la solicitud" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
