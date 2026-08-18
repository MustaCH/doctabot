// Tests del ticket 86aj9w5kh: los fetch de Google Calendar van con try/catch propio.
// Un throw de red en una ESCRITURA debe devolver "estado desconocido, verificá" (no el
// catch genérico que invita a reintentar a ciegas → evento duplicado); en una LECTURA,
// un mensaje de reintento simple.
import { describe, it, expect, afterEach, vi } from "vitest";
import { executeTool } from "./executor";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function ctxWithToken() {
  return {
    supabase: { from: () => { throw new Error("no DB en este test"); } },
    userId: "u1",
    conversationId: "c1",
    getCalendarToken: async () => "tok-123",
    cardResults: [] as unknown[],
  } as never;
}

function failFetch() {
  globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("network down")) as typeof fetch;
}

describe("fetch de Calendar con error de red (86aj9w5kh)", () => {
  it("create_calendar_event → estado desconocido + verificar, sin throw", async () => {
    failFetch();
    const out = JSON.parse(await executeTool("create_calendar_event", { summary: "Visita", start_datetime: "2026-08-20T15:00" }, ctxWithToken()));
    expect(out.error).toMatch(/estado desconocido/);
    expect(out.error).toMatch(/[Vv]erific/);
  });

  it("create_meet_event → estado desconocido + verificar, sin throw", async () => {
    failFetch();
    const out = JSON.parse(await executeTool("create_meet_event", { summary: "Reunión", start_datetime: "2026-08-20T15:00" }, ctxWithToken()));
    expect(out.error).toMatch(/estado desconocido/);
  });

  it("list_calendar_events (lectura) → mensaje de reintento simple, sin throw", async () => {
    failFetch();
    const out = JSON.parse(await executeTool("list_calendar_events", {}, ctxWithToken()));
    expect(out.error).toMatch(/[Rr]eintent/);
    expect(out.error).not.toMatch(/estado desconocido/);
  });

  it("update_calendar_event con red caída en el GET → reintento simple", async () => {
    failFetch();
    const out = JSON.parse(await executeTool("update_calendar_event", { event_id: "ev1", summary: "Nuevo" }, ctxWithToken()));
    expect(out.error).toMatch(/[Rr]eintent/);
  });

  it("update_calendar_event con red caída en el PATCH (GET ok) → estado desconocido", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ev1" }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError("network down")) as typeof fetch;
    const out = JSON.parse(await executeTool("update_calendar_event", { event_id: "ev1", summary: "Nuevo" }, ctxWithToken()));
    expect(out.error).toMatch(/estado desconocido/);
  });
});
