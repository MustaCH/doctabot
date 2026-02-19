import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, type Msg, type MsgAttachment } from "@/lib/stream-chat";
import * as pdfjsLib from "pdfjs-dist";
import ChatMessage from "@/components/ChatMessage";
import ChatInput, { type ChatAttachment } from "@/components/ChatInput";
import ConversationList from "@/components/ConversationList";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, UserCircle, ChevronDown, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import alanAvatar from "@/assets/alan-avatar.png";
import { feedbackReceive } from "@/hooks/use-feedback";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

const Chat = () => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  const [quotedText, setQuotedText] = useState<string | null>(null);

  // Scroll listener for floating button
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distanceFromBottom > 100);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Load conversations
  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", activeConvId)
        .order("created_at", { ascending: true });
      if (data) {
        // Split assistant messages that were saved combined with ---
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

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const createConversation = async (): Promise<string> => {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user!.id, title: "Nueva conversación" })
      .select("id")
      .single();
    if (error) throw error;
    await loadConversations();
    return data.id;
  };

  const handleNewConversation = async () => {
    try {
      const id = await createConversation();
      setActiveConvId(id);
      setSidebarOpen(false);
    } catch {
      toast.error("Error al crear conversación");
    }
  };

  const handleDeleteConversation = async (id: string) => {
    // Delete messages first, then conversation
    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
    loadConversations();
  };

  const handleRenameConversation = async (id: string, title: string) => {
    await supabase.from("conversations").update({ title }).eq("id", id);
    loadConversations();
  };

  const compressImage = (file: File, maxDim = 1024, quality = 0.7): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.split(",")[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const extractPdfText = async (file: File): Promise<string> => {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        if (pageText.trim()) pages.push(`--- Página ${i} ---\n${pageText}`);
      }
      return pages.join("\n\n") || "(No se pudo extraer texto del PDF)";
    } catch (e) {
      console.error("PDF extraction error:", e);
      return "(Error al leer el PDF)";
    }
  };

  const handleSend = async (text: string, chatAttachments?: ChatAttachment[]) => {
    if (isStreaming) return;

    let convId = activeConvId;
    if (!convId) {
      try {
        convId = await createConversation();
        setActiveConvId(convId);
      } catch {
        toast.error("Error al crear conversación");
        return;
      }
    }

    // Process attachments
    let msgAttachments: MsgAttachment[] | undefined;
    let pdfTexts: string[] = [];
    if (chatAttachments?.length) {
      const imageAtts = chatAttachments.filter((a) => a.file.type.startsWith("image/"));
      const pdfAtts = chatAttachments.filter((a) => a.file.type === "application/pdf");

      // Compress images
      if (imageAtts.length) {
        msgAttachments = await Promise.all(
          imageAtts.map(async (a) => ({
            type: "image" as const,
            base64: await compressImage(a.file),
            mimeType: "image/jpeg",
            fileName: a.file.name,
          }))
        );
      }

      // Extract PDF text
      if (pdfAtts.length > 0) {
        setIsProcessingPdf(true);
        try {
          for (const att of pdfAtts) {
            const pdfText = await extractPdfText(att.file);
            pdfTexts.push(`📄 Documento "${att.file.name}":\n${pdfText}`);
          }
        } finally {
          setIsProcessingPdf(false);
        }
      }
    }

    // Build message content with PDF text and quoted text inline
    let messageContent = text;
    if (quotedText) {
      // Clean the quote: strip markdown images, long URLs, and excessive formatting
      let cleanQuote = quotedText
        .replace(/!\[.*?\]\(.*?\)/g, "[imagen]") // markdown images → [imagen]
        .replace(/https?:\/\/\S{60,}/g, "[enlace]") // long URLs → [enlace]
        .replace(/\*\*/g, "") // strip bold
        .trim();
      if (cleanQuote.length > 200) cleanQuote = cleanQuote.slice(0, 200) + "…";
      messageContent = `> ${cleanQuote.split("\n").join("\n> ")}\n\n${messageContent}`;
      setQuotedText(null);
    }
    if (pdfTexts.length > 0) {
      const pdfContext = pdfTexts.join("\n\n");
      messageContent = messageContent
        ? `${messageContent}\n\n${pdfContext}`
        : pdfContext;
    }

    const hasImages = msgAttachments && msgAttachments.length > 0;
    const hasPdfs = pdfTexts.length > 0;
    const fallbackText = hasImages ? "(imagen adjunta)" : hasPdfs ? messageContent : "(archivo adjunto)";
    const userMsg: Msg = {
      role: "user",
      content: messageContent || fallbackText,
      attachments: msgAttachments,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    // Save user message
    await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: messageContent || fallbackText,
    });

    // Update conversation title from first message
    if (messages.length === 0) {
      const title = text.slice(0, 60) + (text.length > 60 ? "..." : "");
      await supabase.from("conversations").update({ title }).eq("id", convId);
      loadConversations();
    }

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
          // Capture values NOW before React batching changes them
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
          // Trim trailing whitespace from last bubble
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
          // Collect the last message too
          if (assistantContent.trim()) {
            allAssistantMessages.push(assistantContent.trim());
          }
          // Save all assistant messages to DB as one combined message
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

  const userAvatar = user?.user_metadata?.avatar_url;
  const userName = user?.user_metadata?.full_name;
  const navigate = useNavigate();

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden w-72 shrink-0 border-r border-border md:block">
        <ConversationList
          conversations={conversations}
          activeId={activeConvId ?? undefined}
          onSelect={setActiveConvId}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
          onRename={handleRenameConversation}
        />
      </div>

      {/* Mobile sidebar (sheet) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Conversaciones</SheetTitle>
          <ConversationList
            conversations={conversations}
            activeId={activeConvId ?? undefined}
            onSelect={setActiveConvId}
            onNew={handleNewConversation}
            onDelete={handleDeleteConversation}
            onRename={handleRenameConversation}
            onClose={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Chat area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-4.5 w-4.5" />
          </Button>
          <img src={alanAvatar} alt="Alan" className="h-8 w-8 rounded-lg" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Alan</p>
            <p className="text-xs text-muted-foreground">Asistente inmobiliario</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => navigate("/profile")}
          >
            <UserCircle className="h-5 w-5" />
          </Button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <img src={alanAvatar} alt="Alan" className="h-20 w-20 rounded-2xl" />
              <h2 className="text-lg font-semibold">¡Hola! Soy Alan 👋</h2>
              <p className="max-w-xs text-sm text-muted-foreground">
                Tu asistente de RE/MAX Docta. Puedo buscar propiedades, compararlas, guardar favoritos y generar fichas. ¡Preguntame lo que necesites!
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              role={msg.role}
              content={msg.content}
              attachments={msg.attachments}
              userAvatar={userAvatar}
              userName={userName}
              onReply={msg.role === "assistant" ? (content) => setQuotedText(content) : undefined}
            />
          ))}
          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-2.5 px-4 py-1.5">
              <img src={alanAvatar} alt="Alan" className="h-7 w-7 rounded-full mt-1" />
              <div className="rounded-2xl rounded-tl-md bg-[hsl(var(--chat-assistant))] px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        <div className="relative">
          <button
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
            className={`absolute -top-12 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md transition-all duration-200 ${
              showScrollBtn ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none"
            }`}
          >
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* PDF processing indicator */}
        {isProcessingPdf && (
          <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Procesando PDF...
          </div>
        )}

        {/* Input */}
        <ChatInput
          onSend={(text, atts) => handleSend(text, atts)}
          disabled={isStreaming || isProcessingPdf}
          quotedText={quotedText}
          onClearQuote={() => setQuotedText(null)}
        />
      </div>
    </div>
  );
};

export default Chat;
