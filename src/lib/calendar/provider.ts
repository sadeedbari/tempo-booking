import "server-only";

export type ProviderId = "google" | "microsoft";

export interface Tokens {
  accessToken: string;
  expiresIn: number;
  /** Present on first consent; Microsoft also rotates it on refresh. */
  refreshToken?: string;
  email?: string | null;
}

/** A time block on a personal calendar (ISO instants; all-day events carry dates instead). */
export interface BusyEvent {
  id: string;
  start: string;
  end: string;
  allDay: boolean;
  /** Created by Tempo itself — must not block slots. */
  ownedByTempo?: boolean;
}

export interface EventInput {
  summary: string;
  description: string;
  location?: string;
  start: string; // ISO instant
  end: string;
  timeZone: string; // business time zone, for display
  bookingId: string;
}

export interface CalendarProvider {
  id: ProviderId;
  label: string;
  configured(): boolean;
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  revoke?(refreshToken: string): Promise<void>;
  listBusy(token: string, calendarId: string, from: string, to: string): Promise<BusyEvent[]>;
  insertEvent(token: string, calendarId: string, ev: EventInput): Promise<string | null>;
  /** Null when the event no longer exists (deleted on their side). */
  patchEvent(token: string, calendarId: string, id: string, ev: EventInput): Promise<string | null>;
  deleteEvent(token: string, calendarId: string, id: string): Promise<void>;
}
