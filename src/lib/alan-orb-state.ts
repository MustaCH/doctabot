// Mapea las banderas reales del chat → estado del orb de Alan (F2 · Corriente).
// La tabla de estados vive en docs/design/redesign-premium/README.md §3 y los valores
// CSS en src/components/alan-orb.css. Puro y testeable (sin React).
import type { AlanOrbState } from "@/components/AlanOrb";

/** Mensaje estático que persiste el catch de chat/index.ts cuando el turno falla.
    Si cambia allá, tiene que cambiar acá (hay test de contrato). */
export const TURN_ERROR_MESSAGE =
  "Lo siento, hubo un problema generando la respuesta. ¿Podés intentar de nuevo?";

export function isTurnErrorMessage(content: string): boolean {
  return content.trim() === TURN_ERROR_MESSAGE;
}

export interface OrbFlags {
  /** recordingState === "recording" (use-audio-recorder, vía ChatInput). */
  isRecording?: boolean;
  /** isWorking (use-chat-messages): del envío al primer token, y en los gaps del tool-loop. */
  isWorking?: boolean;
  /** isStreaming (use-chat-messages): el turno completo; con isWorking false = llegan tokens. */
  isStreaming?: boolean;
  /** Alguna conversación con has_unread. */
  hasUnread?: boolean;
  /** El último mensaje es el error estático del catch de index.ts. */
  lastTurnFailed?: boolean;
}

/** Prioridad: lo que el usuario hace ahora (grabar) > el turno en curso (piensa/ejecuta)
    > el resultado (error) > lo pendiente (atención) > reposo. */
export function deriveOrbState(f: OrbFlags): AlanOrbState {
  if (f.isRecording) return "listening";
  if (f.isWorking) return "thinking";
  if (f.isStreaming) return "executing";
  if (f.lastTurnFailed) return "error";
  if (f.hasUnread) return "attention";
  return "idle";
}
