import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { SendHorizontal, Mic, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSend, disabled }: ChatInputProps) => {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecordDuration(0);

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) {
          toast.error("Audio demasiado corto");
          return;
        }

        setTranscribing(true);
        try {
          const formData = new FormData();
          formData.append("audio", blob, "audio.webm");

          const { data, error } = await supabase.functions.invoke("transcribe", {
            body: formData,
          });

          if (error) throw error;
          const transcript = data?.text?.trim();
          if (transcript && transcript.length >= 2) {
            onSend(transcript);
          } else {
            toast.error("No se pudo entender el audio. Intentá de nuevo.");
          }
        } catch {
          toast.error("Error al transcribir el audio");
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorder.start(250);
      setRecording(true);
      setRecordDuration(0);
      timerRef.current = window.setInterval(() => {
        setRecordDuration((d) => d + 1);
      }, 1000);
    } catch {
      toast.error("No se pudo acceder al micrófono");
    }
  }, [onSend]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const hasText = text.trim().length > 0;
  const isBusy = disabled || transcribing;

  return (
    <div className="border-t border-border bg-card px-3 py-2 safe-bottom">
      {recording ? (
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-destructive/10 px-4 py-2.5">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
            <span className="text-sm font-medium text-destructive">
              Grabando... {formatDuration(recordDuration)}
            </span>
          </div>
          <Button
            size="icon"
            variant="destructive"
            onClick={stopRecording}
            className="h-10 w-10 shrink-0 rounded-xl"
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={transcribing ? "Transcribiendo..." : "Escribí tu mensaje..."}
            rows={1}
            disabled={isBusy}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          {hasText ? (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={isBusy}
              className="h-10 w-10 shrink-0 rounded-xl"
            >
              <SendHorizontal className="h-4.5 w-4.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={startRecording}
              disabled={isBusy}
              variant="ghost"
              className="h-10 w-10 shrink-0 rounded-xl"
            >
              {transcribing ? (
                <div className="h-4.5 w-4.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : (
                <Mic className="h-4.5 w-4.5" />
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default ChatInput;
