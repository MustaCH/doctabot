// Memoria de cliente entre conversaciones (ticket 86aj9w5nu).
//
// Post-turno (en el background de index.ts, junto al supervisor), si la conversación tiene un
// cliente vinculado, se re-genera `clients.ai_summary` con gemini-2.5-flash a partir del summary
// anterior + el último intercambio. El summary se inyecta en el bloque CLIENTE ACTIVO del turno
// siguiente (buildActiveClientBlock) y lo expone recall_client_history para conversaciones sin
// vincular. Fail-open total: cualquier error deja el summary anterior intacto.

/** Tope duro del summary persistido (~1.500 chars ≈ 400 tokens en el prompt). */
export const AI_SUMMARY_MAX_CHARS = 1500;

/**
 * Sanea el summary generado: sin marcadores de formato del chat (un summary con
 * <<<PROPERTIES>>> o ===MSG_BREAK=== inyectado al system romperia el turno siguiente),
 * colapsa espacios y aplica el tope. Puro y testeable.
 */
export function sanitizeSummary(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<<<[^>]*>>>/g, " ")
    .replace(/===MSG_BREAK===/g, " ")
    .replace(/\[(?:FIN )?REFERENCIA\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AI_SUMMARY_MAX_CHARS);
}

/** Prompt del generador. Puro y testeable. */
export function buildSummaryMessages(args: {
  clientName: string;
  prevSummary: string | null;
  userMessage: string;
  assistantMessage: string;
}): Array<{ role: string; content: string }> {
  const { clientName, prevSummary, userMessage, assistantMessage } = args;
  return [
    {
      role: "system",
      content:
        `Mantenés la MEMORIA de trabajo sobre el cliente "${clientName}" para un asistente inmobiliario. ` +
        `Reescribí el resumen incorporando SOLO lo nuevo relevante del último intercambio: qué busca/vende, decisiones tomadas, ` +
        `propiedades vistas/descartadas y por qué, objeciones, próximos pasos acordados y fechas. ` +
        `Máximo ${AI_SUMMARY_MAX_CHARS} caracteres, prosa compacta en español, sin markdown ni listas, sin datos inventados, ` +
        `sin repetir datos de ficha (teléfono/email/presupuesto ya viven en el CRM). Si el intercambio no aporta nada nuevo ` +
        `sobre el cliente, devolvé el resumen anterior tal cual. Devolvé SOLO el resumen.`,
    },
    {
      role: "user",
      content:
        `RESUMEN ANTERIOR:\n${prevSummary?.trim() || "(sin resumen previo)"}\n\n` +
        `ÚLTIMO INTERCAMBIO:\nAgente: ${userMessage.slice(0, 2000)}\nAsistente: ${assistantMessage.slice(0, 3000)}`,
    },
  ];
}

/**
 * Regenera y persiste el ai_summary del cliente vinculado. Se llama desde el background del
 * turno (EdgeRuntime.waitUntil) — nunca bloquea ni rompe el turno. Scopeado por user_id
 * (service_role bypassa RLS).
 */
export async function updateClientSummary(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente supabase inyectado (mismo patrón que executor/title)
  supabase: any;
  apiKey: string;
  userId: string;
  clientId: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<void> {
  const { supabase, apiKey, userId, clientId, userMessage, assistantMessage } = args;
  try {
    const { data: client } = await supabase
      .from("clients")
      .select("full_name, ai_summary")
      .eq("id", clientId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!client?.full_name) return;

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: buildSummaryMessages({
          clientName: client.full_name,
          prevSummary: client.ai_summary ?? null,
          userMessage,
          assistantMessage,
        }),
        // ~400 tokens de salida alcanzan para el tope de chars; thinking apagado (igual que
        // title.ts: sus tokens contarían dentro de max_tokens en el endpoint OpenAI-compat).
        max_tokens: 512,
        reasoning_effort: "none",
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const summary = sanitizeSummary(data.choices?.[0]?.message?.content);
    if (!summary) return;

    await supabase
      .from("clients")
      .update({ ai_summary: summary, ai_summary_updated_at: new Date().toISOString() })
      .eq("id", clientId)
      .eq("user_id", userId);
  } catch (e) {
    console.error("client-summary error:", e);
  }
}
