// Frontend — Acumulación de pasos del tool-loop (ticket 86ak3kd5r).
import { describe, it, expect } from "vitest";
import { applyTurnStep, parseStepEvent, type TurnStep } from "@/lib/turn-steps";

describe("parseStepEvent — validación del payload SSE", () => {
  it("acepta la forma canónica", () => {
    expect(parseStepEvent({ tool: "send_email", label: "Enviando el email", status: "running" })).toEqual({
      tool: "send_email",
      label: "Enviando el email",
      status: "running",
    });
  });

  it("rechaza shapes desconocidos sin tirar", () => {
    expect(parseStepEvent(undefined)).toBeNull();
    expect(parseStepEvent(null)).toBeNull();
    expect(parseStepEvent("step")).toBeNull();
    expect(parseStepEvent({ tool: "x" })).toBeNull();
    expect(parseStepEvent({ tool: "x", label: "y", status: "otro" })).toBeNull();
  });
});

describe("applyTurnStep — reducer de la lista del turno", () => {
  const running = (tool: string, label = tool): TurnStep => ({ tool, label, status: "running" });
  const done = (tool: string, label = tool): TurnStep => ({ tool, label, status: "done" });

  it("running agrega al final; done resuelve el running de esa tool con el label final", () => {
    let steps: TurnStep[] = [];
    steps = applyTurnStep(steps, running("get_client", "Buscando el cliente"));
    steps = applyTurnStep(steps, done("get_client", "Encontré a Marina Sosa"));
    steps = applyTurnStep(steps, running("create_calendar_event", "Creando el evento"));
    expect(steps).toEqual([
      { tool: "get_client", label: "Encontré a Marina Sosa", status: "done" },
      { tool: "create_calendar_event", label: "Creando el evento", status: "running" },
    ]);
  });

  it("dos ejecuciones de la MISMA tool: cada done resuelve la última pendiente", () => {
    let steps: TurnStep[] = [];
    steps = applyTurnStep(steps, running("search_properties"));
    steps = applyTurnStep(steps, done("search_properties", "Encontré 4 propiedades"));
    steps = applyTurnStep(steps, running("search_properties"));
    steps = applyTurnStep(steps, done("search_properties", "Encontré 2 propiedades"));
    expect(steps.map((s) => s.status)).toEqual(["done", "done"]);
    expect(steps[1].label).toBe("Encontré 2 propiedades");
    expect(steps[0].label).toBe("Encontré 4 propiedades");
  });

  it("done sin running previo (evento perdido) se agrega igual, ya completado", () => {
    const steps = applyTurnStep([], done("web_search", "Busqué en la web"));
    expect(steps).toEqual([{ tool: "web_search", label: "Busqué en la web", status: "done" }]);
  });
});
