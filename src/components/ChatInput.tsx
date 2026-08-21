import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SendHorizontal, Paperclip, X, FileText, Image as ImageIcon, Mic, Square, Loader2, Home } from "lucide-react";
import { toast } from "sonner";
import { feedbackSend, feedbackAttach, feedbackRemove } from "@/hooks/use-feedback";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";

export interface ChatAttachment {
  file: File;
  previewUrl: string;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void;
  onSendAudio?: (blob: Blob, localUrl: string) => void;
  disabled?: boolean;
  quotedText?: string | null;
  onClearQuote?: () => void;
  /** Notifica al padre cuando arranca/termina la grabación (el orb entra en "escucha"). */
  onRecordingChange?: (recording: boolean) => void;
}

// Onda del estado "Grabando" (artboard Grabando.dc.html): 11 barras en --hot que respiran con
// un desfase, más 6 apagadas. Es indicación visual — el hook no expone niveles de audio.
const REC_WAVE_BARS = [6, 12, 18, 8, 16, 4, 10, 18, 6, 14, 4] as const;
const REC_WAVE_TAIL = [8, 4, 6, 4, 6, 4] as const;
const RecordingWave = () => (
  <svg width="120" height="20" viewBox="0 0 120 20" className="hidden shrink-0 min-[360px]:block" aria-hidden="true">
    {REC_WAVE_BARS.map((h, i) => (
      <rect
        key={i}
        className="rec-bar"
        x={i * 7}
        y={(20 - h) / 2}
        width="3"
        height={h}
        rx="1.5"
        fill="rgba(255,144,134,0.7)"
        style={{ animationDelay: `${(i % 5) * 120}ms` }}
      />
    ))}
    {REC_WAVE_TAIL.map((h, i) => (
      <rect key={`t${i}`} x={77 + i * 7} y={(20 - h) / 2} width="3" height={h} rx="1.5" fill="rgba(255,144,134,0.22)" />
    ))}
  </svg>
);

