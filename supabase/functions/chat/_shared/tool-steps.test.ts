// Backend — Labels deterministas de pasos del tool-loop (ticket 86ak3kd5r).
import { describe, it, expect } from "vitest";
import { runningLabel, doneLabel } from "./tool-steps.ts";

describe("tool-steps — mapeo determinista (nunca del modelo)", () => {
  it("tools conocidas tienen label humano en running y done", () => {
    expect(runningLabel("search_properties")).toBe("Buscando propiedades");
    expect(doneLabel("create_calendar_event")).toBe("Creé el evento");
    expect(doneLabel("send_email")).toBe("Envié el email");
  });

  it("tool desconocida cae al genérico (no revienta ni muestra el nombre crudo)", () => {
    expect(runningLabel("tool_nueva_x")).toBe("Ejecutando una herramienta");
    expect(doneLabel("tool_nueva_x")).toBe("Listo");
  });

  it("search_properties enriquece con el total_count real del resultado", () => {
    expect(doneLabel("search_properties", JSON.stringify({ total_count: 4 }))).toBe("Encontré 4 propiedades");
    expect(doneLabel("search_properties", JSON.stringify({ total_count: 1 }))).toBe("Encontré 1 propiedad");
  });

  it("get_client enriquece con el nombre real del cliente", () => {
    expect(doneLabel("get_client", JSON.stringify({ client: { full_name: "Marina Sosa" } }))).toBe("Encontré a Marina Sosa");
  });

  it("resultado malformado → fail-open al label base", () => {
    expect(doneLabel("search_properties", "{no-es-json")).toBe("Busqué propiedades");
    expect(doneLabel("list_clients", JSON.stringify({ otra_cosa: true }))).toBe("Revisé tus contactos");
  });
});
