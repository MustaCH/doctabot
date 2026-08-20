// Frontend — Mapeo banderas del chat → estado del orb (ticket 86ak3kbp2).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveOrbState, isTurnErrorMessage, TURN_ERROR_MESSAGE } from "@/lib/alan-orb-state";

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

describe("isTurnErrorMessage — contrato con el catch de chat/index.ts", () => {
  it("detecta el mensaje estático exacto (con espacios alrededor)", () => {
    expect(isTurnErrorMessage(TURN_ERROR_MESSAGE)).toBe(true);
    expect(isTurnErrorMessage(`  ${TURN_ERROR_MESSAGE}\n`)).toBe(true);
  });

  it("no matchea respuestas normales que mencionan problemas", () => {
    expect(isTurnErrorMessage("Hubo un problema con esa búsqueda, probá con otro barrio.")).toBe(false);
  });

  it("el string coincide con el que persiste el catch de chat/index.ts", () => {
    const backend = readFileSync(resolve(__dirname, "../../supabase/functions/chat/index.ts"), "utf8");
    expect(backend).toContain(TURN_ERROR_MESSAGE);
  });
});
