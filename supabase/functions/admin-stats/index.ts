import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_PIN = "7742";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { pin, action, page, pageSize, search, conversationId, userId } = body;

    if (pin !== ADMIN_PIN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const pg = page ?? 0;
    const ps = pageSize ?? 25;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ---------- STATS ----------
    if (action === "stats") {
      const [props, profiles, convs, msgs, favs, clients] = await Promise.all([
        supabaseAdmin.from("properties").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("conversations").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("messages").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("favorites").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("clients").select("id", { count: "exact", head: true }),
      ]);
      return json({
        properties: props.count ?? 0,
        users: profiles.count ?? 0,
        conversations: convs.count ?? 0,
        messages: msgs.count ?? 0,
        favorites: favs.count ?? 0,
        clients: clients.count ?? 0,
      });
    }

    // ---------- TIME STATS (last 30 days) ----------
    if (action === "time-stats") {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceISO = since.toISOString();

      const [usersRes, msgsRes, convsRes, propsRes] = await Promise.all([
        supabaseAdmin.from("profiles").select("created_at").gte("created_at", sinceISO),
        supabaseAdmin.from("messages").select("created_at").gte("created_at", sinceISO),
        supabaseAdmin.from("conversations").select("created_at").gte("created_at", sinceISO),
        supabaseAdmin.from("properties").select("created_at").gte("created_at", sinceISO),
      ]);

      const bucket = (rows: { created_at: string }[] | null) => {
        const map: Record<string, number> = {};
        (rows ?? []).forEach((r) => {
          const d = r.created_at.slice(0, 10);
          map[d] = (map[d] ?? 0) + 1;
        });
        return map;
      };

      return json({
        users: bucket(usersRes.data),
        messages: bucket(msgsRes.data),
        conversations: bucket(convsRes.data),
        properties: bucket(propsRes.data),
      });
    }

    // ---------- USERS ----------
    if (action === "users") {
      let query = supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, agent_code, created_at", { count: "exact" })
        .order("created_at", { ascending: false });

      if (search?.trim()) {
        const s = search.replace(/%/g, "").replace(/_/g, "");
        query = query.or(`full_name.ilike.%${s}%,agent_code.ilike.%${s}%`);
      }

      query = query.range(pg * ps, (pg + 1) * ps - 1);
      const { data, count } = await query;
      return json({ data: data ?? [], total: count ?? 0 });
    }

    // ---------- CONVERSATIONS ----------
    if (action === "conversations") {
      let query = supabaseAdmin
        .from("conversations")
        .select("id, title, user_id, conversation_type, created_at, updated_at", { count: "exact" })
        .order("updated_at", { ascending: false });

      if (userId) {
        query = query.eq("user_id", userId);
      }

      query = query.range(pg * ps, (pg + 1) * ps - 1);
      const { data, count } = await query;

      const userIds = [...new Set((data ?? []).map((c: any) => c.user_id))];
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      const nameMap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => { nameMap[p.user_id] = p.full_name; });

      const enriched = (data ?? []).map((c: any) => ({
        ...c,
        user_name: nameMap[c.user_id] ?? "Desconocido",
      }));

      return json({ data: enriched, total: count ?? 0 });
    }

    // ---------- PROPERTIES ----------
    if (action === "properties") {
      let query = supabaseAdmin
        .from("properties")
        .select("id, title, operation, price, currency, zone, property_type, address, created_at, updated_at", { count: "exact" })
        .order("updated_at", { ascending: false });

      if (search?.trim()) {
        const s = search.replace(/%/g, "").replace(/_/g, "");
        query = query.or(`title.ilike.%${s}%,address.ilike.%${s}%,zone.ilike.%${s}%`);
      }

      query = query.range(pg * ps, (pg + 1) * ps - 1);
      const { data, count } = await query;
      return json({ data: data ?? [], total: count ?? 0 });
    }

    // ---------- SCRAPING STATUS ----------
    if (action === "scraping-status") {
      const { data: latest } = await supabaseAdmin
        .from("properties")
        .select("created_at, updated_at, last_seen_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Get the latest batch timestamp (most recent last_seen_at)
      const { data: batchInfo } = await supabaseAdmin
        .from("properties")
        .select("last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .single();

      const latestBatch = batchInfo?.last_seen_at ?? null;

      const [todayRes, totalRes] = await Promise.all([
        supabaseAdmin
          .from("properties")
          .select("id", { count: "exact", head: true })
          .gte("updated_at", todayStart.toISOString()),
        supabaseAdmin
          .from("properties")
          .select("id", { count: "exact", head: true }),
      ]);

      return json({
        lastProperty: latest,
        totalToday: todayRes.count ?? 0,
        totalProperties: totalRes.count ?? 0,
        lastBatchTimestamp: latestBatch,
      });
    }

    // ---------- FAVORITES (enriched) ----------
    if (action === "favorites") {
      const { data, count } = await supabaseAdmin
        .from("favorites")
        .select("id, user_id, property_id, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(pg * ps, (pg + 1) * ps - 1);

      // Enrich with user names and property titles
      const userIds = [...new Set((data ?? []).map((f: any) => f.user_id))];
      const propIds = [...new Set((data ?? []).map((f: any) => f.property_id))];

      const [profilesRes, propsRes] = await Promise.all([
        userIds.length > 0
          ? supabaseAdmin.from("profiles").select("user_id, full_name").in("user_id", userIds)
          : { data: [] },
        propIds.length > 0
          ? supabaseAdmin.from("properties").select("id, title, zone, price, currency").in("id", propIds)
          : { data: [] },
      ]);

      const nameMap: Record<string, string> = {};
      (profilesRes.data ?? []).forEach((p: any) => { nameMap[p.user_id] = p.full_name; });
      const propMap: Record<string, any> = {};
      (propsRes.data ?? []).forEach((p: any) => { propMap[p.id] = p; });

      const enriched = (data ?? []).map((f: any) => ({
        ...f,
        user_name: nameMap[f.user_id] ?? "Desconocido",
        property_title: propMap[f.property_id]?.title ?? "Sin título",
        property_zone: propMap[f.property_id]?.zone ?? null,
        property_price: propMap[f.property_id]?.price ?? null,
        property_currency: propMap[f.property_id]?.currency ?? null,
      }));

      return json({ data: enriched, total: count ?? 0 });
    }

    // ---------- CLIENTS (enriched) ----------
    if (action === "clients") {
      const { data, count } = await supabaseAdmin
        .from("clients")
        .select("id, full_name, email, phone, status, notes, user_id, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(pg * ps, (pg + 1) * ps - 1);

      const userIds = [...new Set((data ?? []).map((c: any) => c.user_id))];
      const { data: profiles } = userIds.length > 0
        ? await supabaseAdmin.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] };

      const nameMap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => { nameMap[p.user_id] = p.full_name; });

      const enriched = (data ?? []).map((c: any) => ({
        ...c,
        agent_name: nameMap[c.user_id] ?? "Desconocido",
      }));

      return json({ data: enriched, total: count ?? 0 });
    }

    // ---------- MESSAGES ----------
    if (action === "messages") {
      if (!conversationId) {
        return json({ error: "conversationId required" }, 400);
      }
      const { data } = await supabaseAdmin
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      return json({ data: data ?? [] });
    }

    // ---------- TRIGGER SCRAPING ----------
    if (action === "trigger-scraping") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const scrapeRes = await fetch(`${supabaseUrl}/functions/v1/scrape-properties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`,
        },
        body: JSON.stringify({}),
      });
      const scrapeData = await scrapeRes.json();
      return json(scrapeData, scrapeRes.status);
    }

    // ---------- SUPERVISOR STATS ----------
    if (action === "supervisor-stats") {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceISO = since.toISOString();

      const [allRes, approvedRes, rejectedRes, errorRes] = await Promise.all([
        supabaseAdmin.from("supervisor_logs").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("supervisor_logs").select("id", { count: "exact", head: true }).eq("verdict", "approved"),
        supabaseAdmin.from("supervisor_logs").select("id", { count: "exact", head: true }).eq("verdict", "rejected"),
        supabaseAdmin.from("supervisor_logs").select("id", { count: "exact", head: true }).eq("verdict", "error"),
      ]);

      const { data: scoreData } = await supabaseAdmin.from("supervisor_logs").select("score").not("score", "is", null);
      const scores = (scoreData ?? []).map((r: any) => r.score).filter((s: number) => s > 0);
      const avgScore = scores.length > 0 ? (scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

      const { data: timeData } = await supabaseAdmin
        .from("supervisor_logs")
        .select("verdict, created_at")
        .gte("created_at", sinceISO);

      const dailyMap: Record<string, { approved: number; rejected: number; error: number }> = {};
      (timeData ?? []).forEach((r: any) => {
        const d = r.created_at.slice(0, 10);
        if (!dailyMap[d]) dailyMap[d] = { approved: 0, rejected: 0, error: 0 };
        const v = r.verdict as "approved" | "rejected" | "error";
        if (dailyMap[d][v] !== undefined) dailyMap[d][v]++;
      });

      return json({
        total: allRes.count ?? 0,
        approved: approvedRes.count ?? 0,
        rejected: rejectedRes.count ?? 0,
        errors: errorRes.count ?? 0,
        avgScore: Math.round(avgScore * 10) / 10,
        daily: dailyMap,
      });
    }

    // ---------- SUPERVISOR LOGS ----------
    if (action === "supervisor-logs") {
      let query = supabaseAdmin
        .from("supervisor_logs")
        .select("id, conversation_id, user_id, user_message, alan_response, verdict, rejection_reason, score, retry_count, latency_ms, created_at", { count: "exact" })
        .order("created_at", { ascending: false });

      if (body.verdict) query = query.eq("verdict", body.verdict);
      if (body.minScore) query = query.gte("score", body.minScore);
      if (body.maxScore) query = query.lte("score", body.maxScore);

      query = query.range(pg * ps, (pg + 1) * ps - 1);
      const { data, count } = await query;

      const userIds = [...new Set((data ?? []).map((l: any) => l.user_id).filter(Boolean))];
      const { data: profiles } = userIds.length > 0
        ? await supabaseAdmin.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] };
      const nameMap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => { nameMap[p.user_id] = p.full_name; });

      const enriched = (data ?? []).map((l: any) => ({
        ...l,
        user_name: nameMap[l.user_id] ?? "Desconocido",
      }));

      return json({ data: enriched, total: count ?? 0 });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
