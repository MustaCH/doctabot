// Tests de la lógica pura de daily-followups (ticket 86aj9w5nt).
import { describe, it, expect } from "vitest";
import {
  overdueTasks,
  upcomingEvents,
  staleClients,
  staleThresholdHours,
  needsRenudge,
  buildNudges,
  buildFollowupsMessage,
  buildPushSummary,
  TASK_RENUDGE_HOURS,
  type TaskRow,
  type EventRow,
  type ClientActivityRow,
} from "./followups";

const NOW = "2026-08-18T12:00:00.000Z";
const TODAY = "2026-08-18";

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: "t1", client_id: "c1", content: "Llamar", is_action: true, is_done: false, due_at: "2026-08-17T10:00:00Z",
  clients: { full_name: "Ana" }, ...over,
});

describe("overdueTasks", () => {
  it("solo tareas accionables, no hechas y con due_at vencido", () => {
    const rows = [
      task({ id: "vencida" }),
      task({ id: "futura", due_at: "2026-08-20T10:00:00Z" }),
      task({ id: "sin-due", due_at: null }),
      task({ id: "hecha", is_done: true }),
      task({ id: "nota", is_action: false }),
    ];
    expect(overdueTasks(rows, NOW).map((t) => t.id)).toEqual(["vencida"]);
  });
});

describe("upcomingEvents", () => {
  const ev = (over: Partial<EventRow>): EventRow => ({
    id: "e1", client_id: "c1", title: "Cumpleaños", event_date: "1980-08-20", recurrence: "yearly",
    clients: { full_name: "Marta" }, ...over,
  });

  it("recurrence yearly: la ocurrencia de ESTE año entra en la ventana 0-3 días", () => {
    const out = upcomingEvents([ev({})], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].next_occurrence).toBe("2026-08-20");
  });

  it("eventos fuera de la ventana o pasados (once) quedan afuera", () => {
    const out = upcomingEvents([
      ev({ id: "lejano", event_date: "1980-09-15" }),
      ev({ id: "pasado-once", event_date: "2026-08-10", recurrence: "once" }),
      ev({ id: "hoy-once", event_date: "2026-08-18", recurrence: "once" }),
    ], TODAY);
    expect(out.map((e) => e.id)).toEqual(["hoy-once"]);
  });

  it("ordena por próxima ocurrencia ascendente", () => {
    const out = upcomingEvents([
      ev({ id: "en3", event_date: "1990-08-21" }),
      ev({ id: "hoy", event_date: "1990-08-18" }),
    ], TODAY);
    expect(out.map((e) => e.id)).toEqual(["hoy", "en3"]);
  });
});

