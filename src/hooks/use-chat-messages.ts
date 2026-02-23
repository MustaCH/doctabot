import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, type Msg, type MsgAttachment } from "@/lib/stream-chat";
import { toast } from "sonner";
import { feedbackReceive } from "@/hooks/use-feedback";
import type { ChatAttachment } from "@/components/ChatInput";
import { useFileProcessing } from "@/hooks/use-file-processing";
import { transcribeAudio } from "@/hooks/use-audio-recorder";

export function useChatMessages(
  activeConvId: string | null,
  createConversation: () => Promise<string>,
  setActiveConvId: (id: string) => void,
  loadConversations: () => Promise<void>
) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipNextLoadRef = useRef(false);
  const { isProcessingPdf, processAttachments } = useFileProcessing();

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
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", activeConvId)
        .order("created_at", { ascending: true });
      if (data) {
        const expanded: Msg[] = [];
        for (const msg of data) {
          if (msg.role === "assistant" && msg.content.includes("\n\n---\n\n")) {
            const parts = msg.content.split("\n\n---\n\n");
            for (const part of parts) {
              if (part.trim()) expanded.push({ role: "assistant", content: part.trim() });
            }
          } else {
            expanded.push(msg as Msg);
          }
        }
        setMessages(expanded);
      }
    })();
  }, [activeConvId]);

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

    // Process attachments
    const { msgAttachments, pdfTexts } = await processAttachments(chatAttachments);

    // Build message content with PDF text and quoted text inline
    let messageContent = text;
    let msgQuotedText: string | undefined;
    if (quotedText) {
      let cleanQuote = quotedText
        .replace(/!\[.*?\]\(.*?\)/g, "[imagen]")
        .replace(/https?:\/\/\S{60,}/g, "[enlace]")
        .replace(/\*\*/g, "")
        .trim();
      if (cleanQuote.length > 200) cleanQuote = cleanQuote.slice(0, 200) + "…";
      msgQuotedText = cleanQuote;
      // Still prepend quote for AI context
      messageContent = `> ${cleanQuote.split("\n").join("\n> ")}\n\n${messageContent}`;
      setQuotedText(null);
    }
    if (pdfTexts.length > 0) {
      const pdfContext = pdfTexts.join("\n\n");
      messageContent = messageContent ? `${messageContent}\n\n${pdfContext}` : pdfContext;
    }

    const hasImages = msgAttachments && msgAttachments.length > 0;
    const hasPdfs = pdfTexts.length > 0;
    const fallbackText = hasImages ? "(imagen adjunta)" : hasPdfs ? messageContent : "(archivo adjunto)";
    const userMsg: Msg = {
      role: "user",
      content: messageContent || fallbackText,
      attachments: msgAttachments,
      quotedText: msgQuotedText,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: messageContent || fallbackText,
    });

    let assistantContent = "";
    let allAssistantMessages: string[] = [];
    let needsNewBubble = false;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        messages: newMessages,
        conversationId: convId!,
        signal: controller.signal,
        onDelta: (chunk) => {
          assistantContent += chunk;
          const snapshot = assistantContent;
          const startNew = needsNewBubble;
          if (startNew) needsNewBubble = false;
          setMessages((prev) => {
            if (startNew) {
              return [...prev, { role: "assistant" as const, content: snapshot }];
            }
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m));
            }
            return [...prev, { role: "assistant" as const, content: snapshot }];
          });
        },
        onNewMessage: () => {
          if (assistantContent.trim()) {
            allAssistantMessages.push(assistantContent.trim());
          }
          assistantContent = "";
          needsNewBubble = true;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content.trim() } : m));
            }
            return prev;
          });
        },
        onDone: async () => {
          setIsStreaming(false);
          feedbackReceive();
          if (assistantContent.trim()) {
            allAssistantMessages.push(assistantContent.trim());
          }
          const fullContent = allAssistantMessages.join("\n\n---\n\n");
          if (fullContent) {
            await supabase.from("messages").insert({
              conversation_id: convId!,
              role: "assistant",
              content: fullContent,
            });
            await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId!);
            loadConversations();
          }
        },
      });
    } catch (err: any) {
      setIsStreaming(false);
      if (err.message === "rate_limit") {
        toast.error("Demasiadas solicitudes. Intentá de nuevo en un momento.");
      } else if (err.message === "payment_required") {
        toast.error("Créditos insuficientes. Contactá al administrador.");
      } else if (err.name !== "AbortError") {
        toast.error("Error al conectar con Alan. Intentá de nuevo.");
      }
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

    // Add audio message immediately
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

      // Update the audio message with transcribed text
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.audioUrl === localUrl
            ? { ...m, content: displayContent }
            : m
        )
      );
      setIsTranscribing(false);

      // Save to DB
      await supabase.from("messages").insert({
        conversation_id: convId!,
        role: "user",
        content: displayContent,
      });

      // Now send to Alan
      const msgsForAI: Msg[] = [...messages, { role: "user", content: transcript }];
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
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content.trim() } : m));
            return prev;
          });
        },
        onDone: async () => {
          setIsStreaming(false);
          feedbackReceive();
          if (assistantContent.trim()) allAssistantMessages.push(assistantContent.trim());
          const fullContent = allAssistantMessages.join("\n\n---\n\n");
          if (fullContent) {
            await supabase.from("messages").insert({ conversation_id: convId!, role: "assistant", content: fullContent });
            await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId!);
            loadConversations();
          }
        },
      });
    } catch (err: any) {
      setIsStreaming(false);
      setIsTranscribing(false);
      if (err.name !== "AbortError") {
        toast.error("Error al procesar el audio. Intentá de nuevo.");
      }
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
