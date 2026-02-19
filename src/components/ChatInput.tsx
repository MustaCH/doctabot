import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SendHorizontal, Paperclip, X, FileText, Image as ImageIcon, Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { feedbackSend, feedbackAttach, feedbackRemove } from "@/hooks/use-feedback";

export interface ChatAttachment {
  file: File;
  previewUrl: string;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void;
  disabled?: boolean;
  quotedText?: string | null;
  onClearQuote?: () => void;
}

const TRANSCRIBE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`;

const ChatInput = ({ onSend, disabled, quotedText, onClearQuote }: ChatInputProps) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Focus textarea when a quote is set
  useEffect(() => {
    if (quotedText) {
      textareaRef.current?.focus();
    }
  }, [quotedText]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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

  // --- Voice recording ---
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setRecordingDuration(0);

        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (audioBlob.size < 1000) {
          toast.error("Audio demasiado corto. Intentá de nuevo.");
          return;
        }

        // Transcribe
        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");

          const resp = await fetch(TRANSCRIBE_URL, {
            method: "POST",
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: formData,
          });

          if (!resp.ok) throw new Error("Transcription failed");
          const data = await resp.json();
          const transcript = data.text?.trim();

          if (transcript) {
            setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
            // Focus and trigger resize
            setTimeout(() => {
              textareaRef.current?.focus();
              handleInput();
            }, 50);
          } else {
            toast.error("No se pudo entender el audio. Intentá de nuevo.");
          }
        } catch (err) {
          console.error("Transcription error:", err);
          toast.error("Error al transcribir. Intentá de nuevo.");
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingDuration(0);

      // Timer
      timerRef.current = window.setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone error:", err);
      toast.error("No se pudo acceder al micrófono. Revisá los permisos.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      // Remove onstop handler to prevent transcription
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
      };
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);
    chunksRef.current = [];
  }, []);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const hasContent = text.trim().length > 0 || attachments.length > 0;

  // Clean and truncate quoted text for preview
  const quotePreview = quotedText
    ? (() => {
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

      {/* Recording UI */}
      {isRecording ? (
        <div className="flex items-center gap-3 py-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0 rounded-xl text-destructive"
            onClick={cancelRecording}
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="flex-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium text-destructive">
              {formatDuration(recordingDuration)}
            </span>
            <span className="text-xs text-muted-foreground">Grabando...</span>
          </div>
          <Button
            size="icon"
            onClick={stopRecording}
            className="h-10 w-10 shrink-0 rounded-xl bg-primary"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </div>
      ) : isTranscribing ? (
        <div className="flex items-center justify-center gap-2 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Transcribiendo audio...</span>
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
              disabled={disabled}
              className="h-10 w-10 shrink-0 rounded-xl"
            >
              <SendHorizontal className="h-4.5 w-4.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              onClick={startRecording}
              disabled={disabled}
              className="h-10 w-10 shrink-0 rounded-xl"
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
