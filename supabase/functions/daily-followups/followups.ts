// Lógica pura de daily-followups (ticket 86aj9w5nt) — extraída para unit-testearla
// (followups.test.ts), mismo criterio que morning-matches/matching.ts.
//
// Tres fuentes de nudges (Alan → AGENTE, nunca a clientes):
//  (a) tareas vencidas: client_notes con is_action, sin is_done y due_at <= ahora;
//  (b) client_events cuya próxima ocurrencia (respetando recurrence) cae en 0-3 días;
//  (c) clientes hot/warm sin actividad: hot > 48h, warm > 7 días.
//
// Dedup (tabla notified_followups): los eventos se notifican UNA vez por ocurrencia
// (occurrence = fecha de la ocurrencia); tareas y clientes-fríos usan cooldown — se
// re-nudgean solo si el último nudge es más viejo que su cadencia.

// Helpers de fecha compartidos con el chat (fuente única — no duplicar cálculos de TZ).
import { nextOccurrenceISO, todayCordobaISO, addDaysISO } from "../chat/_shared/tools/validators.ts";

export interface TaskRow {
  id: string;
  client_id: string;
  content: string;
  is_action: boolean;
  is_done: boolean;
  due_at: string | null; // timestamptz ISO
  clients?: { full_name: string | null } | null;
}

export interface EventRow {
  id: string;
  client_id: string;
  title: string;
  event_type?: string | null;
  event_date: string; // YYYY-MM-DD
  recurrence: string; // once | yearly | monthly
  clients?: { full_name: string | null } | null;
}

export interface ClientActivityRow {
  id: string;
  full_name: string;
  status: string | null; // hot | warm | cold
  is_client: boolean;
  last_contact_at: string | null;
  updated_at: string | null;
  created_at: string | null;
}

export interface NudgeItem {
  kind: "task" | "event" | "stale";
  refId: string;
  clientName: string;
  line: string;
  /** Clave de ocurrencia para el dedup: fecha de la ocurrencia (events) o "" (cooldown). */
  occurrence: string;
}

export const EVENT_WINDOW_DAYS = 3;
export const TASK_RENUDGE_HOURS = 72;
// Tope de items POR TIPO en el mensaje diario: la primera corrida sobre una cartera vieja
// puede encontrar cientos de clientes "sin seguimiento" (pasó en el smoke: 500) y un volcado
// completo es ruido inusable. Los que exceden el tope NO se loguean en notified_followups,
// así rotan naturalmente en las corridas siguientes (los nudgeados entran en cooldown).
export const MAX_TASK_NUDGES = 10;
export const MAX_STALE_NUDGES = 10;

/** Cadencia por temperatura (AC): hot 48h, warm 7 días. Cold no se nudgea. */
export function staleThresholdHours(status: string | null | undefined): number | null {
  if (status === "hot") return 48;
  if (status === "warm") return 24 * 7;
  return null;
}

const hoursSince = (iso: string, nowMs: number): number => (nowMs - new Date(iso).getTime()) / 3_600_000;

/** (a) Tareas accionables vencidas (due_at en el pasado, no completadas). */
export function overdueTasks(tasks: TaskRow[], nowISO: string): TaskRow[] {
  const nowMs = new Date(nowISO).getTime();
  return tasks.filter((t) => t.is_action && !t.is_done && t.due_at != null && new Date(t.due_at).getTime() <= nowMs);
}

/** (b) Eventos cuya próxima ocurrencia (respetando recurrence) cae dentro de la ventana. */
export function upcomingEvents(events: EventRow[], todayISO: string, windowDays: number = EVENT_WINDOW_DAYS): Array<EventRow & { next_occurrence: string }> {
  const cutoff = addDaysISO(todayISO, windowDays);
  return events
    .map((ev) => ({ ...ev, next_occurrence: nextOccurrenceISO(ev.event_date, ev.recurrence, todayISO) }))
    .filter((ev) => ev.next_occurrence >= todayISO && ev.next_occurrence <= cutoff)
    .sort((a, b) => a.next_occurrence.localeCompare(b.next_occurrence));
}

/** (c) Clientes hot/warm sin actividad más allá de su cadencia. Actividad = last_contact_at
 *  (señal real de contacto), con fallback a updated_at/created_at para clientes nunca contactados. */
export function staleClients(clients: ClientActivityRow[], nowISO: string): Array<ClientActivityRow & { hours_stale: number }> {
  const nowMs = new Date(nowISO).getTime();
  const out: Array<ClientActivityRow & { hours_stale: number }> = [];
  for (const c of clients) {
    if (!c.is_client) continue;
    const threshold = staleThresholdHours(c.status);
    if (threshold == null) continue;
    const lastActivity = c.last_contact_at ?? c.updated_at ?? c.created_at;
    if (!lastActivity) continue;
    const stale = hoursSince(lastActivity, nowMs);
    if (stale > threshold) out.push({ ...c, hours_stale: stale });
  }
  // Los más urgentes primero: hot antes que warm, y dentro del grupo el más abandonado.
  return out.sort((a, b) => (a.status === b.status ? b.hours_stale - a.hours_stale : a.status === "hot" ? -1 : 1));
}

