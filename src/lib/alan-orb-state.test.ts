// Frontend — Mapeo banderas del chat → estado del orb (ticket 86ak3kbp2).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveOrbState, isTurnErrorMessage, turnErrorAllowsRetry } from "@/lib/alan-orb-state";
import { buildTurnErrorMessage, TURN_ERROR_PREFIX } from "../../supabase/functions/chat/_shared/turn-error";

/** Mensaje estático que persistía el catch ANTES del ticket 86ak3kd99 (sigue en DB). */
const LEGACY_ERROR_MESSAGE = "Lo siento, hubo un problema generando la respuesta. ¿Podés intentar de nuevo?";

describe("deriveOrbState — mapeo y prioridad", () => {
  it("sin banderas → reposo", () => {
    expect(deriveOrbState({})).toBe("idle");
  });

  it("recordingState grabando → escucha", () => {
    expect(deriveOrbState({ isRecording: true })).toBe("listening");
  });

  it("isWorking → piensa (aunque isStreaming esté activo: el turno entero streamea)", () => {
    expect(deriveOrbState({ isWorking: true, isStreaming: true })).toBe("thinking");
  });

  it("isStreaming sin isWorking (llegan tokens) → ejecuta", () => {
    expect(deriveOrbState({ isStreaming: true })).toBe("executing");
  });

  it("último turno fallido → error", () => {
    expect(deriveOrbState({ lastTurnFailed: true })).toBe("error");
  });

  it("conversaciones sin leer → atención", () => {
    expect(deriveOrbState({ hasUnread: true })).toBe("attention");
  });

  it("grabar le gana a todo lo demás", () => {
    expect(
      deriveOrbState({ isRecording: true, isWorking: true, isStreaming: true, hasUnread: true, lastTurnFailed: true })
    ).toBe("listening");
  });

  it("el turno en curso le gana al error viejo y a lo pendiente", () => {
    expect(deriveOrbState({ isWorking: true, hasUnread: true, lastTurnFailed: true })).toBe("thinking");
  });

  it("el error le gana a atención", () => {
    expect(deriveOrbState({ lastTurnFailed: true, hasUnread: true })).toBe("error");
  });
});

describe("isTurnErrorMessage / turnErrorAllowsRetry — contrato con el catch de chat/index.ts", () => {
  it("detecta los mensajes nuevos por prefijo y el estático viejo persistido en DB", () => {
    expect(isTurnErrorMessage(buildTurnErrorMessage([]))).toBe(true);
    expect(isTurnErrorMessage(buildTurnErrorMessage(["send_email"]))).toBe(true);
    expect(isTurnErrorMessage(LEGACY_ERROR_MESSAGE)).toBe(true);
    expect(isTurnErrorMessage(`  ${LEGACY_ERROR_MESSAGE}\n`)).toBe(true);
  });

  it("no matchea respuestas normales que mencionan problemas", () => {
    expect(isTurnErrorMessage("Hubo un problema con esa búsqueda, probá con otro barrio.")).toBe(false);
  });

  it("reintento habilitado solo sin tools con efecto; los viejos no lo habilitan", () => {
    expect(turnErrorAllowsRetry(buildTurnErrorMessage([]))).toBe(true);
    expect(turnErrorAllowsRetry(buildTurnErrorMessage(["search_properties", "list_clients"]))).toBe(true);
    expect(turnErrorAllowsRetry(buildTurnErrorMessage(["search_properties", "send_email"]))).toBe(false);
    expect(turnErrorAllowsRetry(buildTurnErrorMessage(["create_calendar_event"]))).toBe(false);
    expect(turnErrorAllowsRetry(LEGACY_ERROR_MESSAGE)).toBe(false);
  });

  it("el mensaje con efecto nombra la acción en humano, no el nombre de la tool", () => {
    const msg = buildTurnErrorMessage(["send_email"]);
    expect(msg).toContain("enviar un email");
    expect(msg).not.toContain("send_email");
  });

  it("el legacy y los nuevos comparten prefijo, y el catch de index.ts usa el builder", () => {
    expect(LEGACY_ERROR_MESSAGE.startsWith(TURN_ERROR_PREFIX)).toBe(true);
    const backend = readFileSync(resolve(__dirname, "../../supabase/functions/chat/index.ts"), "utf8");
    expect(backend).toContain("buildTurnErrorMessage(executedTools)");
  });
});
