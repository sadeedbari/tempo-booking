import assert from "node:assert/strict";
import { test } from "node:test";
import { copyPairs, periodDays, periodStart, shiftPeriod } from "../src/lib/schedule";
import { weekdayOfKey } from "../src/lib/format";

test("weeks start on Monday and copy from 7 days earlier", () => {
  assert.equal(periodStart("week", "2026-10-07"), "2026-10-05"); // Wed → Mon
  assert.equal(periodStart("week", "2026-10-11"), "2026-10-05"); // Sun belongs to the week before
  const pairs = copyPairs("week", "2026-10-05");
  assert.equal(pairs.length, 7);
  assert.deepEqual(pairs[0], { from: "2026-09-28", to: "2026-10-05" });
  assert.deepEqual(pairs[6], { from: "2026-10-04", to: "2026-10-11" });
});

test("month periods have the right number of days and navigate across year ends", () => {
  assert.equal(periodDays("month", "2026-02-01").length, 28);
  assert.equal(periodDays("month", "2028-02-01").length, 29);
  assert.equal(shiftPeriod("month", "2026-12-01", 1), "2027-01-01");
  assert.equal(shiftPeriod("month", "2026-01-01", -1), "2025-12-01");
});

test("month copy keeps the weekday and its position in the month", () => {
  const pairs = copyPairs("month", "2026-10-01");
  assert.equal(pairs.length, 31);
  for (const p of pairs) {
    assert.equal(weekdayOfKey(p.from), weekdayOfKey(p.to), `${p.to} ← ${p.from}`);
    assert.ok(p.from.startsWith("2026-09-"));
  }
  // Oct 1 is a Thursday = 1st Thursday; Sep 2026's 1st Thursday is Sep 3.
  assert.deepEqual(pairs[0], { from: "2026-09-03", to: "2026-10-01" });
  // Oct 29 = 5th Thursday; September has only four, so it falls back to the 4th (Sep 24).
  assert.deepEqual(pairs[28], { from: "2026-09-24", to: "2026-10-29" });
});
