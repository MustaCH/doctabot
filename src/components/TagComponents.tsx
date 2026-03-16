import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, X, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import type { Tag } from "@/hooks/use-tags";

const TAG_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280", "#0d9488",
];

interface TagManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: Tag[];
  onCreateTag: (name: string, color: string) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
}

export function TagManagerDialog({ open, onOpenChange, tags, onCreateTag, onDeleteTag }: TagManagerDialogProps) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[5]);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateTag(newName, newColor);
      setNewName("");
      toast.success("Etiqueta creada");
    } catch {
      toast.error("Error al crear etiqueta (puede que ya exista)");
    }
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <TagIcon className="h-4 w-4 text-primary" />
            Gestionar etiquetas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Create new */}
          <div className="space-y-2">
            <Input
              placeholder="Nombre de la etiqueta..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="flex items-center gap-2">
              <div className="flex gap-1 flex-wrap flex-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={`h-6 w-6 rounded-full border-2 transition-all ${
                      newColor === c ? "border-foreground scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <Button size="sm" className="gap-1 h-8" onClick={handleCreate} disabled={!newName.trim() || creating}>
                <Plus className="h-3 w-3" /> Crear
              </Button>
            </div>
          </div>

          {/* Existing tags */}
          {tags.length > 0 && (
            <div className="border-t border-border pt-3 space-y-1.5">
              {tags.map((tag) => (
                <div key={tag.id} className="flex items-center justify-between gap-2">
                  <Badge
                    className="text-xs text-white border-0"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      await onDeleteTag(tag.id);
                      toast.success("Etiqueta eliminada");
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ClientTagPickerProps {
  clientId: string;
  allTags: Tag[];
  assignedTags: Tag[];
  onAssign: (clientId: string, tagId: string) => Promise<void>;
  onRemove: (clientId: string, tagId: string) => Promise<void>;
}

export function ClientTagPicker({ clientId, allTags, assignedTags, onAssign, onRemove }: ClientTagPickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const assignedIds = new Set(assignedTags.map(t => t.id));
  const unassigned = allTags.filter(t => !assignedIds.has(t.id));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {assignedTags.map((tag) => (
        <Badge
          key={tag.id}
          className="text-[10px] text-white border-0 gap-0.5 pr-1 cursor-pointer hover:opacity-80"
          style={{ backgroundColor: tag.color }}
          onClick={() => onRemove(clientId, tag.id)}
        >
          {tag.name}
          <X className="h-2.5 w-2.5 ml-0.5" />
        </Badge>
      ))}
      {unassigned.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="h-3 w-3" />
          </button>
          {showPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
              <div className="absolute left-0 top-7 z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1.5 shadow-lg space-y-0.5">
                {unassigned.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={async () => {
                      await onAssign(clientId, tag.id);
                      setShowPicker(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent transition-colors"
                  >
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
