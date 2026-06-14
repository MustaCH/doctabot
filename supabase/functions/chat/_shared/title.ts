// Auto-generates a short title for new conversations

export async function generateTitle(
  messages: any[],
  assistantContent: string,
  conversationId: string,
  userId: string,
  supabase: any,
  apiKey: string
): Promise<void> {
  try {
    const userText =
      typeof messages[0].content === "string"
        ? messages[0].content
        : Array.isArray(messages[0].content)
          ? messages[0].content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ")
          : "";

    const titleRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: "Generá un título MUY CORTO (máximo 5 palabras) en español para esta conversación. Solo el título, sin comillas ni puntuación al final. Debe ser descriptivo del tema principal." },
          { role: "user", content: `Usuario: ${userText.slice(0, 300)}\nAsistente: ${assistantContent.slice(0, 300)}` },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (titleRes.ok) {
      const titleData = await titleRes.json();
      const generatedTitle = titleData.choices?.[0]?.message?.content?.trim();
      if (generatedTitle) {
        // Scopeado por user_id: la edge usa service_role (bypassa RLS) y conversationId
        // viene del cliente sin validar ownership, así que filtramos por dueño acá.
        await supabase.from("conversations").update({ title: generatedTitle }).eq("id", conversationId).eq("user_id", userId);
      }
    }
  } catch (e) {
    console.error("Title generation error:", e);
  }
}

/** Extrae el texto plano de un mensaje (string o multimodal). */
function messageText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
  }
  return "";
}

/**
 * Re-genera el título UNA vez más cuando la conversación cambió de foco (al vincular un
 * cliente o al acumular varios mensajes). A diferencia de generateTitle (que mira solo el
 * primer turno), alimenta el modelo con contexto acumulado (cliente vinculado + últimos
 * mensajes), así una charla que arrancó con "hola" y derivó a "negociación depto para María"
 * deja de quedar anclada al arranque trivial.
 *
 * Respeta los renames manuales y se auto-limita a una sola regeneración vía la columna
 * `title_locked`: si está en true (rename manual o re-titulado previo) no hace nada, y al
 * re-titular la deja en true. El UPDATE filtra por title_locked=false para no pisar un
 * rename manual que haya entrado entre el chequeo y la escritura. Ver ticket 86aj1f24c.
 */
export async function regenerateTitle(opts: {
  conversationId: string;
  userId: string;
  supabase: any;
  apiKey: string;
  recentMessages: any[];
  clientName?: string | null;
}): Promise<void> {
  const { conversationId, userId, supabase, apiKey, recentMessages, clientName } = opts;
  try {
    const { data: conv } = await supabase
      .from("conversations")
      .select("title_locked")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv || conv.title_locked) return; // rename manual o ya re-titulada → no tocar

    const transcript = recentMessages
      .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${messageText(m.content).slice(0, 300)}`)
      .join("\n")
      .slice(0, 2000);
    const clientHint = clientName ? `Cliente vinculado: ${clientName}\n` : "";

    const titleRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: "Generá un título MUY CORTO (máximo 5 palabras) en español que capture el TEMA PRINCIPAL ACTUAL de la conversación. Solo el título, sin comillas ni puntuación al final. Debe reflejar de qué se está hablando ahora, no solo el saludo inicial." },
          { role: "user", content: `${clientHint}${transcript}` },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!titleRes.ok) return;
    const titleData = await titleRes.json();
    const newTitle = titleData.choices?.[0]?.message?.content?.trim();
    if (!newTitle) return;

    await supabase
      .from("conversations")
      .update({ title: newTitle, title_locked: true })
      .eq("id", conversationId)
      .eq("user_id", userId)
      .eq("title_locked", false);
  } catch (e) {
    console.error("Title regeneration error:", e);
  }
}