/** ¿Corresponde re-nudgear algo con cooldown? (tareas y clientes-fríos; los eventos
 *  dedupean por ocurrencia y no pasan por acá). */
export function needsRenudge(lastNudgeISO: string | null, cooldownHours: number, nowISO: string): boolean {
  if (!lastNudgeISO) return true;
  return hoursSince(lastNudgeISO, new Date(nowISO).getTime()) >= cooldownHours;
}

const dayLabel = (dateISO: string, todayISO: string): string => {
  if (dateISO === todayISO) return "HOY";
  if (dateISO === addDaysISO(todayISO, 1)) return "mañana";
  return dateISO;
};

/** Arma los NudgeItem de un usuario a partir de las tres fuentes ya filtradas, con tope por
 *  tipo. `extraLines` resume lo que quedó afuera ("…y N más") — va al mensaje pero NO al log
 *  de dedup (los omitidos rotan en corridas siguientes). */
export function buildNudges(params: {
  tasks: TaskRow[];
  events: Array<EventRow & { next_occurrence: string }>;
  stale: Array<ClientActivityRow & { hours_stale: number }>;
  todayISO: string;
}): { items: NudgeItem[]; extraLines: string[] } {
  const { tasks, events, stale, todayISO } = params;
  const items: NudgeItem[] = [];
  const extraLines: string[] = [];
  for (const t of tasks.slice(0, MAX_TASK_NUDGES)) {
    const name = t.clients?.full_name ?? "un cliente";
    items.push({ kind: "task", refId: t.id, clientName: name, occurrence: "", line: `⏰ **Tarea vencida** (${name}): ${t.content.slice(0, 140)}` });
  }
  if (tasks.length > MAX_TASK_NUDGES) {
    extraLines.push(`_…y ${tasks.length - MAX_TASK_NUDGES} tarea${tasks.length - MAX_TASK_NUDGES > 1 ? "s" : ""} vencida${tasks.length - MAX_TASK_NUDGES > 1 ? "s" : ""} más (mañana sigo con esas)._`);
  }
  for (const ev of events) {
    const name = ev.clients?.full_name ?? "un cliente";
    items.push({ kind: "event", refId: ev.id, clientName: name, occurrence: ev.next_occurrence, line: `📅 **${ev.title}** de ${name}: ${dayLabel(ev.next_occurrence, todayISO)}` });
  }
  for (const c of stale.slice(0, MAX_STALE_NUDGES)) {
    const days = Math.floor(c.hours_stale / 24);
    const ago = days >= 1 ? `${days} día${days > 1 ? "s" : ""}` : `${Math.floor(c.hours_stale)}h`;
    const label = c.status === "hot" ? "🔥 Cliente HOT sin seguimiento" : "🌡️ Cliente warm sin seguimiento";
    items.push({ kind: "stale", refId: c.id, clientName: c.full_name, occurrence: "", line: `${label}: **${c.full_name}** (último contacto hace ${ago})` });
  }
  if (stale.length > MAX_STALE_NUDGES) {
    extraLines.push(`_…y ${stale.length - MAX_STALE_NUDGES} cliente${stale.length - MAX_STALE_NUDGES > 1 ? "s" : ""} más sin seguimiento (van rotando en los próximos días)._`);
  }
  return { items, extraLines };
}

/** Mensaje del día (Alan → agente). Devuelve null si no hay nudges. */
export function buildFollowupsMessage(items: NudgeItem[], extraLines: string[] = []): string | null {
  if (items.length === 0) return null;
  const lines: string[] = ["📋 **Seguimientos de hoy**\n"];
  const tasks = items.filter((i) => i.kind === "task");
  const events = items.filter((i) => i.kind === "event");
  const stale = items.filter((i) => i.kind === "stale");
  if (tasks.length) lines.push(...tasks.map((i) => i.line), "");
  if (events.length) lines.push(...events.map((i) => i.line), "");
  if (stale.length) lines.push(...stale.map((i) => i.line), "");
  if (extraLines.length) lines.push(...extraLines, "");
  lines.push("¿Querés que te prepare un mensaje para alguno de estos seguimientos?");
  return lines.join("\n");
}

/** Título del push consolidado. */
export function buildPushSummary(items: NudgeItem[]): { title: string; body: string } | null {
  if (items.length === 0) return null;
  const counts: string[] = [];
  const tasks = items.filter((i) => i.kind === "task").length;
  const events = items.filter((i) => i.kind === "event").length;
  const stale = items.filter((i) => i.kind === "stale").length;
  if (tasks) counts.push(`${tasks} tarea${tasks > 1 ? "s" : ""} vencida${tasks > 1 ? "s" : ""}`);
  if (events) counts.push(`${events} evento${events > 1 ? "s" : ""} próximo${events > 1 ? "s" : ""}`);
  if (stale) counts.push(`${stale} cliente${stale > 1 ? "s" : ""} sin seguimiento`);
  return { title: "📋 Seguimientos de hoy", body: counts.join(" · ") };
}

export { todayCordobaISO, addDaysISO, nextOccurrenceISO };
