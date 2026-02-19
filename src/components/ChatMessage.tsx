import React, { memo } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import alanAvatar from "@/assets/alan-avatar.png";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  userAvatar?: string;
  userName?: string;
}

const ChatMessage = memo(({ role, content, userAvatar, userName }: ChatMessageProps) => {
  const isUser = role === "user";

  return (
    <div className={`flex gap-2.5 px-4 py-1.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
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
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-[hsl(var(--chat-user))] text-[hsl(var(--chat-user-foreground))] rounded-tr-md"
            : "bg-[hsl(var(--chat-assistant))] text-[hsl(var(--chat-assistant-foreground))] rounded-tl-md"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-a:text-primary prose-a:underline prose-img:rounded-xl prose-img:my-2">
            <ReactMarkdown components={{
              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
              img: ({ src, alt }) => <img src={src} alt={alt || ""} className="w-full max-h-48 object-cover rounded-xl" loading="lazy" />,
            }}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

export default ChatMessage;