const ChatInput = ({ onSend, onSendAudio, disabled, quotedText, onClearQuote, onRecordingChange }: ChatInputProps) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { recordingState, elapsed, startRecording, stopRecording, cancelRecording } = useAudioRecorder();

  // Focus textarea when a quote is set
  useEffect(() => {
    if (quotedText) {
      textareaRef.current?.focus();
    }
  }, [quotedText]);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    feedbackSend();
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
  };

  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: ChatAttachment[] = [];
    for (let i = 0; i < Math.min(files.length, 4 - attachments.length); i++) {
      const file = files[i];
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" es demasiado grande. Máximo 4MB.`);
        continue;
      }
      newAttachments.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    setAttachments((prev) => [...prev, ...newAttachments].slice(0, 4));
    if (newAttachments.length > 0) feedbackAttach();
    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    feedbackRemove();
    setAttachments((prev) => {
      const removed = prev[index];
      URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const isRecording = recordingState === "recording";

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didHoldRef = useRef(false);

  const sendRecording = useCallback(async () => {
    const result = await stopRecording();
    if (result && onSendAudio) {
      feedbackSend();
      onSendAudio(result.blob, result.url);
    }
  }, [stopRecording, onSendAudio]);

  // Hold-to-record: on pointer down start a short timer, if held long enough start recording
  const handleMicPointerDown = useCallback(async () => {
    if (disabled || isRecording) return;
    didHoldRef.current = false;
    holdTimerRef.current = setTimeout(async () => {
      didHoldRef.current = true;
      await startRecording();
    }, 200); // 200ms threshold to distinguish tap from hold
  }, [disabled, isRecording, startRecording]);

  const handleMicPointerUp = useCallback(async () => {
    // If timer hasn't fired yet, it was a tap → start recording normally (tap-to-record fallback)
    if (holdTimerRef.current && !didHoldRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      await startRecording();
      return;
    }
    holdTimerRef.current = null;

    // If we were hold-recording, stop and send
    if (isRecording && didHoldRef.current) {
      await sendRecording();
    }
  }, [isRecording, startRecording, sendRecording]);

  const handleMicPointerLeave = useCallback((e: React.PointerEvent) => {
    // Only cancel on touch (mobile swipe-away), not mouse (desktop cursor drift)
    if (e.pointerType !== "touch") return;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (isRecording && didHoldRef.current) {
      cancelRecording();
    }
  }, [isRecording, cancelRecording]);

  // Tap-mode stop button handler
  const handleStopTap = useCallback(async () => {
    await sendRecording();
  }, [sendRecording]);

  const formatElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const hasContent = text.trim().length > 0 || attachments.length > 0;

  // Clean and truncate quoted text for preview
  // Resumen de la cita: una tarjeta de propiedad se muestra con ícono lucide (el 🏠 es el
  // delimitador del parser, no un ícono de UI — ticket 86ak481dm).
  const quotePreview: { text: string; isProperty: boolean } | null = quotedText
    ? (() => {
        if (quotedText.includes("🏠")) {
          const titleMatch = quotedText.match(/🏠\s*(.+)/);
          const title = titleMatch?.[1]?.replace(/\*\*/g, "").trim();
          return { isProperty: true, text: title ? (title.length > 60 ? title.slice(0, 60) + "…" : title) : "Propiedad" };
        }
        const cleaned = quotedText
          .replace(/!\[.*?\]\(.*?\)/g, "[imagen]")
          .replace(/https?:\/\/\S{40,}/g, "[enlace]")
          .replace(/\*\*/g, "");
        return { isProperty: false, text: cleaned.length > 100 ? cleaned.slice(0, 100) + "…" : cleaned };
      })()
    : null;

  return (
    <div
      className={`overflow-hidden border-t px-4 pt-3 pb-2 transition-colors safe-bottom ${
        isRecording ? "border-[rgba(255,90,77,0.28)] bg-[rgba(255,90,77,0.06)]" : "border-white/[0.07] bg-white/[0.02]"
      }`}
    >
      {/* Quote preview */}
      {quotePreview && (
        <div className="flex items-start gap-2 mb-2 px-1 animate-in fade-in slide-in-from-bottom-2 duration-150 overflow-hidden">
          <div className="flex-1 min-w-0 rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-1.5 overflow-hidden">
            <p className="text-[11px] font-medium text-primary mb-0.5">Alan</p>
            <p className="flex items-start gap-1.5 overflow-hidden break-words text-xs leading-relaxed text-muted-foreground">
              {quotePreview.isProperty && <Home className="mt-[3px] h-3 w-3 shrink-0" aria-hidden="true" />}
              <span className="line-clamp-2">{quotePreview.text}</span>
            </p>
          </div>
          <button
            onClick={onClearQuote}
            className="mt-1 h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 px-1 overflow-x-auto">
          {attachments.map((att, i) => {
            const isImage = att.file.type.startsWith("image/");
            return (
              <div key={i} className="relative shrink-0 group">
                {isImage ? (
                  <div className="relative h-16 w-16 rounded-lg border border-border overflow-hidden">
                    <img
                      src={att.previewUrl}
                      alt={att.file.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5">
                      <ImageIcon className="h-3 w-3 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="h-16 w-28 rounded-lg border border-border bg-muted flex items-center gap-1.5 px-2">
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground truncate leading-tight">
                      {att.file.name}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isRecording ? (
        <div>
          {/* Live region aparte: anuncia el estado una vez; el timer queda fuera para no leer cada segundo. */}
          <span role="status" className="sr-only">Grabando mensaje de voz</span>
          <div className="flex items-center gap-2.5">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Cancelar grabación"
              className="h-11 w-11 shrink-0 rounded-full border border-[rgba(255,90,77,0.35)] bg-[rgba(255,90,77,0.10)] text-[hsl(var(--accent-soft-foreground))] hover:bg-[rgba(255,90,77,0.16)] hover:text-[hsl(var(--accent-soft-foreground))] [&_svg]:size-[18px]"
              onClick={() => cancelRecording()}
            >
              <X strokeWidth={1.9} />
            </Button>
            {/* Píldora de vidrio 44: punto rojo con anillo + timer en --hot + onda */}
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/5 px-4">
              <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-[hsl(var(--accent))] shadow-[0_0_0_4px_rgba(255,90,77,0.18)] motion-safe:animate-pulse" aria-hidden="true" />
              <span className="shrink-0 text-sm font-semibold tabular-nums text-[hsl(var(--hot))]">{formatElapsed(elapsed)}</span>
              <RecordingWave />
            </div>
            <Button
              size="icon"
              onClick={handleStopTap}
              aria-label="Enviar mensaje de voz"
              className="h-11 w-11 shrink-0 rounded-full bg-[linear-gradient(150deg,hsl(var(--brand)),hsl(var(--brand-deep)))] text-white shadow-[0_10px_24px_-10px_rgba(76,141,255,0.9)] hover:opacity-90"
            >
              <SendHorizontal className="h-4.5 w-4.5" />
            </Button>
          </div>
          <p className="mt-2.5 text-center text-[11px] text-[#7E8694]">
            {didHoldRef.current ? "Soltá para enviar · deslizá para cancelar" : "Tocá la flecha para enviar · la X para cancelar"}
          </p>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11 shrink-0 rounded-full border border-white/[0.08] bg-white/5 hover:bg-white/10"
            disabled={disabled || attachments.length >= 4}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4.5 w-4.5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Escribí tu mensaje..."
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none rounded-[22px] border border-white/[0.08] bg-white/5 px-[18px] py-[10px] min-h-[44px] text-[15px] placeholder:text-[#7E8694] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          {hasContent ? (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!hasContent || disabled}
              className="h-11 w-11 shrink-0 rounded-full bg-[linear-gradient(150deg,hsl(var(--brand)),hsl(var(--brand-deep)))] text-white shadow-[0_10px_24px_-10px_rgba(76,141,255,0.9)] hover:opacity-90"
            >
              <SendHorizontal className="h-4.5 w-4.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              disabled={disabled}
              aria-label="Grabar mensaje de voz"
              title="Mantené apretado para grabar (o tocá para empezar)"
              className="h-11 w-11 shrink-0 rounded-full bg-[linear-gradient(150deg,hsl(var(--brand)),hsl(var(--brand-deep)))] text-white shadow-[0_10px_24px_-10px_rgba(76,141,255,0.9)] hover:opacity-90 select-none touch-none"
              onPointerDown={handleMicPointerDown}
              onPointerUp={handleMicPointerUp}
              onPointerLeave={handleMicPointerLeave}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Mic className="h-4.5 w-4.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default ChatInput;
