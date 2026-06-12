import { supabase } from "@/integrations/supabase/client";
import { MarkerStream } from "./stream-markers";

export type MsgAttachment = {
  type: "image" | "file";
  base64?: string;       // presente en el turno en vivo (recién adjuntado)
  url?: string;          // signed URL al reconstruir desde Storage (reload)
  storagePath?: string;  // ref del objeto en el bucket chat-attachments
  mimeType: string;
  fileName?: string;
};

export type Msg = {
  role: "user" | "assistant";
  content: string;
  aiContent?: string;    // contenido "para la IA" (PDF + [REFERENCIA]) cuando difiere de content
  attachments?: MsgAttachment[];
  audioUrl?: string;
  quotedText?: string;
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export async function streamChat({
  messages,
  conversationId,
  onDelta,
  onNewMessage,
  onDone,
  signal,
}: {
  messages: Msg[];
  conversationId: string;
  onDelta: (text: string) => void;
  onNewMessage?: () => void;
  onDone: () => void;
  signal?: AbortSignal;
}) {
  // Get the current user's session token so the edge function can identify them
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("auth_required");
  }
  const authToken = session.access_token;

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ messages, conversationId }),
    signal,
  });

  if (resp.status === 429) throw new Error("rate_limit");
  if (resp.status === 402) throw new Error("payment_required");
  if (!resp.ok || !resp.body) throw new Error("stream_error");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;

  const markers = new MarkerStream(
    (text) => onDelta(text),
    () => onNewMessage?.(),
  );

  while (!done) {
    const { done: readerDone, value } = await reader.read();
    if (readerDone) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) markers.push(content);
      } catch {
        buf = line + "\n" + buf;
        break;
      }
    }
  }

  if (buf.trim()) {
    for (let raw of buf.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (!raw.startsWith("data: ")) continue;
      const json = raw.slice(6).trim();
      if (json === "[DONE]") continue;
      try {
        const parsed = JSON.parse(json);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) markers.push(content);
      } catch { /* ignore */ }
    }
  }

  markers.flush();
  onDone();
}
