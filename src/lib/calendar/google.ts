import "server-only";
import { env } from "@/lib/env";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
// Create/edit events and read the events that block time. Nothing broader.
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export const redirectUri = () => `${env.appUrl}/api/google/callback`;

export function authUrl(state: string) {
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
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId!, client_secret: env.googleClientSecret!, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || "Google token error"), { code: json.error as string });
  return json as TokenResponse;
}

export const exchangeCode = (code: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
export const refreshAccess = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export function emailFromIdToken(idToken?: string) {
  if (!idToken) return null;
  try {
    return (JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
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

export interface GoogleEvent {
  id: string;
  status?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}

/** All events overlapping the window (recurring events expanded). */
export async function listEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string) {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", maxResults: "250", showDeleted: "false" });
    if (pageToken) p.set("pageToken", pageToken);
    const page = await api<{ items?: GoogleEvent[]; nextPageToken?: string }>(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?${p}`);
    out.push(...(page?.items ?? []));
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return out;
}

export interface EventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties?: { private: Record<string, string> };
}

export const insertEvent = (token: string, calendarId: string, ev: EventInput) =>
  api<{ id: string }>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", body: JSON.stringify(ev) });

export const patchEvent = (token: string, calendarId: string, id: string, ev: EventInput) =>
  api<{ id: string }>(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(ev) });

export const deleteEvent = (token: string, calendarId: string, id: string) =>
  api<null>(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
