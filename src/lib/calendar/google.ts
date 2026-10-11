import "server-only";
import { env } from "@/lib/env";
import type { BusyEvent, CalendarProvider, EventInput, Tokens } from "./provider";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
// Create/edit events and read the events that block time. Nothing broader.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const SCOPES = ["openid", "email", CALENDAR_SCOPE];

const redirectUri = () => `${env.appUrl}/api/google/callback`;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId!, client_secret: env.googleClientSecret!, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || "Google token error"), { code: json.error as string });
  const t = json as TokenResponse;
  return { accessToken: t.access_token, expiresIn: t.expires_in, refreshToken: t.refresh_token, email: emailFromIdToken(t.id_token), scopes: t.scope?.split(" ") };
}

function emailFromIdToken(idToken?: string) {
  if (!idToken) return null;
  try {
    return (JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

async function api<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 204 || res.status === 404 || res.status === 410) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || `Google Calendar error ${res.status}`), { status: res.status });
  return json as T;
}

interface GoogleEvent {
  id: string;
  status?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}

const body = (ev: EventInput) => ({
  summary: ev.summary,
  description: ev.description,
  location: ev.location,
  start: { dateTime: ev.start, timeZone: ev.timeZone },
  end: { dateTime: ev.end, timeZone: ev.timeZone },
  extendedProperties: { private: { tempoBookingId: ev.bookingId } },
});

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}/events`;

export const google: CalendarProvider = {
  id: "google",
  label: "Google Calendar",
  configured: () => Boolean(env.googleClientId && env.googleClientSecret),

  authUrl(state) {
    const p = new URLSearchParams({
      client_id: env.googleClientId!,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent", // always issue a refresh token
      include_granted_scopes: "true",
      state,
    });
    return `${AUTH}?${p}`;
  },

  async exchangeCode(code) {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
    // Google lets people untick individual permissions, so check calendar access was really granted.
    if (!t.scopes?.includes(CALENDAR_SCOPE)) throw Object.assign(new Error("Calendar permission was not granted"), { code: "missing_scope" });
    return t;
  },
  refresh: (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),

  async revoke(token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
  },

  async listBusy(token, calendarId, timeMin, timeMax) {
    const out: BusyEvent[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", maxResults: "250", showDeleted: "false" });
      if (pageToken) p.set("pageToken", pageToken);
      const page = await api<{ items?: GoogleEvent[]; nextPageToken?: string }>(token, `${cal(calendarId)}?${p}`);
      for (const ev of page?.items ?? []) {
        if (ev.status === "cancelled" || ev.transparency === "transparent") continue;
        if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
        const owned = Boolean(ev.extendedProperties?.private?.tempoBookingId);
        if (ev.start?.dateTime && ev.end?.dateTime) {
          out.push({ id: ev.id, start: new Date(ev.start.dateTime).toISOString(), end: new Date(ev.end.dateTime).toISOString(), allDay: false, ownedByTempo: owned });
        } else if (ev.start?.date && ev.end?.date) {
          out.push({ id: ev.id, start: ev.start.date, end: ev.end.date, allDay: true, ownedByTempo: owned });
        }
      }
      pageToken = page?.nextPageToken;
    } while (pageToken);
    return out;
  },

  async insertEvent(token, calendarId, ev) {
    return (await api<{ id: string }>(token, cal(calendarId), { method: "POST", body: JSON.stringify(body(ev)) }))?.id ?? null;
  },
  async patchEvent(token, calendarId, id, ev) {
    return (await api<{ id: string }>(token, `${cal(calendarId)}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body(ev)) }))?.id ?? null;
  },
  async deleteEvent(token, calendarId, id) {
    await api<null>(token, `${cal(calendarId)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
