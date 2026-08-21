import { useState, useRef, useEffect, useMemo } from "react";
import { MessageSquare, Plus, LogOut, Trash2, Pencil, Check, X, Search, Mail, Bell, Target, type LucideIcon } from "lucide-react";
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
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "@/lib/contact-avatar";
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

// Tipos de conversación como iconos SVG en tiles (rediseño 86ak3kdgw) — antes emojis.
const conversationTypeIcon: Record<string, LucideIcon> = {
  search: Search,
  email: Mail,
  followup: Bell,
  proactive_match: Target,
};

// Tinte del tile (artboard Conversaciones, ticket 86ak47kr1): las filas SIN LEER se tiñen por tipo
// — búsqueda azul tenue, match proactivo rojo tenue (--accent) — y las leídas van en vidrio neutro
// (en el artboard las búsquedas ya leídas tienen tile neutro). Para teñir siempre por tipo, sacar la
// condición de has_unread en tileClass.
const NEUTRAL_TILE = "border-white/[0.08] bg-white/5 text-[#A7AEBA]";
const conversationTypeTile: Record<string, string> = {
  search: "border-[rgba(91,147,255,0.28)] bg-[rgba(91,147,255,0.16)] text-[hsl(var(--primary-soft-foreground))]",
  proactive_match: "border-[rgba(255,90,77,0.26)] bg-[rgba(255,90,77,0.14)] text-[hsl(var(--hot))]",
};
const tileClass = (type: string, unread: boolean) => (unread ? conversationTypeTile[type] : undefined) ?? NEUTRAL_TILE;

