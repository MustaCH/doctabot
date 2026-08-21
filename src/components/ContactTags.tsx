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
    <div className="flex flex-wrap items-center gap-2">
      {assigned.map((t) => (
        <span key={t.id} className="inline-flex h-8 items-center gap-0.5 rounded-full pl-3 pr-1 text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
          {t.name}
          <button
            type="button"
            onClick={() => unassign(t)}
            aria-label={`Quitar etiqueta ${t.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-full opacity-80 transition-opacity hover:bg-black/15 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1 rounded-full border-white/10 bg-white/[0.06] px-3 text-[11px]"><Plus className="h-3.5 w-3.5" /> Etiqueta</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2.5 rounded-[14px] border-white/[0.09] bg-[hsl(var(--card))] p-3" align="start">
          {unassignedTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unassignedTags.map((t) => (
                <button key={t.id} type="button" onClick={() => assign(t)} className="inline-flex h-8 items-center rounded-full px-3 text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nueva etiqueta" aria-label="Nueva etiqueta" className="h-[38px] rounded-[12px] px-3 text-xs md:text-xs" maxLength={40} onKeyDown={(e) => { if (e.key === "Enter") createAndAssign(); }} />
            <Button size="sm" className="px-3 text-xs" onClick={createAndAssign} disabled={!newName.trim()}>Crear</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
