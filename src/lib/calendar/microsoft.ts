import "server-only";
import { env } from "@/lib/env";
import type { BusyEvent, CalendarProvider, EventInput, Tokens } from "./provider";

const GRAPH = "https://graph.microsoft.com/v1.0";
const authority = () => `https://login.microsoftonline.com/${env.microsoftTenant}/oauth2/v2.0`;
// Read/write the signed-in user's own calendars; offline_access issues the refresh token.
const SCOPES = ["openid", "profile", "email", "offline_access", "https://graph.microsoft.com/Calendars.ReadWrite"];

const redirectUri = () => `${env.appUrl}/api/microsoft/callback`;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.microsoftClientId!,
      client_secret: env.microsoftClientSecret!,
      scope: SCOPES.join(" "),
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || "Microsoft token error"), { code: json.error as string });
  const t = json as TokenResponse;
  return { accessToken: t.access_token, expiresIn: t.expires_in, refreshToken: t.refresh_token, email: emailFromIdToken(t.id_token) };
}

function emailFromIdToken(idToken?: string) {
  if (!idToken) return null;
  try {
    const c = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
    return c.email ?? c.preferred_username ?? null;
  } catch {
    return null;
  }
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 204 || res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || `Microsoft Graph error ${res.status}`), { status: res.status });
  return json as T;
}

/** "primary" is the user's default calendar. */
const base = (calendarId: string) => (calendarId === "primary" ? "/me" : `/me/calendars/${encodeURIComponent(calendarId)}`);

interface GraphEvent {
  id: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  responseStatus?: { response?: string };
}

// Graph returns UTC times without a zone suffix when asked for outlook.timezone="UTC".
const asUtc = (s: string) => new Date(s.endsWith("Z") ? s : `${s}Z`).toISOString();
const noZone = (iso: string) => new Date(iso).toISOString().replace("Z", "");

const body = (ev: EventInput) => ({
  subject: ev.summary,
  body: { contentType: "text", content: ev.description },
  start: { dateTime: noZone(ev.start), timeZone: "UTC" },
  end: { dateTime: noZone(ev.end), timeZone: "UTC" },
  ...(ev.location ? { location: { displayName: ev.location } } : {}),
  showAs: "busy",
});

export const microsoft: CalendarProvider = {
  id: "microsoft",
  label: "Outlook Calendar",
  configured: () => Boolean(env.microsoftClientId && env.microsoftClientSecret),

  authUrl(state) {
    const p = new URLSearchParams({
      client_id: env.microsoftClientId!,
      response_type: "code",
      redirect_uri: redirectUri(),
      response_mode: "query",
      scope: SCOPES.join(" "),
      prompt: "select_account",
      state,
    });
    return `${authority()}/authorize?${p}`;
  },

  exchangeCode: (code) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
  refresh: (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),

  async listBusy(token, calendarId, from, to) {
    const out: BusyEvent[] = [];
    const p = new URLSearchParams({
      startDateTime: from,
      endDateTime: to,
      $select: "id,start,end,isAllDay,isCancelled,showAs,responseStatus",
      $top: "100",
    });
    let url: string | undefined = `${GRAPH}${base(calendarId)}/calendarView?${p}`;
    while (url) {
      const page: { value?: GraphEvent[]; "@odata.nextLink"?: string } | null = await api(token, url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
      for (const ev of page?.value ?? []) {
        if (ev.isCancelled || ev.showAs === "free" || ev.showAs === "workingElsewhere") continue;
        if (ev.responseStatus?.response === "declined") continue;
        if (ev.isAllDay) out.push({ id: ev.id, start: ev.start.dateTime.slice(0, 10), end: ev.end.dateTime.slice(0, 10), allDay: true });
        else out.push({ id: ev.id, start: asUtc(ev.start.dateTime), end: asUtc(ev.end.dateTime), allDay: false });
      }
      url = page?.["@odata.nextLink"];
    }
    return out;
  },

  async insertEvent(token, calendarId, ev) {
    return (await api<{ id: string }>(token, `${base(calendarId)}/events`, { method: "POST", body: JSON.stringify(body(ev)) }))?.id ?? null;
  },
  async patchEvent(token, calendarId, id, ev) {
    return (await api<{ id: string }>(token, `/me/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body(ev)) }))?.id ?? null;
  },
  async deleteEvent(token, _calendarId, id) {
    await api<null>(token, `/me/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
