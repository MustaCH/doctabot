import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ClientTagEntry {
  client_id: string;
  tag_id: string;
}

export function useTags() {
  const { user } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [clientTags, setClientTags] = useState<ClientTagEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTags = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("user_id", user.id)
      .order("name");
    setTags((data as Tag[]) ?? []);
  }, [user]);

  const loadClientTags = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("client_tags")
      .select("client_id, tag_id");
    setClientTags((data as ClientTagEntry[]) ?? []);
  }, [user]);

  const reload = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadTags(), loadClientTags()]);
    setLoading(false);
  }, [loadTags, loadClientTags]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createTag = useCallback(async (name: string, color: string) => {
    if (!user) return;
    const { error } = await supabase.from("tags").insert({ user_id: user.id, name: name.trim(), color });
    if (error) throw error;
    await loadTags();
  }, [user, loadTags]);

  const deleteTag = useCallback(async (tagId: string) => {
    await supabase.from("client_tags").delete().eq("tag_id", tagId);
    await supabase.from("tags").delete().eq("id", tagId);
    await reload();
  }, [reload]);

  const updateTag = useCallback(async (tagId: string, name: string, color: string) => {
    await supabase.from("tags").update({ name: name.trim(), color }).eq("id", tagId);
    await loadTags();
  }, [loadTags]);

  const assignTag = useCallback(async (clientId: string, tagId: string) => {
    const { error } = await supabase.from("client_tags").insert({ client_id: clientId, tag_id: tagId });
    if (error && !error.message.includes("duplicate")) throw error;
    await loadClientTags();
  }, [loadClientTags]);

  const removeTag = useCallback(async (clientId: string, tagId: string) => {
    await supabase.from("client_tags").delete().match({ client_id: clientId, tag_id: tagId });
    await loadClientTags();
  }, [loadClientTags]);

  const getClientTags = useCallback((clientId: string): Tag[] => {
    const tagIds = clientTags.filter(ct => ct.client_id === clientId).map(ct => ct.tag_id);
    return tags.filter(t => tagIds.includes(t.id));
  }, [tags, clientTags]);

  return { tags, clientTags, loading, createTag, deleteTag, updateTag, assignTag, removeTag, getClientTags, reload };
}
