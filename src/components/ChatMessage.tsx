import React, { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import PropertyCard, { parsePropertyCard } from "@/components/PropertyCard";
import alanAvatar from "@/assets/alan-avatar.png";
import { useAuth } from "@/contexts/AuthContext";
import { Copy, Check, Reply } from "lucide-react";
import type { MsgAttachment } from "@/lib/stream-chat";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  attachments?: MsgAttachment[];
  userAvatar?: string;
  userName?: string;
  onReply?: (content: string) => void;
}

const CopyButton = ({ content }: { content: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 ml-1 opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 max-md:opacity-100"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
};

const ChatMessage = memo(({ role, content, attachments, userAvatar, userName, onReply }: ChatMessageProps) => {
  const isUser = role === "user";

  return (
    <div className={`group flex gap-2.5 px-4 py-1.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <Avatar className="h-7 w-7 shrink-0 mt-1">
        {isUser ? (
          <>
            <AvatarImage src={userAvatar} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {userName?.[0]?.toUpperCase() ?? "U"}
            </AvatarFallback>
          </>
        ) : (
          <>
            <AvatarImage src={alanAvatar} alt="Alan" />
            <AvatarFallback className="bg-accent text-accent-foreground text-xs">A</AvatarFallback>
          </>
        )}
      </Avatar>
      <div className="max-w-[80%] min-w-0 overflow-hidden">
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed overflow-hidden ${
            isUser
              ? "bg-[hsl(var(--chat-user))] text-[hsl(var(--chat-user-foreground))] rounded-tr-md"
              : "bg-[hsl(var(--chat-assistant))] text-[hsl(var(--chat-assistant-foreground))] rounded-tl-md"
          }`}
        >
          {/* Attached images */}
          {attachments && attachments.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${content && content !== "(imagen adjunta)" && content !== "(archivo adjunto)" ? "mb-2" : ""}`}>
              {attachments.map((att, i) =>
                att.type === "image" ? (
                  <img
                    key={i}
                    src={`data:${att.mimeType};base64,${att.base64}`}
                    alt="Adjunto"
                    className="max-w-full max-h-48 rounded-lg object-cover"
                  />
                ) : (
                  <div key={i} className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5">
                    <span className="text-xs">📄</span>
                    <span className="text-xs truncate max-w-[150px]">{att.fileName || "archivo"}</span>
                  </div>
                )
              )}
            </div>
          )}
          {isUser ? (
            content !== "(imagen adjunta)" && content !== "(archivo adjunto)" && <UserContent content={content} />
          ) : (
            <AssistantContent content={content} />
          )}
        </div>
        {!isUser && (
          <div className="flex items-center gap-2">
            <CopyButton content={content} />
            {onReply && (
              <button
                onClick={() => onReply(content)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 max-md:opacity-100"
              >
                <Reply className="h-3 w-3" />
                Citar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

/** Renders user content – detects quoted replies and renders WhatsApp-style */
const UserContent = memo(({ content }: { content: string }) => {
  if (content === "(imagen adjunta)" || content === "(archivo adjunto)") return null;

  // Detect blockquote pattern: lines starting with "> " followed by blank line and actual message
  const quoteMatch = content.match(/^((?:> .+\n?)+)\n\n?([\s\S]*)$/);

  if (quoteMatch) {
    const quotedRaw = quoteMatch[1].replace(/^> /gm, "").trim();
    const userText = quoteMatch[2].trim();

    return (
      <div className="overflow-hidden">
        <div className="rounded-lg bg-white/15 px-2.5 py-1.5 mb-1.5 border-l-2 border-white/50 overflow-hidden">
          <p className="text-[11px] font-semibold opacity-80 mb-0.5">Alan</p>
          <p className="text-xs opacity-75 line-clamp-3 break-words">{quotedRaw}</p>
        </div>
        {userText && <p className="whitespace-pre-wrap break-words">{userText}</p>}
      </div>
    );
  }

  return <p className="whitespace-pre-wrap break-words overflow-hidden">{content}</p>;
});
UserContent.displayName = "UserContent";

/** Renders assistant content – detects property cards or falls back to markdown */
const AssistantContent = memo(({ content }: { content: string }) => {
  const { agentCode } = useAuth();
  const propertyData = useMemo(() => parsePropertyCard(content), [content]);

  if (propertyData) {
    return <PropertyCard {...propertyData} agentCode={agentCode} />;
  }

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-a:text-primary prose-a:underline prose-img:rounded-xl prose-img:my-2 overflow-hidden break-words [word-break:break-word]">
      <ReactMarkdown components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
        img: ({ src, alt }) => <img src={src} alt={alt || ""} className="w-full max-h-48 object-cover rounded-xl" loading="lazy" />,
      }}>{content}</ReactMarkdown>
    </div>
  );
});
AssistantContent.displayName = "AssistantContent";

export default ChatMessage;
