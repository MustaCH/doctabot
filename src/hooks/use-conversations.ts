import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  client_name?: string;
  conversation_type?: string;
}

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at, conversation_type, client_id, clients(full_name)")
      .order("updated_at", { ascending: false });
    if (data) {
      setConversations(
        data.map((c: any) => ({
          id: c.id,
          title: c.title,
          updated_at: c.updated_at,
          conversation_type: c.conversation_type ?? undefined,
          client_name: c.clients?.full_name ?? undefined,
        }))
      );
    }
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
  };
}
