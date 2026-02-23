import React, { memo, useMemo, useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import PropertyCard, { parsePropertyCard } from "@/components/PropertyCard";
import alanAvatar from "@/assets/alan-avatar.png";
import { useAuth } from "@/contexts/AuthContext";
import { Copy, Check, Reply, Play, Pause, Mic } from "lucide-react";
import type { MsgAttachment } from "@/lib/stream-chat";

/** Inject ?associate=agentCode into any property URL that doesn't already have it */
function injectAssociate(text: string, agentCode: string | null): string {
  if (!agentCode) return text;
  return text.replace(
    /(https?:\/\/[^\s"')>\]]+)/g,
    (url) => {
      if (!/remax\.com\.ar|zonaprop\.com|argenprop\.com|inmuebles\.mercadolibre/i.test(url)) return url;
      // Strip trailing punctuation captured accidentally
      const trailingMatch = url.match(/([.,;!?)\]]+)$/);
      const trailing = trailingMatch ? trailingMatch[1] : "";
      const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
      if (cleanUrl.includes(`associate=`)) return url; // already has associate param
      const sep = cleanUrl.includes("?") ? "&" : "?";
      return `${cleanUrl}${sep}associate=${encodeURIComponent(agentCode)}${trailing}`;
    }
  );
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  attachments?: MsgAttachment[];
  audioUrl?: string;
  isTranscribing?: boolean;
  userAvatar?: string;
  userName?: string;
  quotedText?: string;
  onReply?: (content: string) => void;
}

const AudioBubble = ({ audioUrl, isTranscribing }: { audioUrl: string; isTranscribing?: boolean }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const handleDuration = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener("loadedmetadata", handleDuration);
    audio.addEventListener("durationchange", handleDuration);
    audio.addEventListener("timeupdate", () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
        setProgress(audio.currentTime / audio.duration);
      }
    });
    audio.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    return () => { audio.pause(); audio.src = ""; };
  }, [audioUrl]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); } else { audio.play(); }
    setPlaying(!playing);
  };

  const formatDur = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 min-w-[200px] py-0.5">
      <button onClick={toggle} className="h-10 w-10 shrink-0 rounded-full bg-current/20 flex items-center justify-center active:scale-95 transition-transform" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }}>
        {playing ? <Pause className="h-4.5 w-4.5 fill-current" /> : <Play className="h-4.5 w-4.5 fill-current ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.3)' }}>
            <div className="h-full rounded-full transition-all duration-200" style={{ width: `${progress * 100}%`, backgroundColor: 'rgba(255,255,255,0.8)' }} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 opacity-80">
            <Mic className="h-3 w-3" />
            <span className="text-[11px] font-medium">
              {duration > 0 ? formatDur(playing ? progress * duration : duration) : "0:00"}
            </span>
          </div>
          {isTranscribing && (
            <span className="text-[10px] opacity-70 animate-pulse flex items-center gap-1">
              Transcribiendo...
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

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

const QuotedBlock = ({ text, isUser }: { text: string; isUser: boolean }) => {
  // Summarize property cards
  let display = text;
  if (text.includes("🏠")) {
    const titleMatch = text.match(/🏠\s*(.+)/);
    const title = titleMatch?.[1]?.trim();
    display = title ? `🏠 ${title.length > 60 ? title.slice(0, 60) + "…" : title}` : "🏠 Propiedad";
  } else if (display.length > 120) {
    display = display.slice(0, 120) + "…";
  }

  return (
    <div
      className={`rounded-lg px-3 py-2 mb-1.5 border-l-[3px] ${
        isUser
          ? "border-white/60 bg-white/15"
          : "border-primary/60 bg-primary/10"
      }`}
    >
      <p className={`text-[11px] font-semibold mb-0.5 ${isUser ? "text-white/80" : "text-primary"}`}>Alan</p>
      <p className={`text-xs leading-relaxed line-clamp-2 ${isUser ? "text-white/70" : "text-muted-foreground"}`}>{display}</p>
    </div>
  );
};

const ChatMessage = memo(({ role, content, attachments, audioUrl, isTranscribing, userAvatar, userName, quotedText, onReply }: ChatMessageProps) => {
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
          {/* Quoted message */}
          {quotedText && <QuotedBlock text={quotedText} isUser={isUser} />}
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
          {audioUrl ? (
            <AudioBubble audioUrl={audioUrl} isTranscribing={isTranscribing} />
          ) : isUser ? (
            content !== "(imagen adjunta)" && content !== "(archivo adjunto)" && content !== "(mensaje de voz)" && <p className="whitespace-pre-wrap break-words overflow-hidden">{content}</p>
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

const DRAFT_START = "<<<DRAFT_START>>>";
const DRAFT_END = "<<<DRAFT_END>>>";

/** Detects if content contains a drafted email/message block using explicit markers */
function extractDraftBlock(content: string): { intro: string; draft: string; outro: string } | null {
  const startIdx = content.indexOf(DRAFT_START);
  const endIdx = content.indexOf(DRAFT_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const intro = content.slice(0, startIdx).trim();
  const draft = content.slice(startIdx + DRAFT_START.length, endIdx).trim();
  const outro = content.slice(endIdx + DRAFT_END.length).trim();

  if (draft.length < 20) return null;

  return { intro, draft, outro };
}

const CopyableDraft = ({ draft }: { draft: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="mt-2 rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
        <span className="text-xs font-medium text-muted-foreground">✉️ Texto listo para copiar</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed px-3.5 py-3 text-foreground/90 max-h-72 overflow-y-auto">{draft}</pre>
    </div>
  );
};

/** Renders assistant content – detects property cards or falls back to markdown */
const AssistantContent = memo(({ content }: { content: string }) => {
  const { agentCode } = useAuth();
  const processedContent = useMemo(() => injectAssociate(content, agentCode), [content, agentCode]);
  const propertyData = useMemo(() => parsePropertyCard(processedContent), [processedContent]);
  const draftBlock = useMemo(() => !propertyData ? extractDraftBlock(processedContent) : null, [processedContent, propertyData]);

  if (propertyData) {
    return <PropertyCard {...propertyData} agentCode={agentCode} />;
  }

  if (draftBlock) {
    return (
      <div>
        {draftBlock.intro && (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-a:text-primary prose-a:font-semibold prose-a:underline prose-a:decoration-primary/40 hover:prose-a:decoration-primary overflow-hidden break-words [word-break:break-word] mb-2">
            <ReactMarkdown components={{
              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
            }}>{draftBlock.intro}</ReactMarkdown>
          </div>
        )}
        <CopyableDraft draft={draftBlock.draft} />
        {draftBlock.outro && (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 overflow-hidden break-words [word-break:break-word] mt-2">
            <ReactMarkdown>{draftBlock.outro}</ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-a:text-primary prose-a:font-semibold prose-a:underline prose-a:decoration-primary/40 hover:prose-a:decoration-primary prose-img:rounded-xl prose-img:my-2 overflow-hidden break-words [word-break:break-word]">
      <ReactMarkdown components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
        img: ({ src, alt }) => <img src={src} alt={alt || ""} className="w-full max-h-48 object-cover rounded-xl" loading="lazy" />,
      }}>{processedContent}</ReactMarkdown>
    </div>
  );
});
AssistantContent.displayName = "AssistantContent";

export default ChatMessage;
