import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveLimits, effectiveStatus, graceEndsAt, isEntitled, lineItems, monthlyCents, parsePlan, planFits, planFromItems, planLimits,
  statusFromStripe, trialDaysLeft, upgradeFor, type Subscription,
} from "../src/lib/billing";

const DAY = 86_400_000;
const now = new Date("2026-11-01T12:00:00Z");
const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString();
const sub = (o: Partial<Subscription> = {}): Subscription => ({
  org_id: "o", status: "trial", trial_ends_at: iso(14), current_period_end: null, extra_locations: 0, staff_packs: 0, stripe_customer_id: null,
  stripe_subscription_id: null, cancel_at_period_end: false, past_due_since: null, last_stripe_event_at: null, trial_reminder_sent_at: null,
  trial_ended_email_sent_at: null, ...o,
});

test("price: $15 base, +$15 per extra location, +$5 per staff pack (the spec's examples)", () => {
  assert.equal(monthlyCents({ extraLocations: 0, staffPacks: 0 }), 1500);
  assert.equal(monthlyCents({ extraLocations: 1, staffPacks: 0 }), 3000); // 2 locations / 10 staff
  assert.equal(monthlyCents({ extraLocations: 1, staffPacks: 1 }), 3500); // 2 locations / 15 staff
  assert.equal(monthlyCents({ extraLocations: 2, staffPacks: 2 }), 5500); // 3 locations, 25 staff
});

test("limits: locations = 1 + extra, staff = locations x 5 + packs x 5", () => {
  assert.deepEqual(planLimits({ extraLocations: 0, staffPacks: 0 }), { locations: 1, staff: 5 });
  assert.deepEqual(planLimits({ extraLocations: 1, staffPacks: 0 }), { locations: 2, staff: 10 });
  assert.deepEqual(planLimits({ extraLocations: 1, staffPacks: 1 }), { locations: 2, staff: 15 });
  assert.deepEqual(planLimits({ extraLocations: 2, staffPacks: 2 }), { locations: 3, staff: 25 });
});

test("the trial is always 1 location and 5 staff, whatever the stored plan says", () => {
  assert.deepEqual(effectiveLimits(sub({ status: "trial", extra_locations: 5 })), { locations: 1, staff: 5 });
  assert.deepEqual(effectiveLimits(sub({ status: "active", extra_locations: 1, staff_packs: 1 })), { locations: 2, staff: 15 });
});

test("quantities from the browser are validated: whole numbers in range only", () => {
  assert.deepEqual(parsePlan({ extraLocations: 2, staffPacks: 3 }), { extraLocations: 2, staffPacks: 3 });
  assert.deepEqual(parsePlan({ extraLocations: "2", staffPacks: "0" }), { extraLocations: 2, staffPacks: 0 });
  for (const bad of [-1, 1.5, NaN, Infinity, "1e3", "-2", "abc", null, undefined, {}, 9999, [1]]) {
    assert.equal(parsePlan({ extraLocations: bad, staffPacks: 0 }), null, `extraLocations ${String(bad)}`);
    assert.equal(parsePlan({ extraLocations: 0, staffPacks: bad }), null, `staffPacks ${String(bad)}`);
  }
});

test("a downgrade is refused while usage is above the new limits, with a reason", () => {
  const six = planFits({ extraLocations: 0, staffPacks: 0 }, { locations: 1, staff: 6 });
  assert.equal(six.ok, false);
  assert.match(!six.ok ? six.reason : "", /6 team members.*includes 5/);
  const locs = planFits({ extraLocations: 0, staffPacks: 1 }, { locations: 2, staff: 3 });
  assert.equal(locs.ok, false);
  assert.match(!locs.ok ? locs.reason : "", /2 locations.*includes 1/);
  assert.equal(planFits({ extraLocations: 0, staffPacks: 1 }, { locations: 1, staff: 10 }).ok, true);
  assert.equal(planFits({ extraLocations: 1, staffPacks: 0 }, { locations: 2, staff: 10 }).ok, true);
});

test("entitlement: trial runs until its end date", () => {
  assert.equal(isEntitled(sub({ trial_ends_at: iso(1) }), now), true);
  assert.equal(isEntitled(sub({ trial_ends_at: iso(-1) }), now), false);
  assert.equal(effectiveStatus(sub({ trial_ends_at: iso(-1) }), now), "expired");
  assert.equal(trialDaysLeft(iso(13.2), now), 14);
  assert.equal(trialDaysLeft(iso(-3), now), 0);
});

test("entitlement: active; cancelled-at-period-end continues until the period end (+2 days slack); cancelled/expired never", () => {
  assert.equal(isEntitled(sub({ status: "active" }), now), true);
  assert.equal(isEntitled(sub({ status: "active", cancel_at_period_end: true, current_period_end: iso(5) }), now), true);
  assert.equal(isEntitled(sub({ status: "active", cancel_at_period_end: true, current_period_end: iso(-1) }), now), true);
  assert.equal(isEntitled(sub({ status: "active", cancel_at_period_end: true, current_period_end: iso(-3) }), now), false);
  assert.equal(isEntitled(sub({ status: "cancelled" }), now), false);
  assert.equal(isEntitled(sub({ status: "expired" }), now), false);
});

test("entitlement: failed payment gives 7 days of grace, then stops", () => {
  assert.equal(isEntitled(sub({ status: "past_due", past_due_since: iso(-6) }), now), true);
  assert.equal(isEntitled(sub({ status: "past_due", past_due_since: iso(-8) }), now), false);
  assert.equal(effectiveStatus(sub({ status: "past_due", past_due_since: iso(-8) }), now), "expired");
  assert.equal(graceEndsAt(iso(-2)).getTime(), now.getTime() + 5 * DAY);
});

test("line items: base always, extras only when above zero, from our price ids", () => {
  const prices = { base: "p_base", location: "p_loc", pack: "p_pack" };
  assert.deepEqual(lineItems({ extraLocations: 0, staffPacks: 0 }, prices), [{ price: "p_base", quantity: 1 }]);
  assert.deepEqual(lineItems({ extraLocations: 2, staffPacks: 3 }, prices), [{ price: "p_base", quantity: 1 }, { price: "p_loc", quantity: 2 }, { price: "p_pack", quantity: 3 }]);
  assert.deepEqual(planFromItems([{ price: "p_base", quantity: 1 }, { price: "p_loc", quantity: 2 }, { price: "other", quantity: 9 }], prices), { extraLocations: 2, staffPacks: 0 });
});

test("upgrade offers: the smallest add-on that makes room", () => {
  const base = { extraLocations: 0, staffPacks: 0 };
  const staff = upgradeFor("staff", base, { locations: 1, staff: 5 });
  assert.deepEqual(staff.plan, { extraLocations: 0, staffPacks: 1 });
  assert.equal(staff.addedCents, 500);
  assert.match(staff.message, /includes 5 staff.*\$5\/month/);
  const loc = upgradeFor("location", base, { locations: 1, staff: 2 });
  assert.deepEqual(loc.plan, { extraLocations: 1, staffPacks: 0 });
  assert.equal(loc.addedCents, 1500);
});

test("Stripe statuses map to ours; an incomplete first payment changes nothing", () => {
  assert.equal(statusFromStripe("active"), "active");
  assert.equal(statusFromStripe("past_due"), "past_due");
  assert.equal(statusFromStripe("canceled"), "cancelled");
  assert.equal(statusFromStripe("unpaid"), "expired");
  assert.equal(statusFromStripe("incomplete"), null);
});
