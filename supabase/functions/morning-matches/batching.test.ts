import { describe, it, expect } from "vitest";
import { isOrchestratorCall, computeRunStatus } from "./batching";

describe("isOrchestratorCall", () => {
  it("body vacío / sin batchTimestamp → orchestrator (arranque de corrida)", () => {
    expect(isOrchestratorCall(undefined)).toBe(true);
    expect(isOrchestratorCall(null)).toBe(true);
    expect(isOrchestratorCall({})).toBe(true);
    expect(isOrchestratorCall({ foo: "bar" })).toBe(true);
    // el cron puede mandar cualquier cosa que no sea un batchTimestamp string → sigue arrancando corrida
    expect(isOrchestratorCall({ batchTimestamp: 123 })).toBe(true);
  });

  it("body con batchTimestamp string → worker (self-invoke de un lote)", () => {
    expect(isOrchestratorCall({ batchTimestamp: "2026-06-17T09:00:00.000Z" })).toBe(false);
    expect(isOrchestratorCall({ batchTimestamp: "x", afterUserId: "u1" })).toBe(false);
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
    expect(computeRunStatus(5, 6, 5)).toBe("error"); // defensivo: errors > processed
  });

  it("no se procesó ninguno pero había usuarios → error (algo cortó antes)", () => {
    expect(computeRunStatus(0, 0, 12)).toBe("error");
  });

  it("no había usuarios para procesar → success (corrida vacía legítima)", () => {
    expect(computeRunStatus(0, 0, 0)).toBe("success");
  });
});
