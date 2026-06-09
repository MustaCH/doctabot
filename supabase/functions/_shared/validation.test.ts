import { describe, it, expect } from "vitest";
import {
  ValidationError,
  requireString,
  optionalString,
  requireUuid,
  requireNonEmptyArray,
} from "./validation";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("requireString", () => {
  it("devuelve el string trimeado", () => {
    expect(requireString("  hola  ", "campo")).toBe("hola");
  });
  it("lanza ValidationError si no es string o está vacío", () => {
    expect(() => requireString(undefined, "campo")).toThrow(ValidationError);
    expect(() => requireString("   ", "campo")).toThrow(ValidationError);
    expect(() => requireString(123, "campo")).toThrow(ValidationError);
  });
  it("lanza si excede maxLength", () => {
    expect(() => requireString("abcdef", "campo", { maxLength: 3 })).toThrow(ValidationError);
  });
});

describe("optionalString", () => {
  it("devuelve null si falta o es vacío", () => {
    expect(optionalString(undefined, "c")).toBeNull();
    expect(optionalString("", "c")).toBeNull();
    expect(optionalString(null, "c")).toBeNull();
  });
  it("valida tipo y largo cuando hay valor", () => {
    expect(optionalString("  x  ", "c")).toBe("x");
    expect(() => optionalString(5, "c")).toThrow(ValidationError);
    expect(() => optionalString("abcdef", "c", { maxLength: 3 })).toThrow(ValidationError);
  });
});

describe("requireUuid", () => {
  it("acepta un uuid válido", () => {
    expect(requireUuid(UUID, "id")).toBe(UUID);
  });
  it("rechaza no-uuid", () => {
    expect(() => requireUuid("nope", "id")).toThrow(ValidationError);
    expect(() => requireUuid(undefined, "id")).toThrow(ValidationError);
  });
});

describe("requireNonEmptyArray", () => {
  it("devuelve el array si tiene elementos", () => {
    expect(requireNonEmptyArray([1, 2], "arr")).toEqual([1, 2]);
  });
  it("rechaza no-array o vacío", () => {
    expect(() => requireNonEmptyArray([], "arr")).toThrow(ValidationError);
    expect(() => requireNonEmptyArray("x", "arr")).toThrow(ValidationError);
  });
  it("rechaza si supera maxItems", () => {
    expect(() => requireNonEmptyArray([1, 2, 3], "arr", { maxItems: 2 })).toThrow(ValidationError);
  });
});
