import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { workbookBuffer, dayToDate, type Sheet } from "../src/lib/excel";
import { clock, customerSheets, homeSheets, scheduleSheets } from "../src/lib/exports";
import { buildDashboard, type DBooking } from "../src/lib/dashboard";
import type { Membership, Shift } from "../src/lib/types";

const read = async (sheets: Sheet[]) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await workbookBuffer(sheets)) as never);
  return wb;
};
const names = (wb: ExcelJS.Workbook) => wb.worksheets.map((w) => w.name);

const tz = "America/Toronto";
const member = (id: string, name: string): Membership => ({ id, org_id: "o", user_id: id, role: "member", display_name: name, title: null, color: "#007AFF", bookable: true, created_at: "2026-01-01T00:00:00Z" });
const members = [member("m1", "Maya Chen"), member("m2", "Jordan Lee")];

test("writes a tidy workbook: header styling, frozen header, number formats, real dates", async () => {
  const wb = await read([
    {
      name: "Report",
      title: "Title here",
      subtitle: "Sub",
      columns: [
        { header: "Day", key: "day", fmt: "yyyy-mm-dd" },
        { header: "Amount", key: "amt", fmt: "#,##0.00" },
        { header: "Share", key: "share", fmt: "0.0%" },
        { header: "Text", key: "t" },
      ],
      rows: [
        { day: dayToDate("2026-10-14"), amt: 1234.5, share: 0.255, t: "hello" },
        { day: dayToDate("2026-10-15"), amt: { v: 99, fmt: "0" }, share: null, t: "x" },
      ],
    },
  ]);
  const ws = wb.getWorksheet("Report")!;
  assert.equal(ws.getCell("A1").value, "Title here");
  assert.equal(ws.getCell("A1").font?.bold, true);
  // title + subtitle + blank line, so the table header is row 4
  assert.equal(ws.getCell("A4").value, "Day");
  assert.equal(ws.getCell("A4").font?.bold, true);
  assert.equal(ws.views[0].state, "frozen");
  assert.equal((ws.views[0] as { ySplit?: number }).ySplit, 4);
  const d = ws.getCell("A5").value as Date;
  assert.equal(d.toISOString().slice(0, 10), "2026-10-14"); // exactly that calendar day, no time-zone drift
  assert.equal(ws.getCell("B5").value, 1234.5);
  assert.equal(ws.getCell("B5").numFmt, "#,##0.00");
  assert.equal(ws.getCell("C5").numFmt, "0.0%");
  assert.equal(ws.getCell("B6").numFmt, "0"); // per-cell format overrides the column's
  assert.equal(ws.getCell("C6").value, null);
});

test("text that looks like a formula is stored as plain text, never executed", async () => {
  const evil = '=HYPERLINK("http://evil.example","click")';
  const wb = await read([{ name: "T", columns: [{ header: "Name", key: "n" }], rows: [{ n: evil }, { n: "+1 555" }, { n: "@SUM(A1)" }] }]);
  const ws = wb.getWorksheet("T")!;
  for (const [addr, text] of [["A2", evil], ["A3", "+1 555"], ["A4", "@SUM(A1)"]] as const) {
    assert.equal(ws.getCell(addr).type, ExcelJS.ValueType.String, addr);
    assert.equal(ws.getCell(addr).value, text);
  }
});

test("sheet names are made safe for Excel", async () => {
  const wb = await read([{ name: "Bad/Name: [x]?*", columns: [{ header: "A", key: "a" }], rows: [] }, { name: "x".repeat(50), columns: [{ header: "A", key: "a" }], rows: [] }]);
  assert.equal(wb.worksheets[0].name, "Bad Name   x");
  assert.equal(wb.worksheets[1].name.length, 31);
});

test("clock() formats times for people", () => {
  assert.equal(clock("09:00"), "9:00 AM");
  assert.equal(clock("13:30:00"), "1:30 PM");
  assert.equal(clock("00:15"), "12:15 AM");
  assert.equal(clock("12:00"), "12:00 PM");
});

