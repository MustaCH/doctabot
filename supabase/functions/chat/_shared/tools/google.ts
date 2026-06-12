// Google Calendar / Gmail helper functions
import { normalizeDatetime } from "./validators.ts";

/** Get a valid Google Calendar access token, refreshing if expired */
export async function getValidCalendarToken(
  supabase: any,
  userId: string,
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("google_calendar_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!tokenRow) return null;

  // Check if token is still valid (with 60s buffer)
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) return tokenRow.access_token;

  // Refresh the token
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

/** Extract Meet link from a Google Calendar event response */
export function extractMeetLink(event: any): string | null {
  return event.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === "video")?.uri ?? null;
}

/** Build a Google Calendar event body */
export function buildCalendarEvent(args: {
  summary: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  location?: string;
  addMeet?: boolean;
  attendees?: string[];
}): any {
  const body: any = {
    summary: args.summary,
    start: { dateTime: args.startDate.toISOString(), timeZone: "America/Argentina/Cordoba" },
    end: { dateTime: args.endDate.toISOString(), timeZone: "America/Argentina/Cordoba" },
  };
  if (args.description) body.description = String(args.description).slice(0, 2000);
  if (args.location) body.location = String(args.location).slice(0, 500);
  if (args.addMeet) {
    body.conferenceData = {
      createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  if (args.attendees?.length) {
    body.attendees = args.attendees
      .filter((e: string) => typeof e === "string" && e.includes("@"))
      .slice(0, 20)
      .map((e: string) => ({ email: e.trim().slice(0, 200) }));
  }
  return body;
}

/** Parse and validate start/end datetimes for calendar events */
export function parseEventDates(args: any): { startDate: Date; endDate: Date } | { error: string } {
  const startStr = typeof args.start_datetime === "string" ? args.start_datetime : null;
  if (!startStr) return { error: "La fecha de inicio es requerida" };
  const startDate = normalizeDatetime(startStr);
  if (!startDate) return { error: `Fecha de inicio inválida: '${startStr}'. Usá formato ISO como '2026-02-20T16:00'.` };
  const endDateRaw = args.end_datetime ? normalizeDatetime(String(args.end_datetime)) : null;
  const endDate = endDateRaw ?? new Date(startDate.getTime() + 60 * 60 * 1000);
  return { startDate, endDate };
}

/** Encode a header value as RFC 2047 Base64 UTF-8 if it contains non-ASCII */
export function encodeHeaderValue(value: string): string {
  // Check if value contains non-ASCII characters
  if (/[^\x00-\x7F]/.test(value)) {
    const encoded = btoa(unescape(encodeURIComponent(value)));
    return `=?UTF-8?B?${encoded}?=`;
  }
  return value;
}

/** Build a MIME email message and base64url-encode it */
export function buildMimeEmail(to: string, subject: string, body: string, cc?: string | null): string {
  const encodedSubject = encodeHeaderValue(subject);
  const mimeLines = [`To: ${to}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"];
  if (cc) mimeLines.push(`Cc: ${cc}`);
  mimeLines.push("", body);
  const mimeMessage = mimeLines.join("\r\n");
  return btoa(unescape(encodeURIComponent(mimeMessage))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