const conversationTypeLabel: Record<string, string> = {
  search: "Búsqueda",
  email: "Email",
  followup: "Seguimiento",
  proactive_match: "Match",
};

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
  const userName: string = user?.user_metadata?.full_name ?? "Usuario";
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [search, setSearch] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const unreadCount = useMemo(() => conversations.filter((c) => c.has_unread).length, [conversations]);

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
    <div className="flex h-full flex-col bg-background">
      {/* Header: marca "A" + título + "N sin leer"; barra de vidrio 0.02 (artboard Conversaciones) */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-3.5 safe-top">
        <div className="flex min-w-0 items-center gap-[11px]">
          {/* Marca "A" azul (artboard Conversaciones) — --accent es el rojo Docta, no se usa acá. */}
          <div
            aria-hidden="true"
            className="flex h-9 w-9 select-none items-center justify-center rounded-[12px] bg-[linear-gradient(150deg,hsl(var(--brand)),hsl(var(--brand-deep)))] text-base font-bold tracking-[-0.02em] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_6px_20px_-6px_rgba(76,141,255,0.75)]"
          >
            A
          </div>
          <div className="min-w-0">
            <p className="text-[17px] font-semibold leading-[1.15] tracking-[-0.02em]">Conversaciones</p>
            <p className="mt-[3px] text-[11px] leading-[1.2] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} sin leer` : "Todo leído"}
            </p>
          </div>
        </div>
        {/* "+" cuadrado r12 con gradiente (44 por área táctil mínima; el artboard dibuja 40) */}
        <Button size="icon" onClick={onNew} aria-label="Nueva conversación" className="shadow-[0_10px_24px_-12px_rgba(76,141,255,0.9)]">
          <Plus className="h-[19px] w-[19px]" strokeWidth={2} />
        </Button>
      </div>

      {/* Buscador pill de vidrio */}
      <div className="border-b border-white/[0.07] px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7E8694]" strokeWidth={1.8} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversación…"
            aria-label="Buscar conversación"
            className="h-[42px] w-full rounded-full border border-white/[0.08] bg-white/5 pl-[42px] pr-4 text-sm text-foreground placeholder:text-[#7E8694] focus:outline-none focus-visible:border-[rgba(91,147,255,0.45)] focus-visible:ring-[3px] focus-visible:ring-[rgba(91,147,255,0.12)]"
          />
        </div>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !search ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
            <MessageSquare className="h-8 w-8 opacity-40" />
            <p>No hay conversaciones aún</p>
            <Button size="md" variant="outline" onClick={onNew}>
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
                className={`group flex items-center gap-1 border-b border-l-[3px] border-white/[0.05] pr-2 transition-colors ${
                  // Sin leer: fondo azul tenue + borde izquierdo (además del punto rojo); si no, la
                  // activa en vidrio y hover neutro. Una sola clase de fondo por fila, sin disputas.
                  c.has_unread
                    ? "border-l-[hsl(var(--primary))] bg-[rgba(91,147,255,0.10)]"
                    : c.id === activeId
                      ? "border-l-transparent bg-white/[0.06]"
                      : "border-l-transparent hover:bg-white/[0.04]"
                }`}
              >
                {editingId === c.id ? (
                  <div className="flex flex-1 items-center gap-1 px-2 py-2">
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") cancelEdit(); }}
                      className="h-9 min-w-0 flex-1 rounded-[10px] border border-white/[0.09] bg-white/[0.04] px-2.5 text-sm text-foreground focus:outline-none focus-visible:border-[rgba(91,147,255,0.45)] focus-visible:ring-[3px] focus-visible:ring-[rgba(91,147,255,0.12)]"
                    />
                    <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0 text-muted-foreground hover:text-primary" onClick={confirmEdit}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0 text-muted-foreground" onClick={cancelEdit}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { onSelect(c.id); onClose?.(); }}
                      className="flex min-w-0 flex-1 items-start gap-3 py-[13px] pl-[13px] pr-2 text-left"
                    >
                      {c.conversation_type && (
                        <span
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border ${tileClass(c.conversation_type, !!c.has_unread)}`}
                          title={conversationTypeLabel[c.conversation_type] ?? c.conversation_type}
                        >
                          {(() => {
                            const TypeIcon = conversationTypeIcon[c.conversation_type] ?? MessageSquare;
                            return <TypeIcon className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden="true" />;
                          })()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className={`truncate text-sm ${c.has_unread ? "font-semibold text-foreground" : "font-medium text-[#C3CAD5]"}`}>
                            {c.title}
                            {c.has_unread && <span className="sr-only"> (sin leer)</span>}
                          </p>
                          {c.has_unread && (
                            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[hsl(var(--accent))]" aria-hidden="true" />
                          )}
                        </div>
                        {c.client_name && (
                          <p className={`mt-1 truncate text-xs font-medium ${c.has_unread ? "text-[hsl(var(--primary-soft-foreground))]" : "text-muted-foreground"}`}>{c.client_name}</p>
                        )}
                        <p className="mt-[3px] text-[11px] text-[#7E8694]">
                          {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                    </button>
                    {onRename && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Renombrar"
                        className="hidden shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 md:inline-flex"
                        onClick={(e) => { e.stopPropagation(); startEditing(c); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Eliminar"
                        className="hidden shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 md:inline-flex"
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
      <div className="border-t border-white/[0.07] bg-white/[0.02] px-4 py-3 safe-bottom">
        <div className="flex items-center gap-[11px]">
          <Avatar className="h-[38px] w-[38px]">
            <AvatarImage src={user?.user_metadata?.avatar_url} />
            <AvatarFallback className={`text-sm font-semibold text-white ${AVATAR_COLORS[getAvatarColorIndex(userName)]}`}>
              {getInitials(userName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[#E4E8EE]">{userName}</p>
            <p className="mt-0.5 truncate text-[11px] text-[#7E8694]">{user?.email}</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={signOut}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="shrink-0 border border-white/[0.07] bg-white/5 text-[#A7AEBA] hover:bg-white/10 hover:text-foreground"
          >
            <LogOut className="h-[17px] w-[17px]" strokeWidth={1.7} />
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
