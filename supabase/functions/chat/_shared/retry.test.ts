import { describe, it, expect, vi } from "vitest";
import { fetchWithRetry } from "./retry";

const resp = (status = 200) => ({ status, ok: status < 400 } as Response);
const noSleep = async () => {};

describe("fetchWithRetry", () => {
  it("devuelve la primera respuesta exitosa sin reintentar", async () => {
    const doFetch = vi.fn(async () => resp(200));
    const res = await fetchWithRetry(doFetch, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("reintenta un 503 y devuelve el 200 siguiente", async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(200));
    const res = await fetchWithRetry(doFetch, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("reintenta un 429", async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(resp(429)).mockResolvedValueOnce(resp(200));
    const res = await fetchWithRetry(doFetch, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("NO reintenta un 402 (no transitorio): lo devuelve de una", async () => {
    const doFetch = vi.fn(async () => resp(402));
    const res = await fetchWithRetry(doFetch, { sleep: noSleep });
    expect(res.status).toBe(402);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("agota los intentos con 5xx persistente y devuelve el último Response", async () => {
    const doFetch = vi.fn(async () => resp(500));
    const res = await fetchWithRetry(doFetch, { attempts: 3, sleep: noSleep });
    expect(res.status).toBe(500);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it("reintenta un throw de red y propaga si se agotan los intentos", async () => {
    const doFetch = vi.fn(async () => { throw new Error("network"); });
    await expect(fetchWithRetry(doFetch, { attempts: 2, sleep: noSleep })).rejects.toThrow("network");
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("recupera de un throw transitorio seguido de éxito", async () => {
    const doFetch = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(resp(200));
    const res = await fetchWithRetry(doFetch, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});
