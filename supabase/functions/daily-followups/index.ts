// daily-followups — Edge Function de proactividad (ticket 86aj9w5nt).
// Corre 1×/día vía pg_cron y convierte el CRM en un CRM que PERSIGUE: junta (a) tareas
// vencidas, (b) client_events próximos (0-3 días, respetando recurrence) y (c) clientes
// hot/warm sin seguimiento (hot 48h / warm 7d), y le deja al AGENTE un mensaje de Alan en
// una conversación "Seguimientos" + un push consolidado. NUNCA contacta clientes finales.
//
// Volumen bajo (pocas filas por usuario) → single-pass secuencial por usuario, sin el
// fan-out de morning-matches; el dedup vive en notified_followups (por ocurrencia para
// eventos, por cooldown para tareas/stale). Lógica pura en ./followups.ts (testeada).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { safeError } from "../_shared/http.ts";
import { reportEdgeErrorBg } from "../_shared/observability.ts";
import {
  overdueTasks,
  upcomingEvents,
  staleClients,
  staleThresholdHours,
  needsRenudge,
  buildNudges,
  buildFollowupsMessage,
  buildPushSummary,
  todayCordobaISO,
  TASK_RENUDGE_HOURS,
  type TaskRow,
  type EventRow,
  type ClientActivityRow,
  type NudgeItem,
} from "./followups.ts";

async function processUser(admin: any, userId: string, supabaseUrl: string, serviceKey: string): Promise<number> {
  const nowISO = new Date().toISOString();
  const todayISO = todayCordobaISO();

  const [{ data: taskRows }, { data: eventRows }, { data: clientRows }, { data: notifiedRows }] = await Promise.all([
    admin.from("client_notes")
      .select("id, client_id, content, is_action, is_done, due_at, clients(full_name)")
      .eq("user_id", userId).eq("is_action", true).eq("is_done", false)
      .not("due_at", "is", null).lte("due_at", nowISO).limit(50),
    admin.from("client_events")
      .select("id, client_id, title, event_type, event_date, recurrence, clients(full_name)")
      .eq("user_id", userId).limit(200),
    admin.from("clients")
      .select("id, full_name, status, is_client, last_contact_at, updated_at, created_at")
      .eq("user_id", userId).eq("is_client", true).in("status", ["hot", "warm"]).limit(500),
    admin.from("notified_followups")
      .select("kind, ref_id, occurrence, created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
  ]);

  // Último nudge por (kind, ref[, occurrence]) — las filas vienen desc, la primera gana.
  const lastNudge = new Map<string, string>();
  const eventOccurrences = new Set<string>();
  for (const r of (notifiedRows ?? []) as Array<{ kind: string; ref_id: string; occurrence: string; created_at: string }>) {
    if (r.kind === "event") eventOccurrences.add(`${r.ref_id}:${r.occurrence}`);
    const key = `${r.kind}:${r.ref_id}`;
    if (!lastNudge.has(key)) lastNudge.set(key, r.created_at);
  }

  const tasks = overdueTasks((taskRows ?? []) as TaskRow[], nowISO)
    .filter((t) => needsRenudge(lastNudge.get(`task:${t.id}`) ?? null, TASK_RENUDGE_HOURS, nowISO));
  const events = upcomingEvents((eventRows ?? []) as EventRow[], todayISO)
    .filter((ev) => !eventOccurrences.has(`${ev.id}:${ev.next_occurrence}`));
  const stale = staleClients((clientRows ?? []) as ClientActivityRow[], nowISO)
    .filter((c) => needsRenudge(lastNudge.get(`stale:${c.id}`) ?? null, staleThresholdHours(c.status) ?? Infinity, nowISO));

  const { items, extraLines } = buildNudges({ tasks, events, stale, todayISO });
  const message = buildFollowupsMessage(items, extraLines);
  if (!message) return 0;

  // Una conversación "Seguimientos" por usuario (se reusa entre corridas).
  const { data: existingConv } = await admin
    .from("conversations").select("id")
    .eq("user_id", userId).eq("conversation_type", "daily_followups")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  let convId: string;
  if (existingConv) {
    convId = existingConv.id;
  } else {
    const { data: newConv, error: convErr } = await admin
      .from("conversations")
      .insert({ user_id: userId, title: "📋 Seguimientos", conversation_type: "daily_followups" })
      .select("id").single();
    if (convErr || !newConv) { console.error(`daily-followups: no pude crear conversación para ${userId}:`, convErr); return 0; }
    convId = newConv.id;
  }

  await admin.from("messages").insert({ conversation_id: convId, role: "assistant", content: message });
  await admin.from("conversations").update({ updated_at: nowISO }).eq("id", convId);

  // Registrar el dedup DESPUÉS de persistir el mensaje (si algo falla antes, se reintenta
  // mañana). Es un LOG histórico (insert plano, sin unique): los eventos dedupean leyendo
  // (ref, occurrence) y tareas/stale renuevan su cooldown con cada fila nueva.
  const { error: logErr } = await admin.from("notified_followups").insert(
    items.map((i) => ({ user_id: userId, kind: i.kind, ref_id: i.refId, occurrence: i.occurrence })),
  );
  if (logErr) console.error(`daily-followups: registro de dedup falló para ${userId}:`, logErr);

  const push = buildPushSummary(items);
  if (push) {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, title: push.title, body: push.body, url: `/?c=${convId}` }),
      });
    } catch (pushErr) {
      console.error(`daily-followups: push falló para ${userId}:`, pushErr);
    }
  }
  return items.length;
}

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRows } = await admin.from("clients").select("user_id").eq("is_client", true);
    const userIds = [...new Set(((userRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].sort();

    let usersNudged = 0;
    let totalNudges = 0;
    for (const userId of userIds) {
      try {
        const n = await processUser(admin, userId, supabaseUrl, serviceKey);
        if (n > 0) { usersNudged += 1; totalNudges += n; }
      } catch (userErr) {
        console.error(`daily-followups: user ${userId} falló:`, userErr);
        reportEdgeErrorBg({ context: "daily-followups", error: userErr });
      }
    }

    console.log(`daily-followups: ${userIds.length} usuarios, ${usersNudged} con nudges (${totalNudges} items)`);
    return new Response(JSON.stringify({ users: userIds.length, users_nudged: usersNudged, nudges: totalNudges }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    reportEdgeErrorBg({ context: "daily-followups", error: err });
    return safeError(err);
  }
});
