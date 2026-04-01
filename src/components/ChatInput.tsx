import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SendHorizontal, Paperclip, X, FileText, Image as ImageIcon, Mic, Square, Loader2 } from "lucide-react";
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
}

const ChatInput = ({ onSend, onSendAudio, disabled, quotedText, onClearQuote }: ChatInputProps) => {
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
  const quotePreview = quotedText
    ? (() => {
        // Detect property card content and summarize it
        if (quotedText.includes("🏠")) {
          const titleMatch = quotedText.match(/🏠\s*(.+)/);
          const title = titleMatch?.[1]?.replace(/\*\*/g, "").trim();
          return title ? `🏠 ${title.length > 60 ? title.slice(0, 60) + "…" : title}` : "🏠 Propiedad";
        }
        let cleaned = quotedText
          .replace(/!\[.*?\]\(.*?\)/g, "[imagen]")
          .replace(/https?:\/\/\S{40,}/g, "[enlace]")
          .replace(/\*\*/g, "");
        return cleaned.length > 100 ? cleaned.slice(0, 100) + "…" : cleaned;
      })()
    : null;

  return (
    <div className="border-t border-border bg-card px-3 py-2 safe-bottom overflow-hidden">
      {/* Quote preview */}
      {quotePreview && (
        <div className="flex items-start gap-2 mb-2 px-1 animate-in fade-in slide-in-from-bottom-2 duration-150 overflow-hidden">
          <div className="flex-1 min-w-0 rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-1.5 overflow-hidden">
            <p className="text-[11px] font-medium text-primary mb-0.5">Alan</p>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed break-words overflow-hidden">{quotePreview}</p>
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
        <div className="flex items-center gap-3 py-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0 rounded-xl text-destructive"
            onClick={() => cancelRecording()}
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="flex-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium text-destructive">{formatElapsed(elapsed)}</span>
            <span className="text-xs text-muted-foreground">Grabando...</span>
          </div>
          <Button
            size="icon"
            onClick={handleStopTap}
            className="h-10 w-10 shrink-0 rounded-xl"
          >
            <SendHorizontal className="h-4.5 w-4.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0 rounded-xl"
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
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          {hasContent ? (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!hasContent || disabled}
              className="h-10 w-10 shrink-0 rounded-xl"
            >
              <SendHorizontal className="h-4.5 w-4.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              disabled={disabled}
              className="h-10 w-10 shrink-0 rounded-xl select-none touch-none"
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
