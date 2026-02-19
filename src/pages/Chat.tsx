import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, type Msg, type MsgAttachment } from "@/lib/stream-chat";
import ChatMessage from "@/components/ChatMessage";
import ChatInput, { type ChatAttachment } from "@/components/ChatInput";
import ConversationList from "@/components/ConversationList";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, UserCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import alanAvatar from "@/assets/alan-avatar.png";

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

    // Convert files to base64
    let msgAttachments: MsgAttachment[] | undefined;
    if (chatAttachments?.length) {
      msgAttachments = await Promise.all(
        chatAttachments.map(async (a) => {
          const isImage = a.file.type.startsWith("image/");
          return {
            type: (isImage ? "image" : "file") as "image" | "file",
            base64: isImage ? await compressImage(a.file) : await fileToBase64(a.file),
            mimeType: isImage ? "image/jpeg" : a.file.type,
            fileName: a.file.name,
          };
        })
      );
      if (msgAttachments.length === 0) msgAttachments = undefined;
    }

    const hasImages = msgAttachments?.some((a) => a.type === "image");
    const fallbackText = hasImages ? "(imagen adjunta)" : "(archivo adjunto)";
    const userMsg: Msg = {
      role: "user",
      content: text || fallbackText,
      attachments: msgAttachments,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    // Save user message
    await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: text || fallbackText,
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
    <div className="flex h-[100dvh] w-full">
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
      <div className="flex flex-1 flex-col">
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
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

        {/* Input */}
        <ChatInput onSend={(text, atts) => handleSend(text, atts)} disabled={isStreaming} />
      </div>
    </div>
  );
};

export default Chat;
