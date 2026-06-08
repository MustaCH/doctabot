import { describe, it, expect } from "vitest";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "./contact-avatar";

describe("getInitials", () => {
  it("toma las iniciales de nombre y apellido", () => {
    expect(getInitials("Ana Gómez")).toBe("AG");
  });
  it("usa una sola letra si hay un solo nombre", () => {
    expect(getInitials("Bruno")).toBe("B");
  });
  it("ignora espacios extra y toma las dos primeras palabras", () => {
    expect(getInitials("  María  José  Pérez ")).toBe("MJ");
  });
  it("devuelve '?' si el nombre está vacío", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});

describe("getAvatarColorIndex", () => {
  it("es determinístico para el mismo nombre", () => {
    expect(getAvatarColorIndex("Ana Gómez")).toBe(getAvatarColorIndex("Ana Gómez"));
  });
  it("devuelve un índice dentro de la paleta", () => {
    const idx = getAvatarColorIndex("Carla Díaz");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(AVATAR_COLORS.length);
  });
});
