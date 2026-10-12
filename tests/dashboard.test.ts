import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboard, change, type DBooking, type DashInput } from "../src/lib/dashboard";

const tz = "America/Toronto";
const now = new Date("2026-10-14T18:00:00Z"); // Wed 2:00 PM Toronto
const iso = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`).toISOString(); // EDT

let n = 0;
const b = (day: string, start: string, end: string, extra: Partial<DBooking> = {}): DBooking => ({
  id: `b${++n}`,
  starts_at: iso(day, start),
  ends_at: iso(day, end),
  status: "completed",
  price_cents: 10000,
  deposit_cents: 0,
  payment_status: "none",
  service_id: "s1",
  service_name: "Cut",
  member_id: "m1",
  customer_id: "c1",
  customer_name: "Ada",
  source: "online",
  ...extra,
});

const base = (bookings: DBooking[], over: Partial<DashInput> = {}): DashInput => ({
  bookings,
  customers: [
    { id: "c1", name: "Ada", created_at: iso("2026-09-01", "09:00") }, // existed before the range
    { id: "c2", name: "Grace", created_at: iso("2026-10-12", "09:00") }, // new in the range
  ],
  rules: [{ member_id: "m1", weekday: 3, start_time: "09:00", end_time: "17:00" }], // Wednesdays 8h
  shifts: [],
  scheduleMode: "availability",
  memberIds: ["m1"],
  tz,
  today: "2026-10-14",
  rangeDays: 7, // Oct 8 - Oct 14, previous Oct 1 - Oct 7
  now,
  ...over,
});

test("percentage change handles zero baselines", () => {
  assert.equal(change(150, 100), 0.5);
  assert.equal(change(50, 100), -0.5);
  assert.equal(change(5, 0), null);
  assert.equal(change(0, 0), 0);
});

test("appointments, revenue and comparison with the previous period", () => {
  const d = buildDashboard(
    base([
      b("2026-10-09", "10:00", "11:00"), // current, completed $100
      b("2026-10-10", "10:00", "11:00", { price_cents: 20000, customer_id: "c2", customer_name: "Grace" }), // completed $200
      b("2026-10-11", "10:00", "11:00", { status: "cancelled" }),
      b("2026-10-12", "10:00", "11:00", { status: "no_show" }),
      b("2026-10-14", "10:00", "11:00", { status: "confirmed" }), // today, already over => delivered
      b("2026-10-14", "16:00", "17:00", { status: "confirmed" }), // later today => upcoming, not revenue
      b("2026-10-03", "10:00", "11:00"), // previous period
      b("2026-10-04", "10:00", "11:00"),
    ]),
  );
  assert.deepEqual(d.kpis.appointments, { value: 5, prev: 2 }); // cancelled excluded
  assert.deepEqual(d.kpis.revenue, { value: 100_00 + 200_00 + 100_00, prev: 200_00 });
  assert.equal(d.kpis.noShowRate.value, 1 / 4); // 1 no-show of (3 delivered + 1 no-show)
  assert.equal(d.kpis.cancelRate.value, 1 / 6); // 1 cancelled of 6 considered
  assert.equal(d.kpis.avgValue.value, 400_00 / 3);
  assert.equal(d.status.upcoming, 1);
  assert.equal(d.status.cancelled, 1);
  assert.equal(d.daily.length, 7);
  assert.equal(d.daily[0].day, "2026-10-08");
  assert.equal(d.daily[6].day, "2026-10-14");
  assert.equal(d.daily.reduce((s, x) => s + x.appointments, 0), 5);
});

test("new vs returning customers", () => {
  const d = buildDashboard(
    base([
      b("2026-10-09", "10:00", "11:00", { customer_id: "c1" }),
      b("2026-10-10", "10:00", "11:00", { customer_id: "c2", customer_name: "Grace" }),
    ]),
  );
  assert.equal(d.kpis.newCustomers.value, 1); // Grace
  assert.equal(d.kpis.uniqueCustomers, 2);
  assert.equal(d.kpis.returningShare, 0.5); // Ada existed before the range
});

test("utilization compares booked time with scheduled working time", () => {
  // Only Wed Oct 14 has hours (8h = 480 min); 2 booked hours that day.
  const d = buildDashboard(
    base([b("2026-10-14", "09:00", "10:00", { status: "confirmed" }), b("2026-10-14", "11:00", "12:00", { status: "confirmed" })]),
  );
  assert.equal(d.kpis.utilization, 120 / 480);
  assert.equal(d.staff[0].utilization, 120 / 480);
});

test("shifts mode measures capacity from the schedule instead of weekly hours", () => {
  const d = buildDashboard(
    base([b("2026-10-14", "09:00", "10:00", { status: "confirmed" })], {
      scheduleMode: "shifts",
      shifts: [{ member_id: "m1", day: "2026-10-14", start_time: "09:00", end_time: "13:00" }], // 4h
    }),
  );
  assert.equal(d.kpis.utilization, 60 / 240);
});

test("no capacity means no utilization figure (not a divide by zero)", () => {
  const d = buildDashboard(base([b("2026-10-09", "10:00", "11:00")], { rules: [] }));
  assert.equal(d.kpis.utilization, null);
});

test("top services, busiest times and top customers", () => {
  const d = buildDashboard(
    base([
      b("2026-10-09", "10:00", "11:00", { service_id: "s1", service_name: "Cut" }), // Fri 10am
      b("2026-10-09", "10:30", "11:30", { service_id: "s1", service_name: "Cut", customer_id: "c2", customer_name: "Grace", price_cents: 30000 }),
      b("2026-10-10", "14:00", "15:00", { service_id: "s2", service_name: "Colour", price_cents: 18000 }), // Sat 2pm
    ]),
  );
  assert.equal(d.services[0].name, "Cut");
  assert.equal(d.services[0].count, 2);
  assert.equal(d.services[0].revenue, 400_00);
  assert.equal(d.heatmap.cells[5][10], 2); // Friday, hour 10
  assert.equal(d.heatmap.cells[6][14], 1); // Saturday, hour 14
  assert.equal(d.heatmap.max, 2);
  assert.equal(d.heatmap.minHour, 10);
  assert.equal(d.heatmap.maxHour, 14);
  assert.equal(d.topCustomers[0].name, "Grace"); // $300 beats Ada's $100 + $180
  assert.equal(d.topCustomers[0].spend, 30000);
});

test("today's list, next up, the week ahead and items needing attention", () => {
  const d = buildDashboard(
    base([
      b("2026-10-14", "09:00", "10:00", { status: "completed" }),
      b("2026-10-14", "15:00", "16:00", { status: "confirmed" }), // next up (now = 2 PM)
      b("2026-10-14", "17:00", "18:00", { status: "cancelled" }), // not in today's list
      b("2026-10-15", "10:00", "11:00", { status: "pending_approval" }),
      b("2026-10-16", "10:00", "11:00", { status: "pending_payment" }),
      b("2026-10-16", "12:00", "13:00", { status: "confirmed" }),
    ]),
  );
  assert.equal(d.todayList.length, 2);
  assert.equal(d.nextUp?.starts_at, iso("2026-10-14", "15:00"));
  assert.equal(d.upcoming.length, 7);
  assert.equal(d.upcoming.find((x) => x.day === "2026-10-15")?.count, 1); // the pending request holds a slot
  assert.equal(d.upcoming.find((x) => x.day === "2026-10-16")?.count, 1); // pending payment isn't counted
  assert.equal(d.pendingApprovals, 1);
  assert.equal(d.awaitingPayment, 1);
});

test("an empty business produces zeros and nulls, never NaN", () => {
  const d = buildDashboard(base([], { customers: [], rules: [] }));
  assert.equal(d.kpis.appointments.value, 0);
  assert.equal(d.kpis.revenue.value, 0);
  assert.equal(d.kpis.noShowRate.value, null);
  assert.equal(d.kpis.avgValue.value, null);
  assert.equal(d.kpis.utilization, null);
  assert.equal(d.heatmap.max, 0);
  assert.deepEqual(d.services, []);
});
