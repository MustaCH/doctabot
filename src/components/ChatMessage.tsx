import React, { useMemo, useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import PropertyCard, { PropertyCardCompact } from "@/components/PropertyCard";
import ContactCard, { ContactCardCompact } from "@/components/ContactCard";
import { parsePropertyCard, parseMultiplePropertyCards, type PropertyCardProps } from "@/lib/property-card-parse";
import { parseContactCardSegments, type ContactCardProps } from "@/lib/contact-card-parse";
import { parseDraftSegments, stripAllMarkers, normalizeWhatsappNumber } from "@/lib/draft-parse";
import { injectAssociate } from "@/lib/inject-associate";
import { AlanOrb } from "@/components/AlanOrb";
import { useAuth } from "@/contexts/AuthContext";
import { Copy, Check, Reply, Play, Pause, RotateCcw, FileText, Home } from "lucide-react";
import { isTurnErrorMessage, turnErrorAllowsRetry } from "@/lib/alan-orb-state";
import type { MsgAttachment } from "@/lib/stream-chat";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  attachments?: MsgAttachment[];
  audioUrl?: string;
  isTranscribing?: boolean;
  userAvatar?: string;
  userName?: string;
  quotedText?: string;
  /** Teléfono del cliente vinculado a la conversación activa. Habilita el botón compartir-por-WhatsApp en las PropertyCard. */
  clientPhone?: string;
  onReply?: (content: string) => void;
  /** Reintenta el último turno (86ak3kd99). Solo se muestra en el mensaje de error del turno
      fallido y cuando el server marcó el reintento como seguro (sin tools con efecto). */
  onRetry?: () => void;
}

// Patrón fijo de la onda del reproductor (artboard Grabando): no es el audio real, es la forma.
const AUDIO_WAVE_BARS = [8, 16, 24, 12, 20, 6, 14, 22, 10, 18, 8, 14, 20, 6, 12, 22, 8, 16, 10, 18, 6, 14, 8, 20, 10, 6] as const;

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

  // Onda en dos tonos (artboard Grabando): las barras ya reproducidas al 85 %, el resto al 38 %.
  const litBars = Math.round(progress * AUDIO_WAVE_BARS.length);

  return (
    <div data-testid="audio-bubble" className="min-w-[200px] py-0.5">
      {/* Tope de ancho: la onda escala en X con la burbuja; más allá de ~320 se deformaría. */}
      <div className="flex max-w-[320px] items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pausar" : "Reproducir"}
          className="relative after:absolute after:content-[''] flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-white/[0.22] transition-transform after:-inset-1 active:scale-95"
        >
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <svg viewBox={`0 0 ${AUDIO_WAVE_BARS.length * 7 - 4} 26`} preserveAspectRatio="none" className="block h-[26px] min-w-0 flex-1" aria-hidden="true">
          {AUDIO_WAVE_BARS.map((h, i) => (
            <rect
              key={i}
              x={i * 7}
              y={(26 - h) / 2}
              width="3"
              height={h}
              rx="1.5"
              fill={i < litBars ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.38)"}
            />
          ))}
        </svg>
        <span className="shrink-0 text-xs font-medium tabular-nums opacity-85">
          {duration > 0 ? formatDur(playing ? progress * duration : duration) : "0:00"}
        </span>
      </div>
      {isTranscribing && (
        <p className="mt-1.5 animate-pulse text-[10px] opacity-70">Transcribiendo…</p>
      )}
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
      className="relative -mb-3.5 -mt-2.5 flex min-h-11 items-center gap-1 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 max-md:opacity-100"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
};

const QuotedBlock = ({ text, isUser }: { text: string; isUser: boolean }) => {
  // Resumen de una tarjeta citada: el 🏠 es el delimitador del parser, no un ícono de UI —
  // se muestra un ícono lucide en su lugar (ticket 86ak481dm).
  let display = text;
  const isProperty = text.includes("🏠");
  if (isProperty) {
    const titleMatch = text.match(/🏠\s*(.+)/);
    const title = titleMatch?.[1]?.replace(/\*\*/g, "").trim();
    display = title ? (title.length > 60 ? title.slice(0, 60) + "…" : title) : "Propiedad";
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
      <p className={`flex items-start gap-1.5 text-xs leading-relaxed ${isUser ? "text-white/70" : "text-muted-foreground"}`}>
        {isProperty && <Home className="mt-[3px] h-3 w-3 shrink-0" aria-hidden="true" />}
        <span className="line-clamp-2">{display}</span>
      </p>
    </div>
  );
};

