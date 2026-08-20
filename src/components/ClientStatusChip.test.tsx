// Frontend — Estados de cliente sin emoji: punto de color + etiqueta (ticket 86ak3kddg).
// Los enums de DB siguen siendo hot|warm|cold; esto es solo presentación.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ClientStatusChip } from "@/components/ClientStatusChip";
import { CLIENT_STATUS_META, clientStatusLabel } from "@/lib/client-status";

afterEach(cleanup);

const EMOJI = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

describe("ClientStatusChip", () => {
  it.each([
    ["hot", "Caliente", "#FF5A4D", "#FF9086", "rgba(255,90,77,0.16)"],
    ["warm", "Tibio", "#F5B23F", "#F5C46E", "rgba(245,178,63,0.16)"],
    ["cold", "Frío", "#4FC3E8", "#82D5F0", "rgba(79,195,232,0.16)"],
  ] as const)("%s → punto %s + etiqueta %s, sin emoji", (status, label, dot, text, bg) => {
    const { container } = render(<ClientStatusChip status={status} />);
    const chip = container.querySelector('[data-testid="client-status-chip"]') as HTMLElement;
    expect(chip.textContent).toBe(label);
    expect(chip.textContent).not.toMatch(EMOJI);
    expect(chip.style.color).toBeTruthy();
    const dotEl = chip.querySelector("span[aria-hidden]") as HTMLElement;
    expect(dotEl).not.toBeNull();
    // los valores exactos de la paleta viven en el meta compartido
    expect(CLIENT_STATUS_META[status].dot).toBe(dot);
    expect(CLIENT_STATUS_META[status].text).toBe(text);
    expect(CLIENT_STATUS_META[status].bg).toBe(bg);
  });

  it("status inválido no renderiza chip", () => {
    const { container } = render(<ClientStatusChip status="prospect" />);
    expect(container.querySelector('[data-testid="client-status-chip"]')).toBeNull();
  });

  it("clientStatusLabel devuelve etiquetas sin emoji y el crudo para desconocidos", () => {
    expect(clientStatusLabel("hot")).toBe("Caliente");
    expect(clientStatusLabel("warm")).toBe("Tibio");
    expect(clientStatusLabel("cold")).toBe("Frío");
    expect(clientStatusLabel("otro")).toBe("otro");
    expect(clientStatusLabel(null)).toBe("—");
  });
});
