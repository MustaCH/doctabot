// src/components/ContactTags.tsx
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

interface Tag { id: string; name: string; color: string; }

export default function ContactTags({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [assigned, setAssigned] = useState<Tag[]>([]);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: tags }, { data: links }] = await Promise.all([
      supabase.from("tags").select("id, name, color").eq("user_id", user.id),
      supabase.from("client_tags").select("tag_id").eq("client_id", clientId),
    ]);
    setAllTags((tags as Tag[]) ?? []);
    const ids = new Set((links ?? []).map((l) => l.tag_id));
    setAssigned(((tags as Tag[]) ?? []).filter((t) => ids.has(t.id)));
  }, [user, clientId]);

  useEffect(() => { load(); }, [load]);

  const assign = async (tag: Tag) => {
    const { error } = await supabase.from("client_tags").insert({ client_id: clientId, tag_id: tag.id });
    if (error) { toast.error("No se pudo agregar la etiqueta"); return; }
    load();
  };

  const unassign = async (tag: Tag) => {
    await supabase.from("client_tags").delete().match({ client_id: clientId, tag_id: tag.id });
    load();
  };

  const createAndAssign = async () => {
    if (!user || !newName.trim()) return;
    const { data, error } = await supabase
      .from("tags")
      .insert({ user_id: user.id, name: newName.trim().slice(0, 40), color: "#3b82f6" })
      .select("id, name, color")
      .single();
    if (error || !data) { toast.error("No se pudo crear la etiqueta"); return; }
    setNewName("");
    await assign(data as Tag);
  };

  const unassignedTags = allTags.filter((t) => !assigned.some((a) => a.id === t.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
          {t.name}
          <button onClick={() => unassign(t)} className="opacity-80 hover:opacity-100"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]"><Plus className="h-3 w-3" /> Etiqueta</Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2" align="start">
          {unassignedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {unassignedTags.map((t) => (
                <button key={t.id} onClick={() => assign(t)} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nueva etiqueta" className="h-7 text-xs" maxLength={40} onKeyDown={(e) => { if (e.key === "Enter") createAndAssign(); }} />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={createAndAssign} disabled={!newName.trim()}>Crear</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
