import { addDaysToKey, dayKey, weekdayOfKey } from "@/lib/format";
import type { BookingStatus, ScheduleMode } from "@/lib/types";

/** Pure number-crunching for the practice dashboard (no I/O, so it can be tested). */

export interface DBooking {
  id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  price_cents: number;
  deposit_cents: number;
  payment_status: string;
  service_id: string | null;
  service_name: string;
  member_id: string;
  customer_id: string | null;
  customer_name?: string | null;
  source: "online" | "manual";
}

export interface DashInput {
  bookings: DBooking[]; // must cover the previous period through the next 7 days
  customers: { id: string; name: string; created_at: string }[];
  rules: { member_id: string; weekday: number; start_time: string; end_time: string }[];
  shifts: { member_id: string; day: string; start_time: string; end_time: string }[];
  scheduleMode: ScheduleMode;
  memberIds: string[]; // people who take bookings (capacity is measured for them)
  tz: string;
  today: string; // YYYY-MM-DD in the business time zone
  rangeDays: number;
  now: Date;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** A booking that takes up a time slot and counts as an appointment (not cancelled or awaiting a decision). */
const isAppointment = (b: DBooking) => b.status === "confirmed" || b.status === "completed" || b.status === "no_show";

export interface Compared<T = number> {
  value: T;
  prev: T;
}

/** Percentage change, or null when there's nothing to compare against. */
export function change(value: number, prev: number): number | null {
  if (prev === 0) return value === 0 ? 0 : null;
  return (value - prev) / prev;
}

function daysBetween(start: string, end: string) {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysToKey(d, 1)) out.push(d);
  return out;
}

