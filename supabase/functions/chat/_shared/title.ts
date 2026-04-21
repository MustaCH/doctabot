// Auto-generates a short title for new conversations

export async function generateTitle(
  messages: any[],
  assistantContent: string,
  conversationId: string,
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
    });
    if (titleRes.ok) {
      const titleData = await titleRes.json();
      const generatedTitle = titleData.choices?.[0]?.message?.content?.trim();
      if (generatedTitle) {
        await supabase.from("conversations").update({ title: generatedTitle }).eq("id", conversationId);
      }
    }
  } catch (e) {
    console.error("Title generation error:", e);
  }
}