const iso = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`).toISOString();
let n = 0;
const bk = (day: string, s: string, e: string, extra: Partial<DBooking> = {}): DBooking => ({
  id: `b${++n}`, starts_at: iso(day, s), ends_at: iso(day, e), status: "completed", price_cents: 12050, deposit_cents: 2000, payment_status: "paid",
  service_id: "s1", service_name: "Cut", member_id: "m1", customer_id: "c1", customer_name: "Ada Lovelace", source: "online", ...extra,
});
const dash = (bookings: DBooking[]) =>
  buildDashboard({
    bookings,
    customers: [{ id: "c1", name: "Ada Lovelace", created_at: iso("2026-09-01", "09:00") }],
    rules: [{ member_id: "m1", weekday: 3, start_time: "09:00", end_time: "17:00" }],
    shifts: [], scheduleMode: "availability", memberIds: ["m1"], tz, today: "2026-10-14", rangeDays: 7, now: new Date("2026-10-14T18:00:00Z"),
  });

test("home export (owner): all sheets, money in dollars, bookings listed with customers", async () => {
  const bookings = [bk("2026-10-13", "10:00", "11:00"), bk("2026-10-09", "14:00", "15:00", { status: "no_show", customer_name: "Grace Hopper" })];
  const wb = await read(homeSheets({ d: dash(bookings), bookings, members, isAdmin: true, tz, currency: "CAD" }));
  assert.deepEqual(names(wb), ["Summary", "Daily", "Services", "Team", "Busiest times", "Best customers", "Bookings"]);

  const summary = wb.getWorksheet("Summary")!;
  assert.match(String(summary.getCell("A2").value), /2026-10-08 to 2026-10-14/);
  const header = [1, 2, 3, 4].map((c) => summary.getCell(4, c).value);
  assert.deepEqual(header, ["Measure", "This period", "Previous period", "Change"]);
  const find = (label: string) => summary.getRows(5, 12)!.find((r) => r.getCell(1).value === label)!;
  assert.equal(find("Appointments").getCell(2).value, 2);
  assert.equal(find("Revenue (CAD)").getCell(2).value, 120.5); // 12050 cents shown as dollars
  assert.equal(find("Revenue (CAD)").getCell(2).numFmt, "#,##0.00");

  const daily = wb.getWorksheet("Daily")!;
  assert.equal(daily.rowCount, 1 + 7); // header + 7 days
  assert.equal((daily.getCell("A2").value as Date).toISOString().slice(0, 10), "2026-10-08");

  const bookingsSheet = wb.getWorksheet("Bookings")!;
  const headers = bookingsSheet.getRow(4).values as unknown[];
  assert.ok(headers.includes("Customer") && headers.includes("Price (CAD)"));
  assert.equal(bookingsSheet.rowCount, 4 + 2);
  const row = bookingsSheet.getRow(5).values as unknown[]; // first booking in the period (Oct 9)
  assert.ok(row.includes("Grace Hopper") && row.includes("No-show") && row.includes("Maya Chen"));
});

test("home export (staff): no revenue, customers or team sheet", async () => {
  const bookings = [bk("2026-10-13", "10:00", "11:00")];
  const wb = await read(homeSheets({ d: dash(bookings), bookings, members, isAdmin: false, tz, currency: "CAD" }));
  assert.deepEqual(names(wb), ["Summary", "Daily", "Services", "Busiest times", "Bookings"]);
  const text = JSON.stringify(wb.worksheets.map((w) => w.getSheetValues()));
  assert.ok(!/Revenue|Price|Customer|Deposit/.test(text), "staff export leaked a financial or customer column");
});

test("customers export: contact details, consent, visits and spend", async () => {
  const wb = await read(
    customerSheets({
      customers: [
        { id: "c1", name: "Ada Lovelace", email: "ada@example.com", phone: "+14165551234", notes: "Prefers mornings", sms_consent_at: iso("2026-10-01", "12:00"), created_at: iso("2026-09-01", "09:00") },
        { id: "c2", name: "Grace Hopper", email: "grace@example.com", phone: null, notes: null, sms_consent_at: null, created_at: iso("2026-09-02", "09:00") },
      ],
      stats: { c1: { visits: 3, last: iso("2026-10-10", "10:00"), spent: 36150 } },
      tz,
      currency: "CAD",
    }),
  );
  const ws = wb.getWorksheet("Customers")!;
  assert.equal(ws.rowCount, 3);
  const ada = ws.getRow(2);
  assert.equal(ada.getCell(1).value, "Ada Lovelace");
  assert.equal(ada.getCell(3).value, "+14165551234");
  assert.equal(ada.getCell(4).value, "Yes");
  assert.equal((ada.getCell(5).value as Date).toISOString().slice(0, 10), "2026-10-01");
  assert.equal(ada.getCell(7).value, 3);
  assert.equal((ada.getCell(8).value as Date).toISOString().slice(0, 10), "2026-10-10");
  assert.equal(ada.getCell(9).value, 361.5);
  assert.equal(ada.getCell(10).value, "Prefers mornings");
  const grace = ws.getRow(3);
  assert.equal(grace.getCell(4).value, "No");
  assert.equal(grace.getCell(5).value, null);
  assert.equal(grace.getCell(7).value, 0);
  assert.equal(grace.getCell(9).value, 0);
});

test("schedule export: grid of shifts per person per day, plus a flat shift list", async () => {
  const shifts: Shift[] = [
    { id: "1", org_id: "o", member_id: "m1", location_id: null, day: "2026-10-12", start_time: "09:00", end_time: "12:00" },
    { id: "2", org_id: "o", member_id: "m1", location_id: "l1", day: "2026-10-12", start_time: "13:00", end_time: "17:00" },
    { id: "3", org_id: "o", member_id: "m2", location_id: null, day: "2026-10-13", start_time: "10:00", end_time: "18:00" },
  ];
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
  const wb = await read(scheduleSheets({ days, shifts, members, locations: [{ id: "l1", org_id: "o", name: "Queen West", address: null, phone: null, active: true, position: 0 }], period: "week" }));
  assert.deepEqual(names(wb), ["Week", "Shifts"]);

  const grid = wb.getWorksheet("Week")!;
  assert.equal(grid.getCell("A4").value, "Person");
  assert.equal(grid.getCell("B4").value, "Mon 10-12");
  assert.equal(grid.getCell("H4").value, "Sun 10-18");
  assert.equal(grid.getCell("I4").value, "Total hours");
  assert.equal(grid.getCell("A5").value, "Maya Chen");
  assert.equal(grid.getCell("B5").value, "9:00 AM - 12:00 PM\n1:00 PM - 5:00 PM (Queen West)");
  assert.equal(grid.getCell("C5").value, null); // not scheduled Tuesday
  assert.equal(grid.getCell("I5").value, 7); // 3h + 4h
  assert.equal(grid.getCell("I6").value, 8); // Jordan

  const list = wb.getWorksheet("Shifts")!;
  assert.equal(list.rowCount, 4);
  assert.equal(list.getRow(2).getCell(1).value, "Jordan Lee".localeCompare("Maya Chen") < 0 && false ? "" : "Maya Chen"); // sorted by date, then person
  assert.equal(list.getRow(2).getCell(7).value, "Any");
  assert.equal(list.getRow(3).getCell(7).value, "Queen West");
  assert.equal(list.getRow(3).getCell(6).value, 4);
  assert.equal(list.getRow(4).getCell(3).value, "Tuesday");
});
