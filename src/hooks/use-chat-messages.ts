import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, type Msg, type MsgAttachment } from "@/lib/stream-chat";
import { MSG_BREAK } from "@/lib/stream-markers";
import { splitBubbles } from "@/lib/draft-parse";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { feedbackReceive } from "@/hooks/use-feedback";
import type { ChatAttachment } from "@/components/ChatInput";
import { useFileProcessing } from "@/hooks/use-file-processing";
import { transcribeAudio } from "@/hooks/use-audio-recorder";

// Persistencia de adjuntos del chat (ticket 86aj0p5bg): las imágenes van a Storage y se
// reconstruyen al recargar; los PDFs/citas viajan como texto en messages.ai_content.
const ATTACHMENTS_BUCKET = "chat-attachments";
const SIGNED_URL_TTL = 60 * 60 * 24; // 24h: cubre display + re-envío dentro de la sesión

type StoredAttachmentRef = {
  type: "image" | "file" | "audio";
  path?: string;        // imágenes y notas de voz (objeto en Storage)
  mimeType: string;
  fileName?: string;
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Sube las imágenes a Storage y devuelve refs serializables para messages.attachments. */
async function persistAttachments(
  userId: string,
  convId: string,
  atts?: MsgAttachment[],
): Promise<StoredAttachmentRef[] | null> {
  if (!atts || atts.length === 0) return null;
  const refs: StoredAttachmentRef[] = [];
  for (const att of atts) {
    if (att.type === "image" && att.base64) {
      const ext = (att.mimeType.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
      const path = `${userId}/${convId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, base64ToBytes(att.base64), { contentType: att.mimeType, upsert: false });
      if (error) { console.error("Error subiendo adjunto:", error); continue; }
      refs.push({ type: "image", path, mimeType: att.mimeType, fileName: att.fileName });
    } else {
      // PDFs/otros: el texto ya va en ai_content; guardamos metadata para reconstruir el chip.
      refs.push({ type: att.type, mimeType: att.mimeType, fileName: att.fileName });
    }
  }
  return refs.length > 0 ? refs : null;
}

/** Sube el blob de una nota de voz a Storage y devuelve un ref serializable para messages.attachments. */
async function persistAudio(
  userId: string,
  convId: string,
  blob: Blob,
): Promise<StoredAttachmentRef[] | null> {
  const mimeType = blob.type || "audio/webm";
  // blob.type suele venir como "audio/webm;codecs=opus" → nos quedamos con la extensión limpia.
  const ext = (mimeType.split("/")[1]?.split(";")[0] || "webm").replace(/[^a-z0-9]/gi, "");
  const path = `${userId}/${convId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: false });
  if (error) { console.error("Error subiendo nota de voz:", error); return null; }
  return [{ type: "audio", path, mimeType }];
}

/** Reconstruye adjuntos (imágenes) + audioUrl de la nota de voz desde lo persistido, firmando URLs de Storage. */
async function reconstructAttachments(stored: unknown): Promise<{ attachments?: MsgAttachment[]; audioUrl?: string }> {
  if (!Array.isArray(stored) || stored.length === 0) return {};
  const out: MsgAttachment[] = [];
  let audioUrl: string | undefined;
  for (const a of stored as StoredAttachmentRef[]) {
    if (a.type === "audio") {
      if (a.path) {
        const { data: signed } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .createSignedUrl(a.path, SIGNED_URL_TTL);
        if (signed?.signedUrl) audioUrl = signed.signedUrl;
      }
      continue;
    }
    if (a.type === "image" && a.path) {
      const { data: signed } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(a.path, SIGNED_URL_TTL);
      out.push({ type: "image", url: signed?.signedUrl, storagePath: a.path, mimeType: a.mimeType, fileName: a.fileName });
    } else {
      out.push({ type: a.type, mimeType: a.mimeType, fileName: a.fileName });
    }
  }
  return { attachments: out.length > 0 ? out : undefined, audioUrl };
}

/** Mapea el historial para que la IA reciba el contenido enriquecido (PDF/cita) cuando existe. */
function historyForAI(msgs: Msg[]): Msg[] {
  return msgs.map((m) => (m.aiContent ? { ...m, content: m.aiContent } : m));
}

export function useChatMessages(
  activeConvId: string | null,
  createConversation: () => Promise<string>,
  setActiveConvId: (id: string) => void,
  loadConversations: () => Promise<void>,
  markAsRead?: (convId: string) => Promise<void>
) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // "Alan trabajando": el turno sigue activo pero no hay texto entrando ahora mismo —
  // al inicio del turno (antes del primer token) y en los gaps del tool-loop (tras un
  // ===MSG_BREAK===, mientras corren tools antes de la continuación). Ticket 86aj1naw2.
  // workingRef evita re-renders redundantes (sólo conmutamos el state al cruzar el flanco).
  const [isWorking, setIsWorking] = useState(false);
  const workingRef = useRef(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guarda SÍNCRONA anti doble-envío: isStreaming se setea recién después de varios awaits
  // (createConversation / processAttachments), así que un doble tap colaba dos envíos.
  // Se toma al entrar a handleSend/handleSendAudio y se libera en el finally.
  const sendingRef = useRef(false);
  // m4: fila de la última nota de voz cuya transcripción FALLÓ. Si el usuario regraba enseguida
  // (misma conversación), el reintento ACTUALIZA esa fila en vez de insertar otra — evita notas
  // duplicadas en el historial. Trade-off asumido: el audio anterior queda huérfano en Storage
  // (no se borra acá para mantener el flujo simple; lo cubre una limpieza batch futura).
  const failedVoiceRef = useRef<{ id: string; convId: string } | null>(null);
  const skipNextLoadRef = useRef(false);
  const mountedRef = useRef(true);
  const streamInterruptedRef = useRef(false);
  const { isProcessingPdf, processAttachments } = useFileProcessing();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Conmuta el indicador "Alan trabajando" sólo en el flanco, sincronizando ref + state.
  const setWorking = useCallback((value: boolean) => {
    if (workingRef.current === value) return;
    workingRef.current = value;
    if (mountedRef.current) setIsWorking(value);
  }, []);

  // Reusable function to reload messages from DB
  const reloadMessagesFromDB = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("role, content, ai_content, attachments")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) {
      const LEGACY_BREAK = "\n\n---\n\n";
      const expanded: Msg[] = [];
      for (const msg of data) {
        if (msg.role === "assistant" && (msg.content.includes(MSG_BREAK) || msg.content.includes(LEGACY_BREAK))) {
          // splitBubbles es consciente de drafts: un ===MSG_BREAK=== dentro de una región
          // <<<DRAFT_START>>>…<<<DRAFT_END>>> NO corta (paridad con MarkerStream en streaming —
          // antes el split plano hacía que el mismo mensaje se viera distinto al recargar).
          const parts = msg.content.includes(MSG_BREAK)
            ? splitBubbles(msg.content)
            : msg.content.split(LEGACY_BREAK);
          for (const part of parts) {
            if (part.trim()) expanded.push({ role: "assistant", content: part.trim() });
          }
        } else {
          // Reconstruimos el contexto multimodal del mensaje del usuario: adjuntos (imágenes
          // desde Storage) + ai_content (PDF/[REFERENCIA]) para que Alan no lo pierda al recargar.
          const m: Msg = { role: msg.role as Msg["role"], content: msg.content };
          if (msg.ai_content) m.aiContent = msg.ai_content;
          const { attachments, audioUrl } = await reconstructAttachments(msg.attachments);
          if (attachments) m.attachments = attachments;
          if (audioUrl) m.audioUrl = audioUrl;
          expanded.push(m);
        }
      }
      if (mountedRef.current) {
        setMessages(expanded);
        setIsStreaming(false);
      }
    }
  }, []);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    reloadMessagesFromDB(activeConvId);
  }, [activeConvId, reloadMessagesFromDB]);

  // Auto-reload when app returns from background — always reload if there was
  // a stream in progress OR if the app was hidden for any period
  useEffect(() => {
    let hiddenSince: number | null = null;
    const handler = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      // Visible again
      if (!activeConvId) return;
      const wasInterrupted = streamInterruptedRef.current;
      const wasHiddenLongEnough = hiddenSince && (Date.now() - hiddenSince) > 2000;
      if (wasInterrupted || wasHiddenLongEnough) {
        reloadMessagesFromDB(activeConvId);
        streamInterruptedRef.current = false;
        loadConversations();
      }
      hiddenSince = null;
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [activeConvId, reloadMessagesFromDB, loadConversations]);

  // Detect if an error is a network/background interruption (not user-initiated)
  const isBackgroundNetworkError = (err: any): boolean => {
    if (err.name === "AbortError" && !abortRef.current?.signal.aborted) return true;
    if (document.visibilityState === "hidden") return true;
    if (err instanceof TypeError) return true;
    if (err.message?.includes("network") || err.message?.includes("fetch") || err.message?.includes("Failed to fetch")) return true;
    return false;
  };

  const handleStreamError = (err: any) => {
    if (mountedRef.current) {
      setIsStreaming(false);
      setIsTranscribing(false);
    }
    setWorking(false);
    if (isBackgroundNetworkError(err)) {
      streamInterruptedRef.current = true;
      // If already visible, reload immediately
      if (document.visibilityState === "visible" && activeConvId) {
        reloadMessagesFromDB(activeConvId);
        streamInterruptedRef.current = false;
      }
      return;
    }
    if (err.message === "rate_limit") {
      toast.error("Demasiadas solicitudes. Intentá de nuevo en un momento.");
    } else if (err.message === "payment_required") {
      toast.error("Créditos insuficientes. Contactá al administrador.");
    } else if (err.name !== "AbortError") {
      toast.error("Error al conectar con Alan. Intentá de nuevo.");
    }
  };

  // Bloque de streaming compartido por texto / audio / reintento (86ak3kd99): callbacks de
  // deltas, reemplazo onFinal (86aj9w5nb) y cierre. Antes estaba duplicado en doSend y doSendAudio.
  const runAssistantStream = async (convId: string, aiMessages: Msg[]) => {
    setIsStreaming(true);
    setWorking(true); // turno arrancando: indicador hasta el primer token

    let assistantContent = "";
    let needsNewBubble = false;
    let assistantBubbles = 0; // burbujas assistant agregadas este turno (para el reemplazo onFinal)
    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat({
      messages: aiMessages,
      conversationId: convId,
      signal: controller.signal,
      onDelta: (chunk) => {
        assistantContent += chunk;
        // Entró texto: el turno está produciendo salida → ocultar "Alan trabajando".
        setWorking(false);
        if (!mountedRef.current) return;
        const snapshot = assistantContent;
        const startNew = needsNewBubble;
        if (startNew) needsNewBubble = false;
        // Conteo de burbujas assistant agregadas ESTE turno (lo usa el reemplazo onFinal):
        // se abre una con startNew o con la primera delta del turno.
        if (startNew || assistantBubbles === 0) assistantBubbles += 1;
        setMessages((prev) => {
          if (startNew) return [...prev, { role: "assistant" as const, content: snapshot }];
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m));
          return [...prev, { role: "assistant" as const, content: snapshot }];
        });
      },
      // Reemplazo final (86aj9w5nb): el server goteó la ronda final en vivo y manda el texto
      // SANEADO completo (tarjetas expandidas, links verificados). Descartamos las burbujas
      // streameadas de esta respuesta y re-renderizamos con el MISMO parseo que la recarga.
      onFinal: (content) => {
        setWorking(false);
        if (!mountedRef.current) return;
        const finalBubbles = splitBubbles(content).map((b) => b.trim()).filter(Boolean);
        const toDrop = assistantBubbles;
        setMessages((prev) => [
          ...prev.slice(0, prev.length - toDrop),
          ...finalBubbles.map((b) => ({ role: "assistant" as const, content: b })),
        ]);
        assistantBubbles = finalBubbles.length;
        assistantContent = finalBubbles[finalBubbles.length - 1] ?? "";
        needsNewBubble = false;
      },
      onNewMessage: () => {
        assistantContent = "";
        needsNewBubble = true;
        // Boundary del tool-loop (===MSG_BREAK===): pausa antes de la continuación → mostrar indicador.
        setWorking(true);
        if (!mountedRef.current) return;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content.trim() } : m));
          return prev;
        });
      },
      onDone: async () => {
        if (mountedRef.current) setIsStreaming(false);
        setWorking(false);
        feedbackReceive();
        // Message is already saved to DB by the edge function
        if (markAsRead) await markAsRead(convId);
        loadConversations();
      },
    });
  };

  // Reintento del último turno fallido (86ak3kd99): reenvía el último mensaje del usuario
  // SIN volver a insertarlo (ya está persistido → no se duplica en el historial) y corta el
  // contexto en ese mensaje (el mensaje de error de Alan no viaja como historia).
  const retryLastTurn = async () => {
    if (isStreaming || sendingRef.current) return;
    const convId = activeConvId;
    if (!convId) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    sendingRef.current = true;
    try {
      await runAssistantStream(convId, historyForAI(messages.slice(0, lastUserIdx + 1)));
    } catch (err) {
      handleStreamError(err);
    } finally {
      sendingRef.current = false;
    }
  };

  const handleSend = async (text: string, chatAttachments?: ChatAttachment[]) => {
    if (isStreaming || sendingRef.current) return;
    sendingRef.current = true;
    try {
      await doSend(text, chatAttachments);
    } finally {
      sendingRef.current = false;
    }
  };

  const doSend = async (text: string, chatAttachments?: ChatAttachment[]) => {
    let convId = activeConvId;
    if (!convId) {
      try {
        convId = await createConversation();
        skipNextLoadRef.current = true;
        setActiveConvId(convId);
      } catch {
        toast.error("Error al crear conversación");
        return;
      }
    }

    const { msgAttachments, pdfTexts } = await processAttachments(chatAttachments);

    let displayContent = text;
    let aiContent = text;
    let msgQuotedText: string | undefined;
    if (quotedText) {
      let cleanQuote = quotedText
        .replace(/!\[.*?\]\(.*?\)/g, "[imagen]")
        .replace(/https?:\/\/\S{60,}/g, "[enlace]")
        .replace(/\*\*/g, "")
        .trim();
      if (cleanQuote.length > 200) cleanQuote = cleanQuote.slice(0, 200) + "…";
      msgQuotedText = cleanQuote;
      const plainQuote = cleanQuote
        .replace(/🏠/g, "Propiedad:")
        .replace(/💰/g, "Precio:")
        .replace(/📍/g, "Ubicación:")
        .replace(/📐/g, "Superficie:")
        .replace(/🏢/g, "Oficina:")
        .replace(/🔗/g, "Link:")
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
      aiContent = `[REFERENCIA - el usuario cita este mensaje anterior como contexto. NO repetir esta info como tarjeta de propiedad. Ejecutar la acción que pide el usuario.]\n${plainQuote}\n[FIN REFERENCIA]\n\n${aiContent}`;
      setQuotedText(null);
    }
    if (pdfTexts.length > 0) {
      const pdfContext = pdfTexts.join("\n\n");
      aiContent = aiContent ? `${aiContent}\n\n${pdfContext}` : pdfContext;
    }

    const hasImages = msgAttachments && msgAttachments.some(a => a.type === "image");
    const hasPdfs = pdfTexts.length > 0;
    const fallbackDisplay = hasImages ? "(imagen adjunta)" : hasPdfs ? "(archivo adjunto)" : "(archivo adjunto)";
    const fallbackAI = hasImages ? "(imagen adjunta)" : hasPdfs ? aiContent : "(archivo adjunto)";
    const userMsg: Msg = {
      role: "user",
      content: aiContent || fallbackAI,
      attachments: msgAttachments,
      quotedText: msgQuotedText,
    };
    const displayText = displayContent || fallbackDisplay;
    // Contenido "para la IA" cuando difiere del que se muestra (cita / texto de PDF embebido).
    const aiForPersist = aiContent && aiContent !== displayText ? aiContent : null;
    const displayMsg: Msg = {
      role: "user",
      content: displayText,
      aiContent: aiForPersist ?? undefined,
      attachments: msgAttachments,
      quotedText: msgQuotedText,
    };
    const newMessages = [...messages, displayMsg];
    setMessages(newMessages);
    setIsStreaming(true);
    setWorking(true); // turno arrancando: indicador hasta el primer token

    // El try envuelve TODO lo que viene después de setIsStreaming(true): entre medio hay awaits
    // (getSession, persistAttachments con atob, insert) que pueden tirar — si quedaban fuera del
    // try, isStreaming quedaba en true para siempre y el input se deshabilitaba (M1).
    try {
      // Subimos los adjuntos a Storage para poder reconstruirlos al recargar.
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      const attachmentRefs = session?.user.id
        ? await persistAttachments(session.user.id, convId, msgAttachments)
        : null;

      // Persistimos el mensaje del usuario ANTES de arrancar el stream (orden garantizado:
      // user antes que assistant). Si falla, no streameamos → evitamos un assistant sin user
      // y no perdemos el mensaje en silencio.
      const { error: userInsertError } = await supabase.from("messages").insert({
        conversation_id: convId,
        role: "user",
        content: displayText,
        ai_content: aiForPersist,
        attachments: (attachmentRefs as Json) ?? null,
      });
      if (userInsertError) {
        console.error("Error guardando mensaje del usuario:", userInsertError);
        toast.error("No se pudo guardar tu mensaje. Intentá de nuevo.");
        if (mountedRef.current) setIsStreaming(false);
        setWorking(false);
        return;
      }

      const aiMessages = [...historyForAI(messages), userMsg];
      await runAssistantStream(convId!, aiMessages);
    } catch (err: any) {
      handleStreamError(err);
    }
  };

  const handleSendAudio = async (blob: Blob, localUrl: string) => {
    if (isStreaming || isTranscribing || sendingRef.current) return;
    sendingRef.current = true;
    try {
      await doSendAudio(blob, localUrl);
    } finally {
      sendingRef.current = false;
    }
  };

  const doSendAudio = async (blob: Blob, localUrl: string) => {
    let convId = activeConvId;
    if (!convId) {
      try {
        convId = await createConversation();
        skipNextLoadRef.current = true;
        setActiveConvId(convId);
      } catch {
        toast.error("Error al crear conversación");
        return;
      }
    }

    // m4: reintento tras un fallo de transcripción en esta misma conversación → la burbuja
    // nueva REEMPLAZA la anterior fallida (y su fila en DB se actualiza en vez de duplicarse).
    const isRetry = failedVoiceRef.current?.convId === convId;
    const audioMsg: Msg = { role: "user", content: "(mensaje de voz)", audioUrl: localUrl };
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (isRetry && last?.role === "user" && last.audioUrl && last.content === "(mensaje de voz)") {
        return prev.map((m, i) => (i === prev.length - 1 ? audioMsg : m));
      }
      return [...prev, audioMsg];
    });
    setIsTranscribing(true);

    try {
      // Persistimos la nota de voz ANTES de transcribir: el audio va a Storage y la fila entra en
      // `messages` con un placeholder. Así, si la transcripción falla, el mensaje NO desaparece al
      // recargar (antes el insert recién ocurría después de transcribir y la nota se perdía).
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      const audioRefs = session?.user.id
        ? await persistAudio(session.user.id, convId!, blob)
        : null;

      let insertedId: string;
      if (isRetry && failedVoiceRef.current) {
        // Reintento: actualizamos la fila fallida con el audio nuevo (sin insertar otra).
        insertedId = failedVoiceRef.current.id;
        const { error: retryUpdateError } = await supabase
          .from("messages")
          .update({ attachments: (audioRefs as Json) ?? null })
          .eq("id", insertedId);
        if (retryUpdateError) {
          console.error("Error actualizando la nota de voz reintentada:", retryUpdateError);
          toast.error("No se pudo guardar tu mensaje. Intentá de nuevo.");
          setIsTranscribing(false);
          return;
        }
      } else {
        const { data: inserted, error: userInsertError } = await supabase
          .from("messages")
          .insert({ conversation_id: convId!, role: "user", content: "(mensaje de voz)", attachments: (audioRefs as Json) ?? null })
          .select("id")
          .single();
        if (userInsertError || !inserted) {
          console.error("Error guardando mensaje de voz del usuario:", userInsertError);
          toast.error("No se pudo guardar tu mensaje. Intentá de nuevo.");
          setIsTranscribing(false);
          return;
        }
        insertedId = inserted.id;
      }

      // m2: la transcripción tiene su catch propio — la nota YA quedó guardada, así que el fallo
      // acá no es "error de conexión con Alan" sino "no pude transcribir" con su motivo real.
      let transcript: string;
      try {
        transcript = await transcribeAudio(blob);
      } catch (transcribeErr: any) {
        const motivo =
          transcribeErr?.name === "TranscriptionError" && transcribeErr.message !== "transcription_failed"
            ? transcribeErr.message
            : null;
        toast.error(
          motivo
            ? `La nota de voz quedó guardada, pero no pude transcribirla: ${motivo}`
            : "La nota de voz quedó guardada, pero no pude transcribirla. Probá de nuevo.",
        );
        failedVoiceRef.current = { id: insertedId, convId: convId! };
        setIsTranscribing(false);
        return;
      }
      if (!transcript) {
        // La nota quedó persistida con su audio; solo faltó el texto. Avisamos sin descartar nada.
        toast.error("No se pudo transcribir el audio. La nota de voz quedó guardada; probá de nuevo.");
        failedVoiceRef.current = { id: insertedId, convId: convId! };
        setIsTranscribing(false);
        return;
      }
      failedVoiceRef.current = null;

      const displayContent = `🎙️ ${transcript}`;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.audioUrl === localUrl
            ? { ...m, content: displayContent }
            : m
        )
      );
      setIsTranscribing(false);

      // Actualizamos el placeholder: content = lo que se muestra ("🎙️ …"); ai_content = lo que ve
      // la IA (transcript limpio). El ref del audio ya quedó en attachments desde el insert.
      const { error: updateError } = await supabase
        .from("messages")
        .update({ content: displayContent, ai_content: transcript })
        .eq("id", insertedId);
      if (updateError) console.error("Error actualizando transcript del mensaje de voz:", updateError);

      const msgsForAI: Msg[] = [...historyForAI(messages), { role: "user", content: transcript }];
      await runAssistantStream(convId!, msgsForAI);
    } catch (err: any) {
      handleStreamError(err);
    }
  };

  return {
    messages,
    isStreaming,
    isWorking,
    isProcessingPdf,
    isTranscribing,
    quotedText,
    setQuotedText,
    handleSend,
    handleSendAudio,
    retryLastTurn,
  };
}
