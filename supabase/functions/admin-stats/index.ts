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
    // Validate PIN from request body
    const body = await req.json();
    const { pin, action, page, pageSize, search, conversationId } = body;

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

    if (action === "stats") {
      const [props, profiles, convs, msgs, favs, clients] = await Promise.all([
        supabaseAdmin.from("properties").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("conversations").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("messages").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("favorites").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("clients").select("id", { count: "exact", head: true }),
      ]);

      return new Response(
        JSON.stringify({
          properties: props.count ?? 0,
          users: profiles.count ?? 0,
          conversations: convs.count ?? 0,
          messages: msgs.count ?? 0,
          favorites: favs.count ?? 0,
          clients: clients.count ?? 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "users") {
      const { data, count } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, agent_code, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(pg * ps, (pg + 1) * ps - 1);

      return new Response(JSON.stringify({ data: data ?? [], total: count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "conversations") {
      const { data, count } = await supabaseAdmin
        .from("conversations")
        .select("id, title, user_id, conversation_type, created_at, updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(pg * ps, (pg + 1) * ps - 1);

      return new Response(JSON.stringify({ data: data ?? [], total: count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "properties") {
      let query = supabaseAdmin
        .from("properties")
        .select("id, title, operation, price, currency, zone, property_type, address, created_at, updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(pg * ps, (pg + 1) * ps - 1);

      if (search?.trim()) {
        const s = search.replace(/%/g, "").replace(/_/g, "");
        query = query.or(`title.ilike.%${s}%,address.ilike.%${s}%,zone.ilike.%${s}%`);
      }

      const { data, count } = await query;

      return new Response(JSON.stringify({ data: data ?? [], total: count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scraping-status") {
      const { data: latest } = await supabaseAdmin
        .from("properties")
        .select("created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabaseAdmin
        .from("properties")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", todayStart.toISOString());

      return new Response(
        JSON.stringify({ lastProperty: latest, totalToday: count ?? 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "favorites") {
      const { data, count } = await supabaseAdmin
        .from("favorites")
        .select("id, user_id, property_id, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(pg * ps, (pg + 1) * ps - 1);

      return new Response(JSON.stringify({ data: data ?? [], total: count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "clients") {
      const { data, count } = await supabaseAdmin
        .from("clients")
        .select("id, full_name, email, phone, status, user_id, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(pg * ps, (pg + 1) * ps - 1);

      return new Response(JSON.stringify({ data: data ?? [], total: count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "messages") {
      if (!conversationId) {
        return new Response(JSON.stringify({ error: "conversationId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data } = await supabaseAdmin
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      return new Response(JSON.stringify({ data: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      return new Response(JSON.stringify(scrapeData), {
        status: scrapeRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
