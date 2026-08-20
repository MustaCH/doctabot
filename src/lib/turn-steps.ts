// Pasos del tool-loop en el front (ticket 86ak3kd5r). Puro y testeable.
// El server emite {"step": {tool, label, status}} por SSE (ver sse.ts): "running" al
// arrancar cada tool y "done" al terminar (label determinista de tool-steps.ts).

export interface TurnStep {
  tool: string;
  label: string;
  status: "running" | "done";
}

/** Valida el payload de un evento step del stream. Devuelve null si no tiene la forma esperada. */
export function parseStepEvent(raw: unknown): TurnStep | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.tool !== "string" || typeof s.label !== "string") return null;
  if (s.status !== "running" && s.status !== "done") return null;
  return { tool: s.tool, label: s.label, status: s.status };
}

/**
 * Acumula un paso en la lista del turno:
 * - "running" → se agrega al final (es el paso actual).
 * - "done" → resuelve el último "running" de esa misma tool (actualiza label + estado);
 *   si no hay uno pendiente, se agrega ya completado.
 */
export function applyTurnStep(steps: TurnStep[], step: TurnStep): TurnStep[] {
  if (step.status === "running") return [...steps, step];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].tool === step.tool && steps[i].status === "running") {
      return steps.map((s, j) => (j === i ? step : s));
    }
  }
  return [...steps, step];
}
