import { supabase } from "@/integrations/supabase/client";

export type MsgAttachment = {
  type: "image" | "file";
  base64: string;
  mimeType: string;
  fileName?: string;
};

export type Msg = {
  role: "user" | "assistant";
  content: string;
  attachments?: MsgAttachment[];
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const MSG_BREAK = "===MSG_BREAK===";

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

  let contentBuffer = "";

  const processContent = (text: string) => {
    contentBuffer += text;
    while (contentBuffer.includes(MSG_BREAK)) {
      const idx = contentBuffer.indexOf(MSG_BREAK);
      const before = contentBuffer.slice(0, idx);
      if (before.trim()) {
        onDelta(before);
      }
      onNewMessage?.();
      contentBuffer = contentBuffer.slice(idx + MSG_BREAK.length);
    }
    const safeLen = contentBuffer.length - (MSG_BREAK.length - 1);
    if (safeLen > 0) {
      onDelta(contentBuffer.slice(0, safeLen));
      contentBuffer = contentBuffer.slice(safeLen);
    }
  };

  const flushContentBuffer = () => {
    if (contentBuffer.trim()) {
      while (contentBuffer.includes(MSG_BREAK)) {
        const idx = contentBuffer.indexOf(MSG_BREAK);
        const before = contentBuffer.slice(0, idx);
        if (before.trim()) onDelta(before);
        onNewMessage?.();
        contentBuffer = contentBuffer.slice(idx + MSG_BREAK.length);
      }
      if (contentBuffer.trim()) {
        onDelta(contentBuffer);
      }
    }
    contentBuffer = "";
  };

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
        if (content) processContent(content);
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
        if (content) processContent(content);
      } catch { /* ignore */ }
    }
  }

  flushContentBuffer();
  onDone();
}
