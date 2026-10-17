import { dayKey, weekdayOfKey } from "@/lib/format";
import { change, type DBooking, type Dashboard } from "@/lib/dashboard";
import { dayToDate, type Sheet } from "@/lib/excel";
import type { Location, Membership, Shift } from "@/lib/types";

/** Turns each page's data into worksheets. Pure, so it's easy to test. */

const MONEY = "#,##0.00";
const PCT = "0.0%";
const COUNT = "0";
const DATE = "yyyy-mm-dd";
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const STATUS: Record<string, string> = {
  pending_payment: "Awaiting payment",
  pending_approval: "Awaiting approval",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

const cents = (c: number) => Math.round(c) / 100;
const money = (c: number | null) => (c === null ? null : cents(c));

/** "09:00" / "09:00:00" -> "9:00 AM" */
export function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const hoursBetween = (a: string, b: string) => (Number(b.slice(0, 2)) * 60 + Number(b.slice(3, 5)) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5)))) / 60;

const timeIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));

/* ───────────────────────────── Home (dashboard) ───────────────────────────── */

export function homeSheets(opts: {
  d: Dashboard;
  bookings: DBooking[];
  members: Membership[];
  isAdmin: boolean;
  tz: string;
  currency: string;
  /** Each booking's intake answers as one line of text ("Question: answer; ..."), by booking id. */
  answers?: Map<string, string>;
}): Sheet[] {
  const { d, bookings, members, isAdmin, tz, currency } = opts;
  const k = d.kpis;
  const period = `${d.range.start} to ${d.range.end} (last ${d.range.days} days). Compared with ${d.range.prevStart} to ${d.range.prevEnd}.`;

  type Row = { metric: string; now: { v: number | null; fmt: string }; prev: { v: number | null; fmt: string }; change: { v: number | null; fmt: string } };
  const row = (metric: string, now: number | null, prev: number | null, fmt: string, ratio = false): Row => ({
    metric,
    now: { v: now, fmt },
    prev: { v: prev, fmt },
    change: { v: now === null || prev === null ? null : ratio ? now - prev : change(now, prev), fmt: ratio ? "+0.0%;-0.0%;0.0%" : "+0.0%;-0.0%;0.0%" },
  });
  const summaryRows: Row[] = [
    row("Appointments", k.appointments.value, k.appointments.prev, COUNT),
    ...(isAdmin
      ? [
          row(`Revenue (${currency})`, cents(k.revenue.value), cents(k.revenue.prev), MONEY),
          row("New customers", k.newCustomers.value, k.newCustomers.prev, COUNT),
        ]
      : []),
    row("No-show rate", k.noShowRate.value, k.noShowRate.prev, PCT, true),
    row("Cancellation rate", k.cancelRate.value, k.cancelRate.prev, PCT, true),
    ...(isAdmin
      ? [
          row(`Average booking (${currency})`, money(k.avgValue.value), money(k.avgValue.prev), MONEY),
        ]
      : []),
  ];
  const sheets: Sheet[] = [
    {
      name: "Summary",
      title: "Tempo - Home summary",
      subtitle: period,
      columns: [
        { header: "Measure", key: "metric", width: 30 },
        { header: "This period", key: "now", width: 16, align: "right" },
        { header: "Previous period", key: "prev", width: 18, align: "right" },
        { header: "Change", key: "change", width: 12, align: "right" },
      ],
      rows: [
        ...summaryRows,
        { metric: "Time booked (share of available hours)", now: { v: k.utilization, fmt: PCT }, prev: null, change: null },
        ...(isAdmin
          ? [
              { metric: `Deposits collected (${currency})`, now: { v: cents(k.deposits), fmt: MONEY }, prev: null, change: null },
              { metric: "Returning customers (share of customers who booked)", now: { v: k.returningShare, fmt: PCT }, prev: null, change: null },
            ]
          : []),
      ],
    },
    {
      name: "Daily",
      columns: [
        { header: "Date", key: "date", width: 14, fmt: DATE, align: "left" },
        { header: "Weekday", key: "weekday", width: 14 },
        { header: "Appointments", key: "appts", width: 14, fmt: COUNT },
        ...(isAdmin ? [{ header: `Revenue (${currency})`, key: "revenue", width: 16, fmt: MONEY }] : []),
      ],
      rows: d.daily.map((x) => ({ date: dayToDate(x.day), weekday: WEEKDAY[weekdayOfKey(x.day)], appts: x.appointments, revenue: cents(x.revenue) })),
    },
    {
      name: "Services",
      columns: [
        { header: "Service", key: "name", width: 32 },
        { header: "Bookings", key: "count", width: 12, fmt: COUNT },
        ...(isAdmin ? [{ header: `Revenue (${currency})`, key: "revenue", width: 16, fmt: MONEY }] : []),
      ],
      rows: d.services.map((s) => ({ name: s.name, count: s.count, revenue: cents(s.revenue) })),
    },
  ];

  if (isAdmin) {
    const byId = new Map(members.map((m) => [m.id, m.display_name]));
    sheets.push({
      name: "Team",
      columns: [
        { header: "Person", key: "name", width: 26 },
        { header: "Appointments", key: "appts", width: 14, fmt: COUNT },
        { header: `Revenue (${currency})`, key: "revenue", width: 16, fmt: MONEY },
        { header: "Time booked", key: "util", width: 14, fmt: PCT },
        { header: "No-shows", key: "noShows", width: 11, fmt: COUNT },
      ],
      rows: d.staff.map((s) => ({ name: byId.get(s.memberId) ?? "", appts: s.appointments, revenue: cents(s.revenue), util: s.utilization, noShows: s.noShows })),
    });
  }

  // Busiest times: weekdays down, hours across.
  const hours = Array.from({ length: d.heatmap.maxHour - d.heatmap.minHour + 1 }, (_, i) => d.heatmap.minHour + i);
  sheets.push({
    name: "Busiest times",
    title: "Appointments by weekday and start hour",
    subtitle: period,
    columns: [{ header: "Weekday", key: "day", width: 14 }, ...hours.map((h) => ({ header: clock(`${h}:00`), key: `h${h}`, width: 9, fmt: COUNT }))],
    rows: MON_FIRST.map((wd) => ({ day: WEEKDAY[wd], ...Object.fromEntries(hours.map((h) => [`h${h}`, d.heatmap.cells[wd][h]])) })),
  });

  if (isAdmin) {
    sheets.push({
      name: "Best customers",
      columns: [
        { header: "Customer", key: "name", width: 30 },
        { header: "Visits", key: "visits", width: 10, fmt: COUNT },
        { header: `Spend (${currency})`, key: "spend", width: 14, fmt: MONEY },
      ],
      rows: d.topCustomers.map((c) => ({ name: c.name, visits: c.visits, spend: cents(c.spend) })),
    });
  }

  // Every booking in the period, for accountants and reconciliation.
  const memberName = new Map(members.map((m) => [m.id, m.display_name]));
  const inPeriod = bookings
    .filter((b) => {
      const day = dayKey(b.starts_at, tz);
      return day >= d.range.start && day <= d.range.end;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  sheets.push({
    name: "Bookings",
    title: "Bookings in this period",
    subtitle: period,
    columns: [
      { header: "Date", key: "date", width: 13, fmt: DATE, align: "left" },
      { header: "Start", key: "start", width: 10 },
      { header: "End", key: "end", width: 10 },
      { header: "Service", key: "service", width: 28 },
      ...(isAdmin ? [{ header: "Customer", key: "customer", width: 26 }] : []),
      { header: "Staff", key: "staff", width: 22 },
      { header: "Status", key: "status", width: 18 },
      ...(isAdmin
        ? [
            { header: `Price (${currency})`, key: "price", width: 13, fmt: MONEY },
            { header: `Deposit paid (${currency})`, key: "deposit", width: 18, fmt: MONEY },
          ]
        : []),
      { header: "Booked", key: "source", width: 12 },
      ...(isAdmin ? [{ header: "Booking questions", key: "answers", width: 48 }] : []),
    ],
    rows: inPeriod.map((b) => ({
      date: dayToDate(dayKey(b.starts_at, tz)),
      start: timeIn(b.starts_at, tz),
      end: timeIn(b.ends_at, tz),
      service: b.service_name,
      customer: b.customer_name ?? "",
      staff: memberName.get(b.member_id) ?? "",
      status: STATUS[b.status] ?? b.status,
      price: cents(b.price_cents),
      deposit: b.payment_status === "paid" ? cents(b.deposit_cents) : 0,
      source: b.source === "online" ? "Online" : "By team",
      answers: opts.answers?.get(b.id) ?? "",
    })),
  });

  return sheets;
}

/* ───────────────────────────── Customers ───────────────────────────── */

export interface CustomerRow {
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  sms_consent_at: string | null;
  created_at: string;
}

export function customerSheets(opts: {
  customers: (CustomerRow & { id: string })[];
  stats: Record<string, { visits: number; last: string | null; spent: number }>;
  tz: string;
  currency: string;
}): Sheet[] {
  const { customers, stats, tz, currency } = opts;
  return [
    {
      name: "Customers",
      columns: [
        { header: "Name", key: "name", width: 28 },
        { header: "Email", key: "email", width: 32 },
        { header: "Phone", key: "phone", width: 18 },
        { header: "Agreed to texts", key: "sms", width: 16 },
        { header: "Agreed on", key: "smsDate", width: 13, fmt: DATE, align: "left" },
        { header: "Customer since", key: "since", width: 15, fmt: DATE, align: "left" },
        { header: "Visits", key: "visits", width: 9, fmt: COUNT },
        { header: "Last visit", key: "last", width: 13, fmt: DATE, align: "left" },
        { header: `Total spent (${currency})`, key: "spent", width: 18, fmt: MONEY },
        { header: "Private notes", key: "notes", width: 40 },
      ],
      rows: customers.map((c) => {
        const s = stats[c.id];
        return {
          name: c.name,
          email: c.email,
          phone: c.phone ?? "",
          sms: c.sms_consent_at ? "Yes" : "No",
          smsDate: c.sms_consent_at ? dayToDate(dayKey(c.sms_consent_at, tz)) : null,
          since: dayToDate(dayKey(c.created_at, tz)),
          visits: s?.visits ?? 0,
          last: s?.last ? dayToDate(dayKey(s.last, tz)) : null,
          spent: cents(s?.spent ?? 0),
          notes: c.notes ?? "",
        };
      }),
    },
  ];
}

/* ───────────────────────────── Schedule ───────────────────────────── */

export function scheduleSheets(opts: {
  days: string[];
  shifts: Shift[];
  members: Membership[];
  locations: Location[];
  period: "week" | "month";
}): Sheet[] {
  const { days, shifts, members, locations, period } = opts;
  const loc = new Map(locations.map((l) => [l.id, l.name]));
  const label = (day: string) => `${WEEKDAY[weekdayOfKey(day)].slice(0, 3)} ${day.slice(5)}`;
  const range = `${days[0]} to ${days[days.length - 1]}`;

  const grid: Sheet = {
    name: period === "week" ? "Week" : "Month",
    title: `Schedule: ${range}`,
    subtitle: "Each cell shows the person's shifts that day. Blank means not scheduled.",
    freezeColumns: 1,
    columns: [
      { header: "Person", key: "person", width: 24 },
      ...days.map((d) => ({ header: label(d), key: d, width: period === "week" ? 22 : 16 })),
      { header: "Total hours", key: "total", width: 13, fmt: "0.0" },
    ],
    rows: members.map((m) => {
      const mine = shifts.filter((s) => s.member_id === m.id);
      const cells: Record<string, string | null> = {};
      for (const d of days) {
        const text = mine
          .filter((s) => s.day === d)
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .map((s) => `${clock(s.start_time)} - ${clock(s.end_time)}${s.location_id ? ` (${loc.get(s.location_id) ?? ""})` : ""}`)
          .join("\n");
        cells[d] = text || null; // leave unscheduled days truly empty
      }
      return { person: m.display_name, ...cells, total: mine.reduce((n, s) => n + hoursBetween(s.start_time, s.end_time), 0) };
    }),
  };

  const name = new Map(members.map((m) => [m.id, m.display_name]));
  const list: Sheet = {
    name: "Shifts",
    columns: [
      { header: "Person", key: "person", width: 24 },
      { header: "Date", key: "date", width: 13, fmt: DATE, align: "left" },
      { header: "Weekday", key: "weekday", width: 13 },
      { header: "Start", key: "start", width: 11 },
      { header: "End", key: "end", width: 11 },
      { header: "Hours", key: "hours", width: 9, fmt: "0.0" },
      { header: "Location", key: "location", width: 22 },
    ],
    rows: shifts
      .filter((s) => name.has(s.member_id))
      .sort((a, b) => a.day.localeCompare(b.day) || (name.get(a.member_id) ?? "").localeCompare(name.get(b.member_id) ?? "") || a.start_time.localeCompare(b.start_time))
      .map((s) => ({
        person: name.get(s.member_id) ?? "",
        date: dayToDate(s.day),
        weekday: WEEKDAY[weekdayOfKey(s.day)],
        start: clock(s.start_time),
        end: clock(s.end_time),
        hours: hoursBetween(s.start_time, s.end_time),
        location: s.location_id ? loc.get(s.location_id) ?? "" : "Any",
      })),
  };
  return [grid, list];
}

