import { describe, it, expect, vi } from "vitest";
import { jsonResponse, errorResponse, safeError } from "./http";

describe("jsonResponse", () => {
  it("setea status, content-type y CORS", async () => {
    const res = jsonResponse({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("errorResponse", () => {
  it("devuelve { error } con el status dado", async () => {
    const res = errorResponse("mal", 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "mal" });
  });
});

describe("safeError", () => {
  it("NO filtra el mensaje real y loguea server-side", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = safeError(new Error("DB password leaked"), "fn-x");
    expect(msg).toBe("Error interno del servidor");
    expect(msg).not.toContain("password");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
