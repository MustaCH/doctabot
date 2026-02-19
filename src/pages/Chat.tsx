import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, type Msg } from "@/lib/stream-chat";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import ConversationList from "@/components/ConversationList";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, MessageSquare } from "lucide-react";
import { toast } from "sonner";

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
      if (data) setMessages(data as Msg[]);
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

  const handleSend = async (text: string) => {
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

    const userMsg: Msg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    // Save user message
    await supabase.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: text,
    });

    // Update conversation title from first message
    if (messages.length === 0) {
      const title = text.slice(0, 60) + (text.length > 60 ? "..." : "");
      await supabase.from("conversations").update({ title }).eq("id", convId);
      loadConversations();
    }

    let assistantContent = "";
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        messages: newMessages,
        conversationId: convId!,
        signal: controller.signal,
        onDelta: (chunk) => {
          assistantContent += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantContent } : m));
            }
            return [...prev, { role: "assistant", content: assistantContent }];
          });
        },
        onDone: async () => {
          setIsStreaming(false);
          if (assistantContent) {
            await supabase.from("messages").insert({
              conversation_id: convId!,
              role: "assistant",
              content: assistantContent,
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

  return (
    <div className="flex h-[100dvh] w-full">
      {/* Desktop sidebar */}
      <div className="hidden w-72 shrink-0 border-r border-border md:block">
        <ConversationList
          conversations={conversations}
          activeId={activeConvId ?? undefined}
          onSelect={setActiveConvId}
          onNew={handleNewConversation}
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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
            <MessageSquare className="h-4 w-4 text-accent-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">Alan</p>
            <p className="text-xs text-muted-foreground">Asistente inmobiliario</p>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <MessageSquare className="h-8 w-8 text-accent" />
              </div>
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
              userAvatar={userAvatar}
              userName={userName}
            />
          ))}
          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-2.5 px-4 py-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent">
                <MessageSquare className="h-3.5 w-3.5 text-accent-foreground" />
              </div>
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
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  );
};

export default Chat;
