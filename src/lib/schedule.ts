import { addDaysToKey, weekdayOfKey } from "@/lib/format";

export type SchedulePeriod = "week" | "month";

const pad = (n: number) => String(n).padStart(2, "0");
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
};
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Weeks run Monday–Sunday. */
export const weekStartKey = (key: string) => addDaysToKey(key, -((weekdayOfKey(key) + 6) % 7));
export const monthStartKey = (key: string) => `${key.slice(0, 8)}01`;

export function addMonthsToKey(key: string, n: number) {
  const { y, m } = parse(key);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

/** First day of the period containing `key`. */
export const periodStart = (period: SchedulePeriod, key: string) => (period === "week" ? weekStartKey(key) : monthStartKey(key));

/** Moves a period start forward/back by whole periods. */
export const shiftPeriod = (period: SchedulePeriod, start: string, n: number) =>
  period === "week" ? addDaysToKey(start, 7 * n) : addMonthsToKey(start, n);

/** Every day key in the period that starts at `start`. */
export function periodDays(period: SchedulePeriod, start: string) {
  const count = period === "week" ? 7 : daysInMonth(parse(start).y, parse(start).m);
  return Array.from({ length: count }, (_, i) => addDaysToKey(start, i));
}

/**
 * Which earlier day each day of a period is copied from.
 * Week: same weekday, 7 days earlier.
 * Month: same weekday and position in the month (1st Monday ← previous 1st Monday);
 * a 5th occurrence falls back to the previous month's last one.
 */
export function copyPairs(period: SchedulePeriod, targetStart: string): { from: string; to: string }[] {
  if (period === "week") return periodDays("week", targetStart).map((to) => ({ from: addDaysToKey(to, -7), to }));

  const prevStart = addMonthsToKey(targetStart, -1);
  const prev = parse(prevStart);
  const prevLen = daysInMonth(prev.y, prev.m);
  const firstWeekday = weekdayOfKey(prevStart);
  return periodDays("month", targetStart).map((to) => {
    const nth = Math.ceil(parse(to).d / 7);
    const offset = (weekdayOfKey(to) - firstWeekday + 7) % 7; // first occurrence of that weekday in prev month, 0-based
    let day = 1 + offset + 7 * (nth - 1);
    while (day > prevLen) day -= 7;
    return { from: `${prevStart.slice(0, 8)}${pad(day)}`, to };
  });
}
