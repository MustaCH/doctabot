import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Get a valid Google Calendar access token, refreshing if expired */
async function getValidCalendarToken(
  supabase: any, userId: string, clientId: string, clientSecret: string
): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("google_calendar_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!tokenRow) return null;

  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) return tokenRow.access_token;

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshRes.ok) return null;
  const refreshData = await refreshRes.json();
  const newAccessToken = refreshData.access_token;
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
  await supabase
    .from("google_calendar_tokens")
    .update({ access_token: newAccessToken, expires_at: newExpiresAt })
    .eq("user_id", userId);
  return newAccessToken;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { event_id, title, event_date, recurrence, notes } = await req.json();
    if (!event_id || !title || !event_date) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getValidCalendarToken(supabase, user.id, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    if (!accessToken) {
      return new Response(JSON.stringify({ synced: false, reason: "no_calendar" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Calculate next occurrence
    const today = new Date();
    const [year, month, day] = event_date.split("-").map(Number);
    let nextDate = new Date(today.getFullYear(), month - 1, day);
    if (nextDate < today && recurrence === "yearly") {
      nextDate = new Date(today.getFullYear() + 1, month - 1, day);
    }
    if (nextDate < today && recurrence === "monthly") {
      nextDate = new Date(today.getFullYear(), today.getMonth() + 1, day);
    }

    const calendarBody: any = {
      summary: title,
      start: { date: nextDate.toISOString().slice(0, 10) },
      end: { date: nextDate.toISOString().slice(0, 10) },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 1440 }] },
    };
    if (notes) calendarBody.description = notes;
    if (recurrence !== "once") {
      const rruleFreq = recurrence === "yearly" ? "YEARLY" : "MONTHLY";
      calendarBody.recurrence = [`RRULE:FREQ=${rruleFreq}`];
    }

    const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(calendarBody),
    });

    if (!calRes.ok) {
      const err = await calRes.text();
      console.error("Calendar create error:", err);
      return new Response(JSON.stringify({ synced: false, reason: "calendar_error" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const calEvent = await calRes.json();

    // Update the client_event with the google_event_id using service role
    const serviceSupabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await serviceSupabase
      .from("client_events")
      .update({ google_event_id: calEvent.id })
      .eq("id", event_id)
      .eq("user_id", user.id);

    return new Response(JSON.stringify({ synced: true, google_event_id: calEvent.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("sync-calendar-event error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