export function buildDashboard(i: DashInput) {
  const end = i.today;
  const start = addDaysToKey(end, -(i.rangeDays - 1));
  const prevEnd = addDaysToKey(start, -1);
  const prevStart = addDaysToKey(prevEnd, -(i.rangeDays - 1));

  const dk = (iso: string) => dayKey(iso, i.tz);
  const inRange = (b: DBooking, a: string, z: string) => {
    const d = dk(b.starts_at);
    return d >= a && d <= z;
  };
  const nowMs = i.now.getTime();
  /** The service was provided: marked completed, or confirmed and already over. */
  const delivered = (b: DBooking) => b.status === "completed" || (b.status === "confirmed" && new Date(b.ends_at).getTime() <= nowMs);

  const cur = i.bookings.filter((b) => inRange(b, start, end));
  const prev = i.bookings.filter((b) => inRange(b, prevStart, prevEnd));

  const metrics = (list: DBooking[], a: string, z: string) => {
    const appts = list.filter(isAppointment);
    const done = list.filter(delivered);
    const noShows = list.filter((b) => b.status === "no_show").length;
    const cancelled = list.filter((b) => b.status === "cancelled").length;
    const decided = done.length + noShows;
    const considered = appts.length + cancelled;
    const revenue = done.reduce((n, b) => n + b.price_cents, 0);
    const deposits = list.filter((b) => b.payment_status === "paid").reduce((n, b) => n + b.deposit_cents, 0);
    const customersNew = i.customers.filter((c) => dk(c.created_at) >= a && dk(c.created_at) <= z).length;
    return {
      appointments: appts.length,
      revenue,
      deposits,
      newCustomers: customersNew,
      noShowRate: decided ? noShows / decided : null,
      cancelRate: considered ? cancelled / considered : null,
      avgValue: done.length ? revenue / done.length : null,
      delivered: done.length,
    };
  };
  const m = metrics(cur, start, end);
  const pm = metrics(prev, prevStart, prevEnd);

  // ----- capacity & utilization
  const capacityFor = (a: string, z: string, memberId?: string) => {
    let total = 0;
    for (const day of daysBetween(a, z)) {
      const ids = memberId ? [memberId] : i.memberIds;
      for (const id of ids) {
        if (i.scheduleMode === "shifts") {
          total += i.shifts.filter((s) => s.member_id === id && s.day === day).reduce((n, s) => n + minutes(s.end_time) - minutes(s.start_time), 0);
        } else {
          const wd = weekdayOfKey(day);
          total += i.rules.filter((r) => r.member_id === id && r.weekday === wd).reduce((n, r) => n + minutes(r.end_time) - minutes(r.start_time), 0);
        }
      }
    }
    return total;
  };
  const bookedMinutes = (list: DBooking[]) =>
    list.filter(isAppointment).reduce((n, b) => n + (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000, 0);
  const capacity = capacityFor(start, end);
  const utilization = capacity > 0 ? Math.min(1, bookedMinutes(cur) / capacity) : null;

  // ----- returning customers: booked in range but already a customer before the range began
  const created = new Map(i.customers.map((c) => [c.id, dk(c.created_at)]));
  const bookedCustomers = new Set(cur.filter(isAppointment).flatMap((b) => (b.customer_id ? [b.customer_id] : [])));
  const returning = [...bookedCustomers].filter((id) => (created.get(id) ?? end) < start).length;
  const returningShare = bookedCustomers.size ? returning / bookedCustomers.size : null;

  // ----- trend by day
  const daily = daysBetween(start, end).map((day) => {
    const list = cur.filter((b) => dk(b.starts_at) === day);
    return { day, appointments: list.filter(isAppointment).length, revenue: list.filter(delivered).reduce((n, b) => n + b.price_cents, 0) };
  });

  // ----- services
  const byService = new Map<string, { name: string; count: number; revenue: number }>();
  for (const b of cur.filter(isAppointment)) {
    const k = b.service_id ?? b.service_name;
    const row = byService.get(k) ?? { name: b.service_name, count: 0, revenue: 0 };
    row.count++;
    if (delivered(b)) row.revenue += b.price_cents;
    byService.set(k, row);
  }
  const services = [...byService.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, 6);

  // ----- busiest times (weekday x hour, in the business time zone)
  const cells: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const hourFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: i.tz });
  for (const b of cur.filter(isAppointment)) {
    const hour = Number(hourFmt.format(new Date(b.starts_at))) % 24;
    cells[weekdayOfKey(dk(b.starts_at))][hour]++;
  }
  const flat = cells.flat();
  const max = Math.max(0, ...flat);
  const hoursUsed = cells[0].map((_, h) => h).filter((h) => cells.some((row) => row[h] > 0));
  const heatmap = { cells, max, minHour: hoursUsed.length ? Math.min(...hoursUsed) : 9, maxHour: hoursUsed.length ? Math.max(...hoursUsed) : 17 };

  // ----- staff
  const staff = i.memberIds
    .map((id) => {
      const list = cur.filter((b) => b.member_id === id);
      const cap = capacityFor(start, end, id);
      return {
        memberId: id,
        appointments: list.filter(isAppointment).length,
        revenue: list.filter(delivered).reduce((n, b) => n + b.price_cents, 0),
        noShows: list.filter((b) => b.status === "no_show").length,
        utilization: cap > 0 ? Math.min(1, bookedMinutes(list) / cap) : null,
      };
    })
    .sort((a, b) => b.appointments - a.appointments);

  // ----- statuses and sources
  const status = {
    completed: cur.filter(delivered).length,
    upcoming: cur.filter((b) => b.status === "confirmed" && !delivered(b)).length,
    noShow: cur.filter((b) => b.status === "no_show").length,
    cancelled: cur.filter((b) => b.status === "cancelled").length,
  };
  const source = {
    online: cur.filter((b) => isAppointment(b) && b.source === "online").length,
    manual: cur.filter((b) => isAppointment(b) && b.source === "manual").length,
  };

  // ----- best customers
  const spend = new Map<string, { name: string; visits: number; spend: number }>();
  for (const b of cur.filter(delivered)) {
    if (!b.customer_id) continue;
    const row = spend.get(b.customer_id) ?? { name: b.customer_name ?? "Customer", visits: 0, spend: 0 };
    row.visits++;
    row.spend += b.price_cents;
    spend.set(b.customer_id, row);
  }
  const topCustomers = [...spend.entries()]
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => b.spend - a.spend || b.visits - a.visits)
    .slice(0, 5);

  // ----- the week ahead (today + 6 days) and today's list
  const upcoming = daysBetween(i.today, addDaysToKey(i.today, 6)).map((day) => ({
    day,
    count: i.bookings.filter((b) => dk(b.starts_at) === day && (isAppointment(b) || b.status === "pending_approval")).length,
  }));
  const todayList = i.bookings
    .filter((b) => dk(b.starts_at) === i.today && b.status !== "cancelled")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nextUp = todayList.find((b) => new Date(b.ends_at).getTime() > nowMs && (b.status === "confirmed" || b.status === "pending_approval")) ?? null;

  return {
    range: { start, end, prevStart, prevEnd, days: i.rangeDays },
    kpis: {
      appointments: { value: m.appointments, prev: pm.appointments } as Compared,
      revenue: { value: m.revenue, prev: pm.revenue } as Compared,
      newCustomers: { value: m.newCustomers, prev: pm.newCustomers } as Compared,
      noShowRate: { value: m.noShowRate, prev: pm.noShowRate } as Compared<number | null>,
      cancelRate: { value: m.cancelRate, prev: pm.cancelRate } as Compared<number | null>,
      avgValue: { value: m.avgValue, prev: pm.avgValue } as Compared<number | null>,
      deposits: m.deposits,
      utilization,
      returningShare,
      uniqueCustomers: bookedCustomers.size,
    },
    daily,
    services,
    heatmap,
    staff,
    status,
    source,
    topCustomers,
    upcoming,
    todayList,
    nextUp,
    pendingApprovals: i.bookings.filter((b) => b.status === "pending_approval" && new Date(b.starts_at).getTime() > nowMs).length,
    awaitingPayment: i.bookings.filter((b) => b.status === "pending_payment" && new Date(b.starts_at).getTime() > nowMs).length,
  };
}

export type Dashboard = ReturnType<typeof buildDashboard>;

/** Date ranges the Home page offers. */
export const RANGES = [7, 30, 90] as const;
export const parseRange = (v: unknown) => ((RANGES as readonly number[]).includes(Number(v)) ? Number(v) : 30);
