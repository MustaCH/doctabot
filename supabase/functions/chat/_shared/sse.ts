// Server-Sent Events response builder for streaming chat output
//
// Tipos de evento del stream del chat (todos como `data: <json>`; el front ignora shapes
// desconocidos, así que agregar tipos nuevos es retrocompatible):
// - {"choices":[{"delta":{"content": "..."}}]}  → delta de texto (formato OpenAI-compatible).
// - {"final": {"content": "..."}}               → REEMPLAZO: texto final saneado completo
//   (86aj9w5nb; solo si el front declaró client_caps:["final_event"]).
// - {"step": {"tool","label","status"}}         → paso del tool-loop (86ak3kd5r): "running" al
//   arrancar una tool, "done" al terminar, con label determinista de tool-steps.ts.
// - "data: [DONE]"                              → fin del stream.
import { corsHeaders } from "./cors.ts";

export const MSG_BREAK = "===MSG_BREAK===";


export function buildSSEResponse(content: string): Response {
  const encoder = new TextEncoder();
  const segments = content.split(MSG_BREAK).map((s: string) => s.trim()).filter((s: string) => s.length > 0);

  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < segments.length; i++) {
        const chunk = JSON.stringify({ choices: [{ delta: { content: segments[i] }, finish_reason: null }] });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        if (i < segments.length - 1) {
          const breakChunk = JSON.stringify({ choices: [{ delta: { content: MSG_BREAK }, finish_reason: null }] });
          controller.enqueue(encoder.encode(`data: ${breakChunk}\n\n`));
        }
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}
