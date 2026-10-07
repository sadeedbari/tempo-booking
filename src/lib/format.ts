import { TZDate } from "@date-fns/tz";

export function formatMoney(cents: number, currency = "CAD") {
  if (!cents) return "Free";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatTime(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(date),
  );
}

export function formatDate(date: Date | string, timeZone: string, opts?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
    ...opts,
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string, timeZone: string) {
  return `${formatDate(date, timeZone)} at ${formatTime(date, timeZone)}`;
}

/** "YYYY-MM-DD" for an instant, in a given time zone. */
export function dayKey(date: Date | string, timeZone: string) {
  const d = new TZDate(new Date(date).getTime(), timeZone);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midnight at the start of a "YYYY-MM-DD" day in a time zone, as a TZDate. */
export function startOfDayInZone(key: string, timeZone: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new TZDate(y, m - 1, d, 0, 0, 0, timeZone);
}

export function todayKey(timeZone: string) {
  return dayKey(new Date(), timeZone);
}

export function addDaysToKey(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOfKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function timeZoneLabel(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  pending_approval: "Awaiting approval",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};
