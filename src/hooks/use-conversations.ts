import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  client_name?: string;
  conversation_type?: string;
  has_unread?: boolean;
}

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvIdRaw] = useState<string | null>(
    () => sessionStorage.getItem("alan_active_conv") ?? null
  );

  const setActiveConvId = useCallback((id: string | null) => {
    setActiveConvIdRaw(id);
    if (id) sessionStorage.setItem("alan_active_conv", id);
    else sessionStorage.removeItem("alan_active_conv");
  }, []);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at, conversation_type, client_id, clients(full_name), last_read_at")
      .order("updated_at", { ascending: false });
    if (data) {
      // Fetch latest assistant message per conversation to detect unread
      const convIds = data.map((c: any) => c.id);
      const { data: latestMsgs } = await supabase
        .from("messages")
        .select("conversation_id, created_at")
        .in("conversation_id", convIds)
        .eq("role", "assistant")
        .order("created_at", { ascending: false });

      // Build map: conv_id -> latest assistant message time
      const latestMap = new Map<string, string>();
      if (latestMsgs) {
        for (const m of latestMsgs) {
          if (!latestMap.has(m.conversation_id)) {
            latestMap.set(m.conversation_id, m.created_at);
          }
        }
      }

      setConversations(
        data.map((c: any) => {
          const lastMsg = latestMap.get(c.id);
          const lastRead = c.last_read_at;
          const hasUnread = lastMsg ? (!lastRead || new Date(lastMsg) > new Date(lastRead)) : false;
          return {
            id: c.id,
            title: c.title,
            updated_at: c.updated_at,
            conversation_type: c.conversation_type ?? undefined,
            client_name: c.clients?.full_name ?? undefined,
            has_unread: hasUnread,
          };
        })
      );
    }
  }, []);

  const markAsRead = useCallback(async (convId: string) => {
    await supabase
      .from("conversations")
      .update({ last_read_at: new Date().toISOString() })
      .eq("id", convId);
    // Update local state immediately
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, has_unread: false } : c))
    );
  }, []);

  const createConversation = useCallback(async (): Promise<string> => {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId!, title: "Nueva conversación" })
      .select("id")
      .single();
    if (error) throw error;
    await loadConversations();
    return data.id;
  }, [userId, loadConversations]);

  const handleNewConversation = useCallback(async () => {
    try {
      const id = await createConversation();
      setActiveConvId(id);
    } catch {
      toast.error("Error al crear conversación");
    }
  }, [createConversation]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await supabase.from("messages").delete().eq("conversation_id", id);
      await supabase.from("conversations").delete().eq("id", id);
      if (activeConvId === id) {
        setActiveConvId(null);
      }
      loadConversations();
    },
    [activeConvId, loadConversations]
  );

  const handleRenameConversation = useCallback(
    async (id: string, title: string) => {
      await supabase.from("conversations").update({ title }).eq("id", id);
      loadConversations();
    },
    [loadConversations]
  );

  return {
    conversations,
    activeConvId,
    setActiveConvId,
    loadConversations,
    createConversation,
    handleNewConversation,
    handleDeleteConversation,
    handleRenameConversation,
    markAsRead,
  };
}