const ChatMessage = ({ role, content, attachments, audioUrl, isTranscribing, userAvatar, userName, quotedText, clientPhone, onReply, onRetry }: ChatMessageProps) => {
  const isUser = role === "user";

  // Las tarjetas de propiedad van FUERA de la burbuja, a ancho completo (rediseño
  // Carbón & Vidrio): dentro de la burbuja del 80% quedaban en 256px reales.
  if (!isUser && !audioUrl) {
    return (
      <AssistantMessage
        content={content}
        clientPhone={clientPhone}
        quotedText={quotedText}
        onReply={onReply}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className={`group flex gap-2.5 px-4 py-1.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {isUser ? (
        <Avatar className="h-7 w-7 shrink-0 mt-1">
          <AvatarImage src={userAvatar} />
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {userName?.[0]?.toUpperCase() ?? "U"}
          </AvatarFallback>
        </Avatar>
      ) : (
        <AlanAvatar />
      )}
      <div className="-mb-3.5 max-w-[80%] min-w-0 overflow-hidden pb-3.5">
        <div
          data-bubble={isUser ? "user" : "assistant"}
          className={`px-4 py-3 text-[15px] leading-[1.5] overflow-hidden ${
            isUser
              ? "rounded-[20px] rounded-br-[6px] bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-white shadow-[0_10px_30px_-12px_rgba(59,123,255,0.8)]"
              : assistantBubbleCls
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
                    src={att.base64 ? `data:${att.mimeType};base64,${att.base64}` : att.url}
                    alt="Adjunto"
                    className="max-w-full max-h-48 rounded-lg object-cover"
                  />
                ) : (
                  <div key={i} className="flex items-center gap-1.5 rounded-[10px] border border-white/10 bg-white/[0.06] px-2.5 py-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
                    <span className="text-xs truncate max-w-[150px]">{att.fileName || "archivo"}</span>
                  </div>
                )
              )}
            </div>
          )}
          {audioUrl ? (
            <>
              <AudioBubble audioUrl={audioUrl} isTranscribing={isTranscribing} />
              {/* m3: el texto transcripto se muestra debajo del reproductor (antes se descartaba). */}
              {content && content !== "(mensaje de voz)" && (
                <p className="mt-2.5 overflow-hidden whitespace-pre-wrap break-words border-t border-white/20 pt-2.5 text-[13px] leading-[1.5] opacity-90">{content}</p>
              )}
            </>
          ) : isUser ? (
            content !== "(imagen adjunta)" && content !== "(archivo adjunto)" && content !== "(mensaje de voz)" && <p className="whitespace-pre-wrap break-words overflow-hidden">{content}</p>
          ) : (
            <AssistantContent content={content} clientPhone={clientPhone} />
          )}
        </div>
        {!isUser && (
          <div className="flex items-center gap-2">
            {/* M2: Copiar/Citar trabajan sobre el texto SIN marcadores — el portapapeles y el
                bloque [REFERENCIA] que viaja al modelo no deben llevar <<<...>>> crudos. */}
            <CopyButton content={stripAllMarkers(content)} />
            {onReply && (
              <button
                onClick={() => onReply(stripAllMarkers(content))}
                className="relative -mx-1 -mb-3.5 -mt-2.5 flex min-h-11 items-center gap-1 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 max-md:opacity-100"
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
};

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

const CopyableDraft = ({ draft, whatsappNumber }: { draft: string; whatsappNumber?: string }) => {
  const [copied, setCopied] = useState(false);
  // m5: mensajes viejos en DB pueden traer un WHATSAPP_TO no numérico ("hola mundo") — solo
  // mostramos el header/botón de WhatsApp si el número parece un teléfono real.
  const validNumber = normalizeWhatsappNumber(whatsappNumber);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const handleWhatsApp = () => {
    const url = `https://wa.me/${validNumber?.replace(/\+/g, "")}/?text=${encodeURIComponent(draft)}`;
    window.open(url, "_blank");
  };
  // Full-bleed, hermano de la burbuja (artboard Borrador.dc.html): el contenedor del mensaje ya
  // aporta los 16px laterales, acá solo va la tarjeta de vidrio r18.
  return (
    <div data-testid="copyable-draft" className="w-full rounded-[18px] border border-white/[0.09] bg-white/5 overflow-hidden shadow-[0_20px_44px_-24px_rgba(0,0,0,0.9)]">
      <div className="flex items-center justify-between gap-2.5 pl-3.5 pr-2 py-2 border-b border-white/[0.07] bg-white/[0.03]">
        <span className="flex items-center gap-2 min-w-0 text-xs font-medium text-muted-foreground whitespace-nowrap">
          {validNumber ? (
            <>
              <span className="text-[#25D366] shrink-0"><WhatsAppIcon /></span>
              Mensaje de WhatsApp
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 shrink-0" />
              Texto listo para copiar
            </>
          )}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 h-11 px-3.5 rounded-full border border-white/[0.09] bg-white/[0.06] text-xs font-medium text-foreground/80 hover:bg-white/10 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "¡Copiado!" : "Copiar"}
          </button>
          {validNumber && (
            <button
              onClick={handleWhatsApp}
              className="flex items-center justify-center h-11 w-11 rounded-full bg-[#25D366] text-[#0E2A17] hover:bg-[#20BD5A] transition-colors"
              title="Enviar por WhatsApp"
            >
              <WhatsAppIcon />
            </button>
          )}
        </div>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-[1.6] px-3.5 py-3.5 text-[#D7DCE4] max-h-72 overflow-y-auto">{draft}</pre>
    </div>
  );
};

/** Bloque de markdown de Alan con el estilo de prosa compartido. */
const MarkdownProse = ({ text, className = "" }: { text: string; className?: string }) => (
  <div className={`prose prose-sm max-w-none prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-a:text-primary prose-a:font-semibold prose-a:underline prose-a:decoration-primary/40 hover:prose-a:decoration-primary overflow-hidden break-words [word-break:break-word] ${className}`}>
    <ReactMarkdown components={{
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="!text-blue-400 !font-semibold !underline !decoration-blue-400/50 hover:!decoration-blue-600">{children}</a>,
    }}>{text}</ReactMarkdown>
  </div>
);

const AlanAvatar = () => <AlanOrb size="sm" className="mt-1" />;

// Burbuja de Alan: vidrio con la esquina inferior-izquierda marcada (rediseño Carbón & Vidrio).
const assistantBubbleCls =
  "rounded-[20px] rounded-bl-[6px] px-4 py-3 text-[15px] leading-[1.5] overflow-hidden bg-white/[0.055] border border-white/[0.07] text-[#DDE1E8]";

/**
 * Mensaje de Alan. Si el contenido trae tarjetas (de propiedad o de contacto), el texto va en
 * burbuja y las tarjetas full-bleed (ancho completo menos el padding de 16px del contenedor),
 * intercaladas en orden. Sin tarjetas, todo va en la burbuja como siempre.
 */
type CardSegment = {
  type: "text" | "property" | "contact" | "draft";
  text?: string;
  property?: PropertyCardProps;
  contact?: ContactCardProps;
  draft?: string;
  whatsappNumber?: string;
};

/** Tarjetas de propiedad (🏠) y, si no hay, de contacto (👤 **) en un tramo de texto; null si no hay. */
const parseCardSegments = (text: string): CardSegment[] | null => {
  const multi = parseMultiplePropertyCards(text);
  if (multi) return multi;
  const single = parsePropertyCard(text);
  if (single) return [{ type: "property", property: single }];
  return parseContactCardSegments(text);
};

const AssistantMessage = ({ content, clientPhone, quotedText, onReply, onRetry }: { content: string; clientPhone?: string; quotedText?: string; onReply?: (content: string) => void; onRetry?: () => void }) => {
  const { agentCode } = useAuth();
  // Sólo pasamos whatsappPhone si hay un teléfono real; undefined oculta el botón (sin cliente vinculado no se muestra).
  const whatsappPhone = clientPhone || undefined;
  const processedContent = useMemo(() => injectAssociate(content, agentCode), [content, agentCode]);
  // Precedencia: los drafts GANAN. Si hay marcadores <<<...>>> de borrador, primero se parte por
  // borradores (ticket 86ak47fmn: el borrador va FUERA de la burbuja, full-bleed como las tarjetas)
  // y los parsers de tarjetas corren SOLO sobre los tramos de texto entre borradores — nunca
  // adentro de uno (ticket URGENT marcadores renderizados: un 🏠 dentro del borrador no es tarjeta).
  // Después: propiedades (🏠) y, si no hay, contactos (👤 **) — ticket 86ak3z07b: las tarjetas de
  // contacto también van fuera de la burbuja, primera completa y el resto en fila compacta.
  const cardSegments = useMemo<CardSegment[] | null>(() => {
    const drafts = parseDraftSegments(processedContent);
    if (drafts) {
      return drafts.flatMap<CardSegment>((s) =>
        s.type === "draft"
          ? [{ type: "draft", draft: s.draft, whatsappNumber: s.whatsappNumber }]
          : parseCardSegments(s.text) ?? [{ type: "text", text: s.text }]
      );
    }
    return parseCardSegments(processedContent);
  }, [processedContent]);

  const actions = (
    <div className="flex items-center gap-2">
      {/* M2: Copiar/Citar trabajan sobre el texto SIN marcadores — el portapapeles y el
          bloque [REFERENCIA] que viaja al modelo no deben llevar <<<...>>> crudos. */}
      <CopyButton content={stripAllMarkers(content)} />
      {onReply && (
        <button
          onClick={() => onReply(stripAllMarkers(content))}
          className="relative -mx-1 -mb-3.5 -mt-2.5 flex min-h-11 items-center gap-1 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 max-md:opacity-100"
        >
          <Reply className="h-3 w-3" />
          Citar
        </button>
      )}
    </div>
  );

  if (!cardSegments) {
    // Turno fallido (86ak3kd99): borde rojo tenue, orb en error (AlanAvatar hereda el estado
    // vía data-state del error del último mensaje — el orb del header ya lo deriva) y botón
    // Reintentar SOLO si el server marcó el reintento como seguro.
    const isError = isTurnErrorMessage(content);
    const canRetry = isError && !!onRetry && turnErrorAllowsRetry(content);
    return (
      <div className="group flex gap-2.5 px-4 py-1.5">
        {isError ? <AlanOrb size="sm" state="error" className="mt-1" /> : <AlanAvatar />}
        <div className="-mb-3.5 max-w-[80%] min-w-0 overflow-hidden pb-3.5">
          <div
            data-bubble="assistant"
            className={`${assistantBubbleCls} ${isError ? "border-[rgba(255,90,77,0.35)] bg-[rgba(255,90,77,0.06)]" : ""}`}
          >
            {quotedText && <QuotedBlock text={quotedText} isUser={false} />}
            <AssistantContent content={content} clientPhone={clientPhone} />
          </div>
          {canRetry && (
            <button
              onClick={onRetry}
              className="mb-2.5 mt-2 flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
            >
              <RotateCcw className="h-4 w-4" />
              Reintentar
            </button>
          )}
          {actions}
        </div>
      </div>
    );
  }

  const firstTextIdx = cardSegments.findIndex((s) => s.type === "text");
  // Listados: la primera propiedad/contacto va con tarjeta completa, el resto compactas
  // (4 tarjetas grandes seguidas = 4 pantallas de scroll; así se comparan de un vistazo).
  let propertyOrdinal = 0;
  let contactOrdinal = 0;
  return (
    <div className="group px-4 py-1.5">
      {cardSegments.map((seg, i) =>
        seg.type === "property" && seg.property ? (
          <div key={i} className="py-1">
            {propertyOrdinal++ === 0 ? (
              <PropertyCard {...seg.property} agentCode={agentCode} whatsappPhone={whatsappPhone} />
            ) : (
              <PropertyCardCompact {...seg.property} agentCode={agentCode} />
            )}
          </div>
        ) : seg.type === "contact" && seg.contact ? (
          <div key={i} className="py-1">
            {contactOrdinal++ === 0 ? <ContactCard {...seg.contact} /> : <ContactCardCompact {...seg.contact} />}
          </div>
        ) : seg.type === "draft" && seg.draft !== undefined ? (
          <div key={i} className="py-1">
            <CopyableDraft draft={seg.draft} whatsappNumber={seg.whatsappNumber} />
          </div>
        ) : (
          <div key={i} className="flex gap-2.5 py-1">
            {i === firstTextIdx ? <AlanAvatar /> : <div className="w-7 shrink-0" aria-hidden />}
            <div className="max-w-[80%] min-w-0 overflow-hidden">
              <div data-bubble="assistant" className={assistantBubbleCls}>
                {i === firstTextIdx && quotedText && <QuotedBlock text={quotedText} isUser={false} />}
                {/* Red final: ningún <<<MARCADOR>>> suelto/desconocido llega crudo a ReactMarkdown. */}
                <MarkdownProse text={stripAllMarkers(seg.text || "")} />
              </div>
            </div>
          </div>
        )
      )}
      {actions}
    </div>
  );
};

/** Renders assistant content – markdown de la burbuja (borradores, tarjetas de propiedad y de
    contacto se resuelven arriba, en AssistantMessage, porque van fuera de la burbuja). */
const AssistantContent = ({ content }: { content: string; clientPhone?: string }) => {
  const { agentCode } = useAuth();
  const processedContent = useMemo(() => injectAssociate(content, agentCode), [content, agentCode]);

  return (
    <div className="prose prose-sm max-w-none prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-a:text-primary prose-a:font-semibold prose-a:underline prose-a:decoration-primary/40 hover:prose-a:decoration-primary prose-img:rounded-xl prose-img:my-2 overflow-hidden break-words [word-break:break-word]">
      <ReactMarkdown components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="!text-blue-400 !font-semibold !underline !decoration-blue-400/50 hover:!decoration-blue-600">{children}</a>,
        img: ({ src, alt }) => <img src={src} alt={alt || ""} className="w-full max-h-48 object-cover rounded-xl" loading="lazy" />,
      }}>{stripAllMarkers(processedContent)}</ReactMarkdown>
    </div>
  );
};

export default ChatMessage;
