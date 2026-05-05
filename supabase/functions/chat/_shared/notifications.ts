// Push notification + n8n webhook helpers (fire-and-forget)
export function sendPushNotification(params: {
  supabaseUrl: string;
  supabaseServiceKey: string;
  userId: string;
  conversationId: string;
  content: string;
}): void {
  const { supabaseUrl, supabaseServiceKey, userId, conversationId, content } = params;
  const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
  fetch(pushUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({
      user_id: userId,
      title: "Alan respondió",
      body: content.slice(0, 100).replace(/[#*_`]/g, "") + (content.length > 100 ? "…" : ""),
      url: `/?c=${conversationId}`,
      trigger_source: "chat",
    }),
  }).catch((err: unknown) => console.error("Push notification error:", err));
}

export function notifyN8nWebhook(params: {
  type: "empty_response" | "supervisor_error" | "persistent_rejection";
  conversationId: string | null;
  userId: string;
  userMessage: string;
  alanResponse: string;
  verdict: string;
  reason: string;
  score: number;
  retryCount: number;
}): void {
  const N8N_WEBHOOK_URL = Deno.env.get("N8N_WEBHOOK_URL");
  if (!N8N_WEBHOOK_URL) return;
  fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: params.type,
      conversation_id: params.conversationId,
      user_id: params.userId,
      user_message: params.userMessage.slice(0, 500),
      alan_response: params.alanResponse.slice(0, 500),
      verdict: params.verdict,
      reason: params.reason,
      score: params.score,
      retry_count: params.retryCount,
      timestamp: new Date().toISOString(),
    }),
  }).catch((err: unknown) => console.error("n8n webhook error:", err));
}
