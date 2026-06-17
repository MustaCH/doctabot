import { describe, it, expect } from "vitest";
import { isOrchestratorCall, computeRunStatus, sliceSize, nextCursor, WORK_BUDGET, type Cursor } from "./batching";

describe("isOrchestratorCall", () => {
  it("body vacío / sin batchTimestamp → orchestrator (arranque de corrida)", () => {
    expect(isOrchestratorCall(undefined)).toBe(true);
    expect(isOrchestratorCall(null)).toBe(true);
    expect(isOrchestratorCall({})).toBe(true);
    expect(isOrchestratorCall({ foo: "bar" })).toBe(true);
    expect(isOrchestratorCall({ batchTimestamp: 123 })).toBe(true); // no-string → sigue siendo arranque
  });

  it("body con batchTimestamp string → worker (self-invoke de un lote)", () => {
    expect(isOrchestratorCall({ batchTimestamp: "2026-06-17T09:00:00.000Z" })).toBe(false);
    expect(isOrchestratorCall({ batchTimestamp: "x", userIdx: 2, phase: "buyer", offset: 100 })).toBe(false);
  });
});

describe("sliceSize", () => {
  it("acota el loop externo según el interno para no pasar el WORK_BUDGET", () => {
    expect(sliceSize(500)).toBe(Math.floor(WORK_BUDGET / 500)); // buyer phase con 500 props
    expect(sliceSize(WORK_BUDGET)).toBe(1);
    expect(sliceSize(WORK_BUDGET * 2)).toBe(1); // nunca baja de 1 (unidad mínima indivisible)
  });

  it("inner 0 o 1 → procesa un slice grande (no divide por cero)", () => {
    expect(sliceSize(0)).toBe(WORK_BUDGET);
    expect(sliceSize(1)).toBe(WORK_BUDGET);
  });
});

describe("nextCursor", () => {
  const base: Cursor = { userIdx: 0, phase: "buyer", offset: 0 };

  it("quedan elementos en la fase → mismo user/fase, offset avanza", () => {
    const r = nextCursor(base, 100, 250, 5);
    expect(r).toEqual({ done: false, userDone: false, userIdx: 0, phase: "buyer", offset: 100 });
  });

  it("se agota buyer → pasa a seller offset 0, mismo user, user NO terminó", () => {
    const r = nextCursor({ userIdx: 1, phase: "buyer", offset: 200 }, 100, 250, 5);
    expect(r).toEqual({ done: false, userDone: false, userIdx: 1, phase: "seller", offset: 0 });
  });

  it("se agota seller → siguiente user en buyer, userDone=true", () => {
    const r = nextCursor({ userIdx: 1, phase: "seller", offset: 0 }, 3, 3, 5);
    expect(r).toEqual({ done: false, userDone: true, userIdx: 2, phase: "buyer", offset: 0 });
  });

  it("se agota seller del último user → done, userDone=true", () => {
    const r = nextCursor({ userIdx: 4, phase: "seller", offset: 0 }, 2, 2, 5);
    expect(r).toEqual({ done: true, userDone: true });
  });

  it("buyer phase con outerTotal 0 (user sin buyers) → pasa directo a seller", () => {
    const r = nextCursor({ userIdx: 0, phase: "buyer", offset: 0 }, 0, 0, 3);
    expect(r).toEqual({ done: false, userDone: false, userIdx: 0, phase: "seller", offset: 0 });
  });
});

describe("computeRunStatus", () => {
  it("ninguno falló → success", () => {
    expect(computeRunStatus(10, 0, 10)).toBe("success");
  });
  it("algunos fallaron → partial", () => {
    expect(computeRunStatus(10, 3, 10)).toBe("partial");
  });
  it("todos los procesados fallaron → error", () => {
    expect(computeRunStatus(5, 5, 5)).toBe("error");
    expect(computeRunStatus(5, 6, 5)).toBe("error");
  });
  it("no se procesó ninguno pero había usuarios → error", () => {
    expect(computeRunStatus(0, 0, 12)).toBe("error");
  });
  it("no había usuarios → success (corrida vacía legítima)", () => {
    expect(computeRunStatus(0, 0, 0)).toBe("success");
  });
});
