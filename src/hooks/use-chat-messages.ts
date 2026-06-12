import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, type Msg, type MsgAttachment } from "@/lib/stream-chat";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { feedbackReceive } from "@/hooks/use-feedback";
import type { ChatAttachment } from "@/components/ChatInput";
import { useFileProcessing } from "@/hooks/use-file-processing";
import { transcribeAudio } from "@/hooks/use-audio-recorder";

// Persistencia de adjuntos del chat (ticket 86aj0p5bg): las imágenes van a Storage y se
// reconstruyen al recargar; los PDFs/citas viajan como texto en messages.ai_content.
const ATTACHMENTS_BUCKET = "chat-attachments";
const SIGNED_URL_TTL = 60 * 60 * 24; // 24h: cubre display + re-envío dentro de la sesión

type StoredAttachmentRef = {
  type: "image" | "file";
  path?: string;        // solo imágenes (objeto en Storage)
  mimeType: string;
  fileName?: string;
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Sube las imágenes a Storage y devuelve refs serializables para messages.attachments. */
async function persistAttachments(
  userId: string,
  convId: string,
  atts?: MsgAttachment[],
): Promise<StoredAttachmentRef[] | null> {
  if (!atts || atts.length === 0) return null;
  const refs: StoredAttachmentRef[] = [];
  for (const att of atts) {
    if (att.type === "image" && att.base64) {
      const ext = (att.mimeType.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
      const path = `${userId}/${convId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, base64ToBytes(att.base64), { contentType: att.mimeType, upsert: false });
      if (error) { console.error("Error subiendo adjunto:", error); continue; }
      refs.push({ type: "image", path, mimeType: att.mimeType, fileName: att.fileName });
    } else {
      // PDFs/otros: el texto ya va en ai_content; guardamos metadata para reconstruir el chip.
      refs.push({ type: att.type, mimeType: att.mimeType, fileName: att.fileName });
    }
  }
  return refs.length > 0 ? refs : null;
}

/** Reconstruye MsgAttachment[] desde lo persistido, firmando URLs de las imágenes. */
async function reconstructAttachments(stored: unknown): Promise<MsgAttachment[] | undefined> {
  if (!Array.isArray(stored) || stored.length === 0) return undefined;
  const out: MsgAttachment[] = [];
  for (const a of stored as StoredAttachmentRef[]) {
    if (a.type === "image" && a.path) {
      const { data: signed } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(a.path, SIGNED_URL_TTL);
      out.push({ type: "image", url: signed?.signedUrl, storagePath: a.path, mimeType: a.mimeType, fileName: a.fileName });
    } else {
      out.push({ type: a.type, mimeType: a.mimeType, fileName: a.fileName });
    }
  }
  return out;
}

/** Mapea el historial para que la IA reciba el contenido enriquecido (PDF/cita) cuando existe. */
function historyForAI(msgs: Msg[]): Msg[] {
  return msgs.map((m) => (m.aiContent ? { ...m, content: m.aiContent } : m));
}

export function useChatMessages(
  activeConvId: string | null,
  createConversation: () => Promise<string>,
  setActiveConvId: (id: string) => void,
  loadConversations: () => Promise<void>,
  markAsRead?: (convId: string) => Promise<void>
) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipNextLoadRef = useRef(false);
  const mountedRef = useRef(true);
  const streamInterruptedRef = useRef(false);
  const { isProcessingPdf, processAttachments } = useFileProcessing();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reusable function to reload messages from DB
  const reloadMessagesFromDB = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("role, content, ai_content, attachments")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) {
      const MSG_BREAK = "===MSG_BREAK===";
      const LEGACY_BREAK = "\n\n---\n\n";
      const expanded: Msg[] = [];
      for (const msg of data) {
        if (msg.role === "assistant" && (msg.content.includes(MSG_BREAK) || msg.content.includes(LEGACY_BREAK))) {
          // Split by current separator first, then legacy
          const separator = msg.content.includes(MSG_BREAK) ? MSG_BREAK : LEGACY_BREAK;
          const parts = msg.content.split(separator);
          for (const part of parts) {
            if (part.trim()) expanded.push({ role: "assistant", content: part.trim() });
          }
        } else {
          // Reconstruimos el contexto multimodal del mensaje del usuario: adjuntos (imágenes
          // desde Storage) + ai_content (PDF/[REFERENCIA]) para que Alan no lo pierda al recargar.
          const m: Msg = { role: msg.role as Msg["role"], content: msg.content };
          if (msg.ai_content) m.aiContent = msg.ai_content;
          const atts = await reconstructAttachments(msg.attachments);
          if (atts) m.attachments = atts;
          expanded.push(m);
        }
      }
      if (mountedRef.current) {
        setMessages(expanded);
        setIsStreaming(false);
      }
    }
  }, []);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    reloadMessagesFromDB(activeConvId);
  }, [activeConvId, reloadMessagesFromDB]);

  // Auto-reload when app returns from background — always reload if there was
  // a stream in progress OR if the app was hidden for any period
  useEffect(() => {
    let hiddenSince: number | null = null;
    const handler = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      // Visible again
      if (!activeConvId) return;
      const wasInterrupted = streamInterruptedRef.current;
      const wasHiddenLongEnough = hiddenSince && (Date.now() - hiddenSince) > 2000;
      if (wasInterrupted || wasHiddenLongEnough) {
        reloadMessagesFromDB(activeConvId);
        streamInterruptedRef.current = false;
        loadConversations();
      }
      hiddenSince = null;
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [activeConvId, reloadMessagesFromDB, loadConversations]);

  // Detect if an error is a network/background interruption (not user-initiated)
  const isBackgroundNetworkError = (err: any): boolean => {
    if (err.name === "AbortError" && !abortRef.current?.signal.aborted) return true;
    if (document.visibilityState === "hidden") return true;
    if (err instanceof TypeError) return true;
    if (err.message?.includes("network") || err.message?.includes("fetch") || err.message?.includes("Failed to fetch")) return true;
    return false;
  };

  const handleStreamError = (err: any) => {
    if (mountedRef.current) {
      setIsStreaming(false);
      setIsTranscribing(false);
    }
    if (isBackgroundNetworkError(err)) {
      streamInterruptedRef.current = true;
      // If already visible, reload immediately
      if (document.visibilityState === "visible" && activeConvId) {
        reloadMessagesFromDB(activeConvId);
        streamInterruptedRef.current = false;
      }
      return;
    }
    if (err.message === "rate_limit") {
      toast.error("Demasiadas solicitudes. Intentá de nuevo en un momento.");
    } else if (err.message === "payment_required") {
      toast.error("Créditos insuficientes. Contactá al administrador.");
    } else if (err.name !== "AbortError") {
      toast.error("Error al conectar con Alan. Intentá de nuevo.");
    }
  };

  const handleSend = async (text: string, chatAttachments?: ChatAttachment[]) => {
    if (isStreaming) return;

    let convId = activeConvId;
    if (!convId) {
      try {
        convId = await createConversation();
        skipNextLoadRef.current = true;
        setActiveConvId(convId);
      } catch {
        toast.error("Error al crear conversación");
        return;
      }
    }

    const { msgAttachments, pdfTexts } = await processAttachments(chatAttachments);

    let displayContent = text;
    let aiContent = text;
    let msgQuotedText: string | undefined;
    if (quotedText) {
      let cleanQuote = quotedText
        .replace(/!\[.*?\]\(.*?\)/g, "[imagen]")
        .replace(/https?:\/\/\S{60,}/g, "[enlace]")
        .replace(/\*\*/g, "")
        .trim();
      if (cleanQuote.length > 200) cleanQuote = cleanQuote.slice(0, 200) + "…";
      msgQuotedText = cleanQuote;
      const plainQuote = cleanQuote
        .replace(/🏠/g, "Propiedad:")
        .replace(/💰/g, "Precio:")
        .replace(/📍/g, "Ubicación:")
        .replace(/📐/g, "Superficie:")
        .replace(/🏢/g, "Oficina:")
        .replace(/🔗/g, "Link:")
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
      aiContent = `[REFERENCIA - el usuario cita este mensaje anterior como contexto. NO repetir esta info como tarjeta de propiedad. Ejecutar la acción que pide el usuario.]\n${plainQuote}\n[FIN REFERENCIA]\n\n${aiContent}`;
      setQuotedText(null);
    }
    if (pdfTexts.length > 0) {
      const pdfContext = pdfTexts.join("\n\n");
      aiContent = aiContent ? `${aiContent}\n\n${pdfContext}` : pdfContext;
    }

    const hasImages = msgAttachments && msgAttachments.some(a => a.type === "image");
    const hasPdfs = pdfTexts.length > 0;
    const fallbackDisplay = hasImages ? "(imagen adjunta)" : hasPdfs ? "(archivo adjunto)" : "(archivo adjunto)";
    const fallbackAI = hasImages ? "(imagen adjunta)" : hasPdfs ? aiContent : "(archivo adjunto)";
    const userMsg: Msg = {
      role: "user",
      content: aiContent || fallbackAI,
      attachments: msgAttachments,
      quotedText: msgQuotedText,
    };
    const displayText = displayContent || fallbackDisplay;
    // Contenido "para la IA" cuando difiere del que se muestra (cita / texto de PDF embebido).
    const aiForPersist = aiContent && aiContent !== displayText ? aiContent : null;
    const displayMsg: Msg = {
      role: "user",
      content: displayText,
      aiContent: aiForPersist ?? undefined,
      attachments: msgAttachments,
      quotedText: msgQuotedText,
    };
    const newMessages = [...messages, displayMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    // Subimos los adjuntos a Storage para poder reconstruirlos al recargar.
    const { data: { session } } = await supabase.auth.getSession();
    const attachmentRefs = session?.user.id
      ? await persistAttachments(session.user.id, convId, msgAttachments)
      : null;

    // Persistimos el mensaje del usuario ANTES de arrancar el stream (orden garantizado:
    // user antes que assistant). Si falla, no streameamos → evitamos un assistant sin user
    // y no perdemos el mensaje en silencio.
    const { error: userInsertError } = await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: displayText,
      ai_content: aiForPersist,
      attachments: (attachmentRefs as Json) ?? null,
    });
    if (userInsertError) {
      console.error("Error guardando mensaje del usuario:", userInsertError);
      toast.error("No se pudo guardar tu mensaje. Intentá de nuevo.");
      if (mountedRef.current) setIsStreaming(false);
      return;
    }

    let assistantContent = "";
    let allAssistantMessages: string[] = [];
    let needsNewBubble = false;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const aiMessages = [...historyForAI(messages), userMsg];
      await streamChat({
        messages: aiMessages,
        conversationId: convId!,
        signal: controller.signal,
        onDelta: (chunk) => {
          assistantContent += chunk;
          if (!mountedRef.current) return;
          const snapshot = assistantContent;
          const startNew = needsNewBubble;
          if (startNew) needsNewBubble = false;
          setMessages((prev) => {
            if (startNew) return [...prev, { role: "assistant" as const, content: snapshot }];
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m));
            return [...prev, { role: "assistant" as const, content: snapshot }];
          });
        },
        onNewMessage: () => {
          if (assistantContent.trim()) allAssistantMessages.push(assistantContent.trim());
          assistantContent = "";
          needsNewBubble = true;
          if (!mountedRef.current) return;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content.trim() } : m));
            return prev;
          });
        },
        onDone: async () => {
          if (mountedRef.current) setIsStreaming(false);
          feedbackReceive();
          // Message is already saved to DB by the edge function
          // Just update local state and mark as read
          if (markAsRead) await markAsRead(convId!);
          loadConversations();
        },
      });
    } catch (err: any) {
      handleStreamError(err);
    }
  };

  const handleSendAudio = async (blob: Blob, localUrl: string) => {
    if (isStreaming || isTranscribing) return;

    let convId = activeConvId;
    if (!convId) {
      try {
        convId = await createConversation();
        skipNextLoadRef.current = true;
        setActiveConvId(convId);
      } catch {
        toast.error("Error al crear conversación");
        return;
      }
    }

    const audioMsg: Msg = { role: "user", content: "(mensaje de voz)", audioUrl: localUrl };
    setMessages((prev) => [...prev, audioMsg]);
    setIsTranscribing(true);

    try {
      const transcript = await transcribeAudio(blob);
      if (!transcript) {
        toast.error("No se pudo transcribir el audio.");
        setIsTranscribing(false);
        return;
      }

      const displayContent = `🎙️ ${transcript}`;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.audioUrl === localUrl
            ? { ...m, content: displayContent }
            : m
        )
      );
      setIsTranscribing(false);

      // content = lo que se muestra ("🎙️ …"); ai_content = lo que ve la IA (transcript limpio).
      const { error: userInsertError } = await supabase.from("messages").insert({ conversation_id: convId!, role: "user", content: displayContent, ai_content: transcript });
      if (userInsertError) {
        console.error("Error guardando mensaje de voz del usuario:", userInsertError);
        toast.error("No se pudo guardar tu mensaje. Intentá de nuevo.");
        return;
      }

      const msgsForAI: Msg[] = [...historyForAI(messages), { role: "user", content: transcript }];
      setIsStreaming(true);

      let assistantContent = "";
      let allAssistantMessages: string[] = [];
      let needsNewBubble = false;
      const controller = new AbortController();
      abortRef.current = controller;

      await streamChat({
        messages: msgsForAI,
        conversationId: convId!,
        signal: controller.signal,
        onDelta: (chunk) => {
          assistantContent += chunk;
          if (!mountedRef.current) return;
          const snapshot = assistantContent;
          const startNew = needsNewBubble;
          if (startNew) needsNewBubble = false;
          setMessages((prev) => {
            if (startNew) return [...prev, { role: "assistant" as const, content: snapshot }];
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m));
            return [...prev, { role: "assistant" as const, content: snapshot }];
          });
        },
        onNewMessage: () => {
          if (assistantContent.trim()) allAssistantMessages.push(assistantContent.trim());
          assistantContent = "";
          needsNewBubble = true;
          if (!mountedRef.current) return;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content.trim() } : m));
            return prev;
          });
        },
        onDone: async () => {
          if (mountedRef.current) setIsStreaming(false);
          feedbackReceive();
          // Message is already saved to DB by the edge function
          if (markAsRead) await markAsRead(convId!);
          loadConversations();
        },
      });
    } catch (err: any) {
      handleStreamError(err);
    }
  };

  return {
    messages,
    isStreaming,
    isProcessingPdf,
    isTranscribing,
    quotedText,
    setQuotedText,
    handleSend,
    handleSendAudio,
  };
}
