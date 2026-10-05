import assert from "node:assert/strict";
import { test } from "node:test";
import { slotsForDay } from "../src/lib/slots";

const base = {
  timeZone: "America/Toronto",
  durationMinutes: 30,
  bufferAfterMinutes: 0,
  intervalMinutes: 30,
  minNoticeMinutes: 0,
  maxAdvanceDays: 60,
  memberIds: ["a"],
  rules: [{ member_id: "a", weekday: 1, start_time: "09:00", end_time: "11:00" }],
  busy: [],
  now: new Date("2026-10-04T00:00:00Z"),
};

test("generates slots in the team's time zone (EST after DST ends)", () => {
  const r = slotsForDay("2026-11-02", base);
  assert.deepEqual(r.map((s) => s.start), [
    "2026-11-02T14:00:00.000Z",
    "2026-11-02T14:30:00.000Z",
    "2026-11-02T15:00:00.000Z",
    "2026-11-02T15:30:00.000Z",
  ]);
});

test("respects EDT before DST ends", () => {
  const r = slotsForDay("2026-10-05", base);
  assert.equal(r[0].start, "2026-10-05T13:00:00.000Z");
});

test("removes busy times including buffer", () => {
  const r = slotsForDay("2026-11-02", {
    ...base,
    bufferAfterMinutes: 15,
    busy: [{ member_id: "a", starts_at: "2026-11-02T15:00:00Z", ends_at: "2026-11-02T15:30:00Z" }],
  });
  // 9:30 slot would run until 10:15 with buffer → clashes with 10:00 booking.
  assert.deepEqual(r.map((s) => s.start), ["2026-11-02T14:00:00.000Z", "2026-11-02T15:30:00.000Z"]);
});

test("honours minimum notice and booking window", () => {
  const now = new Date("2026-11-02T14:10:00Z");
  const r = slotsForDay("2026-11-02", { ...base, now, minNoticeMinutes: 60 });
  assert.equal(r[0].start, "2026-11-02T15:30:00.000Z");
  assert.equal(slotsForDay("2027-03-01", base).length, 0);
});

test("merges staff availability", () => {
  const r = slotsForDay("2026-11-02", {
    ...base,
    memberIds: ["a", "b"],
    rules: [...base.rules, { member_id: "b", weekday: 1, start_time: "10:30", end_time: "11:30" }],
  });
  const at1030 = r.find((s) => s.start === "2026-11-02T15:30:00.000Z");
  assert.deepEqual(at1030?.memberIds.sort(), ["a", "b"]);
  assert.equal(r.at(-1)?.start, "2026-11-02T16:00:00.000Z");
});

test("shifts replace weekly rules and respect the chosen location", () => {
  const shifts = [
    { member_id: "a", day: "2026-11-03", start_time: "13:00", end_time: "14:00", location_id: "north" },
    { member_id: "a", day: "2026-11-03", start_time: "15:00", end_time: "16:00", location_id: null },
  ];
  // Tuesday has no weekly rule, so only the shifts can produce slots.
  const north = slotsForDay("2026-11-03", { ...base, shifts, locationId: "north" });
  assert.deepEqual(north.map((s) => s.start), [
    "2026-11-03T18:00:00.000Z", "2026-11-03T18:30:00.000Z", "2026-11-03T20:00:00.000Z", "2026-11-03T20:30:00.000Z",
  ]);
  const south = slotsForDay("2026-11-03", { ...base, shifts, locationId: "south" });
  assert.deepEqual(south.map((s) => s.start), ["2026-11-03T20:00:00.000Z", "2026-11-03T20:30:00.000Z"]);
  // A day with no shift offers nothing, even where the weekly rule would have matched (Monday).
  assert.deepEqual(slotsForDay("2026-11-02", { ...base, shifts }), []);
});
