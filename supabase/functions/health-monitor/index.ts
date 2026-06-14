// health-monitor — heartbeat de uptime + detección de fallos silenciosos.
// Ticket 86aj18r6x. Lo dispara pg_cron cada ~10 min (ver migración
// 20260614120100_health_monitor_cron.sql). Corre varios checks y, si alguno falla,
// postea UNA alerta consolidada a N8N_WEBHOOK_URL (canal que Nacho mira).
//
// LIMITACIÓN CONOCIDA: corre dentro de Supabase, así que si el proyecto Supabase
// entero está caído, el cron tampoco corre y este monitor no alerta. Cubre los
// fallos app-level reales (front caído, chat roto, scraper/matches sin correr,
// spike de errores), que son la gran mayoría. Para "Supabase 100% down" haría
// falta un pinger externo (ver infra.md → Observabilidad, opción futura).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";

type Check = { name: string; ok: boolean; detail: string };

const FRONT_URL = Deno.env.get("HEALTH_FRONT_URL") ?? "https://chat.doctabot.online";
const ERROR_SPIKE_THRESHOLD = Number(Deno.env.get("HEALTH_ERROR_SPIKE") ?? "10"); // errores en 15 min
const SCRAPER_MAX_AGE_H = 26; // el scraper corre 00:30 Córdoba → max ~26h entre corridas

async function pingHttp(name: string, url: string, method: "GET" | "OPTIONS"): Promise<Check> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, { method, signal: ctrl.signal });
    clearTimeout(t);
    // <500 = el servicio responde (incluso 401/404 significa "está vivo").
    const ok = res.status < 500;
    return { name, ok, detail: `${method} ${url} → ${res.status}` };
  } catch (err) {
    return { name, ok: false, detail: `${method} ${url} → ${err instanceof Error ? err.message : String(err)}` };
  }
}

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const checks: Check[] = [];

  // 1. Front (PWA) responde.
  checks.push(await pingHttp("frontend", FRONT_URL, "GET"));

  // 2. Endpoint chat responde al preflight (CORS).
  checks.push(await pingHttp("chat", `${supabaseUrl}/functions/v1/chat`, "OPTIONS"));

  // 3. Spike de errores en los últimos 15 min (error_logs).
  try {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count, error } = await admin
      .from("error_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) throw error;
    const n = count ?? 0;
    checks.push({
      name: "error_spike",
      ok: n < ERROR_SPIKE_THRESHOLD,
      detail: `${n} errores en 15 min (umbral ${ERROR_SPIKE_THRESHOLD})`,
    });
  } catch (err) {
    checks.push({ name: "error_spike", ok: false, detail: `query falló: ${err instanceof Error ? err.message : String(err)}` });
  }

  // 4. Frescura del scraper (última fila en scraping_logs).
  try {
    const { data, error } = await admin
      .from("scraping_logs")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      checks.push({ name: "scraper_freshness", ok: false, detail: "sin filas en scraping_logs" });
    } else {
      const ageH = (Date.now() - new Date(data.created_at).getTime()) / 3_600_000;
      checks.push({
        name: "scraper_freshness",
        ok: ageH <= SCRAPER_MAX_AGE_H,
        detail: `última corrida hace ${ageH.toFixed(1)}h (máx ${SCRAPER_MAX_AGE_H}h)`,
      });
    }
  } catch (err) {
    checks.push({ name: "scraper_freshness", ok: false, detail: `query falló: ${err instanceof Error ? err.message : String(err)}` });
  }

  // 5. morning-matches: después de las 12:30 UTC (corre 12:00) debería haber generado
  //    matches hoy SI hubo propiedades nuevas. 0 matches con props nuevas = corrió mal
  //    (justo el fallo silencioso 546 del ticket 86aj18qz6).
  try {
    const now = new Date();
    const hourUtc = now.getUTCHours() + now.getUTCMinutes() / 60;
    if (hourUtc >= 12.5) {
      const todayStart = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
      const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [matchesRes, propsRes] = await Promise.all([
        admin.from("notified_matches").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
        admin.from("properties").select("*", { count: "exact", head: true }).gte("last_seen_at", since24),
      ]);
      const matches = matchesRes.count ?? 0;
      const props = propsRes.count ?? 0;
      const ok = matches > 0 || props === 0; // sin props nuevas no se esperan matches
      checks.push({
        name: "morning_matches",
        ok,
        detail: `${matches} matches hoy · ${props} props nuevas 24h`,
      });
    } else {
      checks.push({ name: "morning_matches", ok: true, detail: "antes de 12:30 UTC — no aplica" });
    }
  } catch (err) {
    checks.push({ name: "morning_matches", ok: false, detail: `query falló: ${err instanceof Error ? err.message : String(err)}` });
  }

  const failing = checks.filter((c) => !c.ok);

  // Alerta consolidada a n8n solo si hay algo roto.
  if (failing.length > 0) {
    const n8nUrl = Deno.env.get("N8N_WEBHOOK_URL");
    if (n8nUrl) {
      await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "uptime_alert",
          failing: failing.map((c) => ({ check: c.name, detail: c.detail })),
          timestamp: new Date().toISOString(),
        }),
      }).catch((err) => console.error("[health-monitor] n8n alert falló:", err));
    }
    console.error("[health-monitor] checks fallando:", JSON.stringify(failing));
  }

  return jsonResponse({
    ok: failing.length === 0,
    checked_at: new Date().toISOString(),
    checks,
  });
});
