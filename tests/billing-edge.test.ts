import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveStatus, isEntitled, monthlyCents, parsePlan, planFits, planLimits, trialDaysLeft, upgradeFor, lineItems,
  MAX_EXTRA_LOCATIONS, MAX_STAFF_PACKS,
} from "../src/lib/billing";

const T = new Date("2026-11-01T12:00:00.000Z");
const sub = (o: object = {}) => ({ status: "trial" as const, trial_ends_at: T.toISOString(), current_period_end: null, cancel_at_period_end: false, past_due_since: null, ...o });

test("acceptance: 3 locations + 2 packs = $55/month, 3 locations, 25 staff; 1 location, 0 packs = $15", () => {
  assert.equal(monthlyCents({ extraLocations: 2, staffPacks: 2 }), 5500);
  assert.deepEqual(planLimits({ extraLocations: 2, staffPacks: 2 }), { locations: 3, staff: 25 });
  assert.equal(monthlyCents({ extraLocations: 0, staffPacks: 0 }), 1500);
  assert.deepEqual(lineItems({ extraLocations: 2, staffPacks: 2 }, { base: "b", location: "l", pack: "p" }), [
    { price: "b", quantity: 1 }, { price: "l", quantity: 2 }, { price: "p", quantity: 2 },
  ]);
});

test("tampered quantities: padded, signed, exotic digits, booleans, huge and boundary values", () => {
  const bad = [" 5", "5 ", "+5", "-0.0", "5.0", "0x10", "1_0", "٣", "０５", "", "1000", "99999999999999999999", true, false, 1e21, -0, Number.MAX_SAFE_INTEGER, MAX_EXTRA_LOCATIONS + 1];
  for (const b of bad) {
    const r = parsePlan({ extraLocations: b, staffPacks: 0 });
    // -0 is an integer >= 0 in JS (Object.is(-0,0) is false but -0 >= 0): allow it, but it must never price below the base
    if (r) assert.ok(monthlyCents(r) >= 1500, `value ${String(b)} priced below base`);
  }
  for (const b of [" 5", "5 ", "+5", "5.0", "0x10", "1_0", "٣", "０５", "", "1000", true, false, 1e21, Number.MAX_SAFE_INTEGER, MAX_EXTRA_LOCATIONS + 1]) {
    assert.equal(parsePlan({ extraLocations: b, staffPacks: 0 }), null, `extraLocations ${String(b)} should be refused`);
  }
  assert.deepEqual(parsePlan({ extraLocations: MAX_EXTRA_LOCATIONS, staffPacks: MAX_STAFF_PACKS }), { extraLocations: 20, staffPacks: 40 });
  assert.equal(parsePlan({ extraLocations: 0, staffPacks: MAX_STAFF_PACKS + 1 }), null);
  assert.equal(parsePlan({}), null);
  // leading zeros are accepted and mean the same number
  assert.deepEqual(parsePlan({ extraLocations: "007", staffPacks: "0" }), { extraLocations: 7, staffPacks: 0 });
});

test("trial boundary: ends exactly at trial_ends_at (not entitled at that instant), entitled 1 ms before", () => {
  assert.equal(isEntitled(sub(), new Date(T.getTime() - 1)), true);
  assert.equal(isEntitled(sub(), T), false);
  assert.equal(effectiveStatus(sub(), T), "expired");
  assert.equal(trialDaysLeft(T.toISOString(), new Date(T.getTime() - 1)), 1);
  assert.equal(trialDaysLeft(T.toISOString(), T), 0);
  assert.equal(trialDaysLeft(T.toISOString(), new Date(T.getTime() + 5 * 86400_000)), 0);
});

test("downgrade exactly at the limit is allowed; one over is refused (6 staff on a 5-staff plan)", () => {
  assert.equal(planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 5 }).ok, true);
  const r = planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 6 });
  assert.equal(r.ok, false);
  assert.equal(planFits({ extraLocations: 0, staffPacks: 1 }, { locations: 1, staff: 6 }).ok, true);
  // removing the pack from {0 extra, 1 pack} with 6 staff is refused with a reason that mentions the numbers
  const rm = planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 6 });
  assert.ok(!rm.ok && /6 team members/.test(rm.reason) && /5/.test(rm.reason));
  // fewer locations than active locations
  assert.equal(planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 2, staff: 1 }).ok, false);
});

test("upgrade offer for a 6th staff member costs one pack ($5); for 11th on 1 pack costs one more", () => {
  assert.equal(upgradeFor("staff", { extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 5 }).addedCents, 500);
  assert.equal(upgradeFor("staff", { extraLocations: 0, staffPacks: 1 }, { locations: 1, staff: 10 }).plan.staffPacks, 2);
  // pending invitations can push usage several seats over: enough packs are offered
  assert.equal(upgradeFor("staff", { extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 15 }).plan.staffPacks, 3);
});

test("dates: toLocaleDateString without a time zone differs between UTC and Toronto for an evening trial end (hydration risk)", () => {
  // trial ends 14 days after sign-up at 9 pm Toronto = 01:00 UTC the next day
  const end = "2026-11-15T02:00:00.000Z";
  const utc = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "UTC" }).format(new Date(end));
  const tor = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "America/Toronto" }).format(new Date(end));
  assert.notEqual(utc, tor, "server (UTC) and browser (Toronto) would render different text: billing view.tsx / plan-banner.tsx use no timeZone");
});

test("pending invitations hold a seat in the downgrade check, exactly as the database counts them", () => {
  // 3 members + 3 invitations waiting = 6 seats: the 5-staff base plan doesn't fit, one staff pack does
  const usage = { locations: 1, staff: 3, invites: 3 };
  const base = planFits({ extraLocations: 0, staffPacks: 0 }, usage);
  assert.equal(base.ok, false);
  assert.match((base as { reason: string }).reason, /3 team members and 3 invitations waiting/);
  assert.match((base as { reason: string }).reason, /cancel invitations/);
  assert.equal(planFits({ extraLocations: 0, staffPacks: 1 }, usage).ok, true);
  // without invitations nothing changes (and the old wording is kept)
  const plain = planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 7 });
  assert.match((plain as { reason: string }).reason, /You have 7 team members but this plan includes 5/);
  assert.equal(planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 5, invites: 0 }).ok, true);
  assert.equal(planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 5, invites: 1 }).ok, false);
});
