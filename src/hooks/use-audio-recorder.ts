import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type RecordingState = "idle" | "recording" | "processing";

const MAX_DURATION_MS = 120_000; // 2 minutes

export function useAudioRecorder() {
  const [state, setState] = useState<RecordingState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    timerRef.current = null;
    autoStopRef.current = null;
    setElapsed(0);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Safari/iOS doesn't support webm – detect best available format
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg"].find(
        (t) => MediaRecorder.isTypeSupported(t)
      );

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream); // fallback: let browser choose
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(250);
      setState("recording");
      setElapsed(0);

      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Date.now() - start), 200);
      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, MAX_DURATION_MS);

      return true;
    } catch {
      toast.error("No se pudo acceder al micrófono.");
      return false;
    }
  }, []);

  const stopRecording = useCallback((): Promise<{ blob: Blob; url: string } | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        cleanup();
        setState("idle");
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        cleanup();
        setState("idle");
        resolve({ blob, url });
      };

      recorder.stop();
    });
  }, [cleanup]);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    cleanup();
    setState("idle");
  }, [cleanup]);

  return {
    recordingState: state,
    elapsed,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("auth_required");

  const formData = new FormData();
  const ext = blob.type.includes("mp4") ? "recording.mp4" : blob.type.includes("ogg") ? "recording.ogg" : "recording.webm";
  formData.append("audio", blob, ext);

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });

  if (!resp.ok) throw new Error("transcription_failed");
  const data = await resp.json();
  return data.text || "";
}
