// Frontend — Contrato del componente AlanOrb (F2 · Corriente).
// Ticket 86ak3kbgt: 5 capas (.halo, .vessel, .fa/.fb/.fc, .shell, .spec), tamaños con
// blur propio vía data-size, y a 28px (sm) el .spec se omite del DOM.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AlanOrb } from "@/components/AlanOrb";

afterEach(cleanup);

const layers = (container: HTMLElement) => ({
  orb: container.querySelector(".alan-orb"),
  halo: container.querySelector(".halo"),
  vessel: container.querySelector(".vessel"),
  fa: container.querySelector(".vessel .fa"),
  fb: container.querySelector(".vessel .fb"),
  fc: container.querySelector(".vessel .fc"),
  shell: container.querySelector(".shell"),
  spec: container.querySelector(".spec"),
});

describe("AlanOrb — capas y tamaños", () => {
  it("renderiza las 5 capas con las corrientes dentro del vessel", () => {
    const { container } = render(<AlanOrb size="hero" />);
    const l = layers(container);
    expect(l.halo).not.toBeNull();
    expect(l.vessel).not.toBeNull();
    expect(l.fa).not.toBeNull();
    expect(l.fb).not.toBeNull();
    expect(l.fc).not.toBeNull();
    expect(l.shell).not.toBeNull();
    expect(l.spec).not.toBeNull();
    // el shell queda FUERA del vessel: el halo es lo único que sale del círculo,
    // pero el vidrio se apoya encima del recorte, no adentro
    expect(container.querySelector(".vessel .shell")).toBeNull();
  });

  it.each(["hero", "lg", "md"] as const)("size=%s expone data-size para el blur propio y conserva .spec", (size) => {
    const { container } = render(<AlanOrb size={size} />);
    const orb = layers(container).orb!;
    expect(orb.getAttribute("data-size")).toBe(size);
    expect(container.querySelector(".spec")).not.toBeNull();
  });

  it("size=sm (28px, burbuja) omite .spec — queda solo el reflejo del shell", () => {
    const { container } = render(<AlanOrb size="sm" />);
    expect(layers(container).orb!.getAttribute("data-size")).toBe("sm");
    expect(container.querySelector(".spec")).toBeNull();
    expect(container.querySelector(".shell")).not.toBeNull();
  });

  it("por defecto es md en reposo y decorativo (aria-hidden)", () => {
    const { container } = render(<AlanOrb />);
    const orb = layers(container).orb!;
    expect(orb.getAttribute("data-size")).toBe("md");
    expect(orb.getAttribute("data-state")).toBe("idle");
    expect(orb.getAttribute("aria-hidden")).toBe("true");
  });

  it("con aria-label pasa a role=img y deja de estar oculto", () => {
    const { container } = render(<AlanOrb aria-label="Alan" />);
    const orb = layers(container).orb!;
    expect(orb.getAttribute("role")).toBe("img");
    expect(orb.getAttribute("aria-hidden")).toBeNull();
  });
});

describe("AlanOrb — extras por estado", () => {
  it("reposo no tiene extras", () => {
    const { container } = render(<AlanOrb state="idle" />);
    expect(container.querySelector(".ripple, .sweep, .pulse, .pulse2")).toBeNull();
  });

  it("escucha agrega el anillo de onda", () => {
    const { container } = render(<AlanOrb state="listening" />);
    expect(container.querySelector(".ripple")).not.toBeNull();
    expect(layers(container).orb!.getAttribute("data-state")).toBe("listening");
  });

  it("piensa agrega la banda de luz dentro del vessel", () => {
    const { container } = render(<AlanOrb state="thinking" />);
    expect(container.querySelector(".vessel .sweep")).not.toBeNull();
  });

  it("ejecuta agrega los dos pulsos desfasados", () => {
    const { container } = render(<AlanOrb state="executing" />);
    expect(container.querySelector(".pulse")).not.toBeNull();
    expect(container.querySelector(".pulse2")).not.toBeNull();
  });

  it.each(["attention", "error"] as const)("%s no agrega extras (cambia solo variables CSS)", (state) => {
    const { container } = render(<AlanOrb state={state} />);
    expect(container.querySelector(".ripple, .sweep, .pulse, .pulse2")).toBeNull();
    expect(layers(container).orb!.getAttribute("data-state")).toBe(state);
  });

  it("cambiar el estado NO re-monta el componente: mismo nodo DOM, cambia data-state", () => {
    const { container, rerender } = render(<AlanOrb state="idle" />);
    const before = layers(container).orb;
    rerender(<AlanOrb state="thinking" />);
    const after = layers(container).orb;
    expect(after).toBe(before);
    expect(after!.getAttribute("data-state")).toBe("thinking");
    rerender(<AlanOrb state="executing" />);
    expect(layers(container).orb).toBe(before);
  });
});
