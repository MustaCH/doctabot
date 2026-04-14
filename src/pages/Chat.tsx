import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversations } from "@/hooks/use-conversations";
import { useChatMessages } from "@/hooks/use-chat-messages";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import ConversationList from "@/components/ConversationList";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, UserCircle, ChevronDown, Loader2, Search, CalendarDays, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import alanAvatar from "@/assets/alan-avatar.png";
import { useSwUpdate } from "@/hooks/use-sw-update";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import PullToRefreshIndicator from "@/components/PullToRefreshIndicator";

const Chat = () => {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { updateAvailable } = useSwUpdate();

  const {
    conversations,
    activeConvId,
    setActiveConvId,
    loadConversations,
    createConversation,
    handleNewConversation: rawNewConv,
    handleDeleteConversation,
    handleRenameConversation,
    markAsRead,
  } = useConversations(user?.id);

  const totalUnread = useMemo(
    () => conversations.filter((c) => c.has_unread).length,
    [conversations]
  );

  const {
    messages,
    isStreaming,
    isProcessingPdf,
    isTranscribing,
    quotedText,
    setQuotedText,
    handleSend,
    handleSendAudio,
  } = useChatMessages(activeConvId, createConversation, setActiveConvId, loadConversations);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Mark active conversation as read
  useEffect(() => {
    if (activeConvId) {
      markAsRead(activeConvId);
    }
  }, [activeConvId, markAsRead]);

  const { pullDistance, refreshing } = usePullToRefresh({
    onRefresh: loadConversations,
    scrollRef,
  });

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

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleNewConversation = async () => {
    await rawNewConv();
    setSidebarOpen(false);
  };

  const activeConvTitle = useMemo(() => {
    if (!activeConvId) return null;
    const conv = conversations.find((c) => c.id === activeConvId);
    return conv?.title && conv.title !== "Nueva conversación" ? conv.title : null;
  }, [activeConvId, conversations]);

  const userAvatar = user?.user_metadata?.avatar_url;
  const userName = user?.user_metadata?.full_name;

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
            className="h-8 w-8 md:hidden relative"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-4.5 w-4.5" />
            {totalUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
                {totalUnread}
              </span>
            )}
          </Button>
          <img src={alanAvatar} alt="Alan" className="h-8 w-8 rounded-lg" />
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-semibold">Alan</p>
            <div className="h-4 relative overflow-hidden">
              <p
                key={activeConvTitle || "default"}
                className="text-xs text-muted-foreground truncate animate-slide-up-in"
              >
                {activeConvTitle || "Asistente inmobiliario"}
              </p>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 relative"
            onClick={() => navigate("/profile")}
          >
            <UserCircle className="h-5 w-5" />
            {updateAvailable && (
              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive border-2 border-card" />
            )}
          </Button>
        </div>

        {/* Messages */}
        <div className="relative flex-1 overflow-hidden">
          <div className={`aurora-bg ${isStreaming ? "aurora-active" : "aurora-idle"}`} />
          <div ref={scrollRef} className="relative z-10 h-full overflow-y-auto overflow-x-hidden py-4">
          <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <img src={alanAvatar} alt="Alan" className="h-20 w-20 rounded-2xl" />
              <h2 className="text-lg font-semibold">¡Hola! Soy Alan 👋</h2>
              <p className="max-w-xs text-sm text-muted-foreground">
                Tu asistente de RE/MAX Docta. Puedo buscar propiedades, compararlas, guardar favoritos y generar fichas. ¡Preguntame lo que necesites!
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 max-w-sm">
                {[
                  { label: "Buscar departamentos en Nueva Córdoba", icon: Search },
                  { label: "Ver mi agenda de hoy", icon: CalendarDays },
                  { label: "Listar mis clientes", icon: Users },
                ].map(({ label, icon: Icon }) => (
                  <button
                    key={label}
                    onClick={() => handleSend(label)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent active:scale-[0.97]"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              role={msg.role}
              content={msg.quotedText ? msg.content.replace(/^>.*\n?/gm, "").trim() : msg.content}
              attachments={msg.attachments}
              audioUrl={msg.audioUrl}
              isTranscribing={isTranscribing && i === messages.length - 1 && !!msg.audioUrl}
              userAvatar={userAvatar}
              userName={userName}
              quotedText={msg.quotedText}
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

        {/* Transcribing indicator */}
        {isTranscribing && (
          <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Transcribiendo audio...
          </div>
        )}

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
          onSendAudio={handleSendAudio}
          disabled={isStreaming || isProcessingPdf || isTranscribing}
          quotedText={quotedText}
          onClearQuote={() => setQuotedText(null)}
        />
      </div>
    </div>
  );
};

export default Chat;
