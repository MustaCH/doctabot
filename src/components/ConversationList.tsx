import { useState, useRef, useEffect, useMemo } from "react";
import { MessageSquare, Plus, LogOut, Trash2, Pencil, Check, X, Search } from "lucide-react";
import SwipeableConversationItem from "@/components/SwipeableConversationItem";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  client_name?: string;
  conversation_type?: string;
  has_unread?: boolean;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onClose?: () => void;
}

const ConversationList = ({ conversations, activeId, onSelect, onNew, onDelete, onRename, onClose }: ConversationListProps) => {
  const { user, signOut } = useAuth();
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [search, setSearch] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => search.trim()
      ? conversations.filter((c) =>
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.client_name?.toLowerCase().includes(search.toLowerCase())
        )
      : conversations,
    [conversations, search]
  );

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const startEditing = (c: Conversation) => {
    setEditingId(c.id);
    setEditTitle(c.title);
  };

  const confirmEdit = () => {
    if (editingId && editTitle.trim()) {
      onRename?.(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 safe-top">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
            <MessageSquare className="h-4 w-4 text-accent-foreground" />
          </div>
          <span className="text-lg font-semibold">Alan</span>
        </div>
        <Button size="icon" variant="ghost" onClick={onNew} className="h-8 w-8 rounded-lg">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversación..."
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !search ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
            <MessageSquare className="h-8 w-8 opacity-40" />
            <p>No hay conversaciones aún</p>
            <Button size="sm" variant="outline" onClick={onNew}>
              Iniciar nueva conversación
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sin resultados</p>
        ) : (
          filtered.map((c) => (
            <SwipeableConversationItem
              key={c.id}
              onDelete={onDelete ? () => setDeleteTarget(c) : undefined}
              onRename={onRename ? () => startEditing(c) : undefined}
            >
              <div
                className={`group flex items-center gap-1 pr-2 transition-colors hover:bg-muted/50 ${
                  c.id === activeId ? "bg-muted" : ""
                }`}
              >
                {editingId === c.id ? (
                  <div className="flex flex-1 items-center gap-1 px-2 py-2">
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") cancelEdit(); }}
                      className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary" onClick={confirmEdit}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={cancelEdit}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { onSelect(c.id); onClose?.(); }}
                      className="flex-1 min-w-0 px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {c.conversation_type && (
                          <span className="shrink-0 text-xs" title={c.conversation_type}>
                            {c.conversation_type === "search" ? "🔍" :
                             c.conversation_type === "email" ? "✉️" :
                             c.conversation_type === "followup" ? "🔔" :
                             c.conversation_type === "proactive_match" ? "🎯" : "💬"}
                          </span>
                        )}
                        <p className="truncate text-sm font-medium">{c.title}</p>
                        {c.has_unread && (
                          <span className="shrink-0 ml-1 h-2 w-2 rounded-full bg-destructive" />
                        )}
                      </div>
                      {c.client_name && (
                        <p className="truncate text-xs text-muted-foreground font-medium mt-0.5">👤 {c.client_name}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true, locale: es })}
                      </p>
                    </button>
                    {onRename && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary hidden md:inline-flex"
                        onClick={(e) => { e.stopPropagation(); startEditing(c); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hidden md:inline-flex"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </SwipeableConversationItem>
          ))
        )}
      </div>

      {/* User footer */}
      <div className="border-t border-border px-4 py-3 safe-bottom">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.user_metadata?.avatar_url} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {user?.user_metadata?.full_name?.[0]?.toUpperCase() ?? "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium">{user?.user_metadata?.full_name ?? "Usuario"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={signOut} className="h-8 w-8 shrink-0">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar conversación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente "{deleteTarget?.title}". Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTarget) { onDelete?.(deleteTarget.id); setDeleteTarget(null); } }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ConversationList;