describe("staleClients", () => {
  const cli = (over: Partial<ClientActivityRow>): ClientActivityRow => ({
    id: "c1", full_name: "Ana", status: "hot", is_client: true,
    last_contact_at: null, updated_at: null, created_at: "2026-08-01T00:00:00Z", ...over,
  });

  it("hot > 48h y warm > 7d son stale; cold y no-clientes nunca", () => {
    const rows = [
      cli({ id: "hot-stale", status: "hot", last_contact_at: "2026-08-15T00:00:00Z" }),   // 3.5 días
      cli({ id: "hot-fresco", status: "hot", last_contact_at: "2026-08-17T13:00:00Z" }),  // 23h
      cli({ id: "warm-stale", status: "warm", last_contact_at: "2026-08-01T00:00:00Z" }), // 17 días
      cli({ id: "warm-fresco", status: "warm", last_contact_at: "2026-08-14T00:00:00Z" }),// 4.5 días
      cli({ id: "cold", status: "cold", last_contact_at: "2026-01-01T00:00:00Z" }),
      cli({ id: "contacto", is_client: false, last_contact_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(staleClients(rows, NOW).map((c) => c.id)).toEqual(["hot-stale", "warm-stale"]);
  });

  it("sin last_contact_at usa updated_at/created_at como actividad", () => {
    const out = staleClients([cli({ id: "nunca", status: "hot", created_at: "2026-08-10T00:00:00Z" })], NOW);
    expect(out.map((c) => c.id)).toEqual(["nunca"]);
  });

  it("hot ordena antes que warm, y dentro del grupo el más abandonado primero", () => {
    const out = staleClients([
      cli({ id: "warm-viejo", status: "warm", last_contact_at: "2026-07-01T00:00:00Z" }),
      cli({ id: "hot-1", status: "hot", last_contact_at: "2026-08-14T00:00:00Z" }),
      cli({ id: "hot-2", status: "hot", last_contact_at: "2026-08-10T00:00:00Z" }),
    ], NOW);
    expect(out.map((c) => c.id)).toEqual(["hot-2", "hot-1", "warm-viejo"]);
  });
});

describe("needsRenudge (cooldowns)", () => {
  it("sin nudge previo → true; nudge fresco → false; nudge viejo → true", () => {
    expect(needsRenudge(null, TASK_RENUDGE_HOURS, NOW)).toBe(true);
    expect(needsRenudge("2026-08-17T12:00:00Z", TASK_RENUDGE_HOURS, NOW)).toBe(false); // 24h < 72h
    expect(needsRenudge("2026-08-14T12:00:00Z", TASK_RENUDGE_HOURS, NOW)).toBe(true);  // 96h ≥ 72h
  });

  it("cadencia por temperatura: hot 48h, warm 7d, cold sin cadencia", () => {
    expect(staleThresholdHours("hot")).toBe(48);
    expect(staleThresholdHours("warm")).toBe(168);
    expect(staleThresholdHours("cold")).toBeNull();
    expect(staleThresholdHours(null)).toBeNull();
  });
});

describe("mensaje y push", () => {
  it("buildNudges + buildFollowupsMessage arman las tres secciones", () => {
    const { items, extraLines } = buildNudges({
      tasks: [task({})],
      events: upcomingEvents([{ id: "e1", client_id: "c1", title: "Cumpleaños", event_date: "1980-08-19", recurrence: "yearly", clients: { full_name: "Marta" } }], TODAY),
      stale: staleClients([{ id: "s1", full_name: "Pepe Frío", status: "hot", is_client: true, last_contact_at: "2026-08-10T00:00:00Z", updated_at: null, created_at: null }], NOW),
      todayISO: TODAY,
    });
    const msg = buildFollowupsMessage(items, extraLines)!;
    expect(msg).toContain("Seguimientos de hoy");
    expect(msg).toContain("Tarea vencida");
    expect(msg).toContain("Cumpleaños");
    expect(msg).toContain("mañana"); // 19/08 vs hoy 18/08
    expect(msg).toContain("Pepe Frío");
    expect(msg).toMatch(/¿Querés que te prepare/);
    expect(extraLines).toEqual([]);
  });

  it("sin nudges → mensaje y push null (no se molesta al agente)", () => {
    expect(buildFollowupsMessage([])).toBeNull();
    expect(buildPushSummary([])).toBeNull();
  });

  it("el push consolida conteos por tipo", () => {
    const { items } = buildNudges({
      tasks: [task({ id: "a" }), task({ id: "b" })],
      events: [],
      stale: staleClients([{ id: "s1", full_name: "Pepe", status: "hot", is_client: true, last_contact_at: "2026-08-10T00:00:00Z", updated_at: null, created_at: null }], NOW),
      todayISO: TODAY,
    });
    const push = buildPushSummary(items)!;
    expect(push.body).toContain("2 tareas vencidas");
    expect(push.body).toContain("1 cliente sin seguimiento");
  });

  // Regresión del smoke real (2026-08-18): 500 clientes stale en la primera corrida
  // volcaban un mensaje inusable. Tope por tipo + "…y N más"; los omitidos NO se loguean.
  it("cap por tipo: con 500 stale solo entran MAX_STALE_NUDGES items y el resto va en extraLines", () => {
    const manyStale = Array.from({ length: 500 }, (_, i) => ({
      id: `s${i}`, full_name: `Cliente ${i}`, status: "hot", is_client: true,
      last_contact_at: "2026-08-01T00:00:00Z", updated_at: null, created_at: null,
    }));
    const { items, extraLines } = buildNudges({
      tasks: Array.from({ length: 30 }, (_, i) => task({ id: `t${i}` })),
      events: [],
      stale: staleClients(manyStale, NOW),
      todayISO: TODAY,
    });
    expect(items.filter((i) => i.kind === "stale")).toHaveLength(10);
    expect(items.filter((i) => i.kind === "task")).toHaveLength(10);
    expect(extraLines.some((l) => l.includes("490 clientes más"))).toBe(true);
    expect(extraLines.some((l) => l.includes("20 tareas"))).toBe(true);
    const msg = buildFollowupsMessage(items, extraLines)!;
    expect(msg.split("\n").length).toBeLessThan(40); // mensaje acotado, no un volcado de 500 líneas
  });
});
