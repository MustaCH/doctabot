import { MessageSquare, Plus, LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onClose?: () => void;
}

const ConversationList = ({ conversations, activeId, onSelect, onNew, onDelete, onClose }: ConversationListProps) => {
  const { user, signOut } = useAuth();

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
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

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
            <MessageSquare className="h-8 w-8 opacity-40" />
            <p>No hay conversaciones aún</p>
            <Button size="sm" variant="outline" onClick={onNew}>
              Iniciar nueva conversación
            </Button>
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 pr-2 transition-colors hover:bg-muted/50 ${
                c.id === activeId ? "bg-muted" : ""
              }`}
            >
              <button
                onClick={() => { onSelect(c.id); onClose?.(); }}
                className="flex-1 min-w-0 px-4 py-3 text-left"
              >
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true, locale: es })}
                </p>
              </button>
              {onDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {/* User footer */}
      <div className="border-t border-border px-4 py-3">
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
    </div>
  );
};

export default ConversationList;
