import test from "node:test";
import assert from "node:assert/strict";
import { trialEnded } from "../src/lib/billing";

// D-023: "Your trial has ended." for a trial that ran out; "No active plan." for every other no-plan case.
const NOW = new Date("2026-11-20T12:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const row = (o: object = {}) => ({ status: "trial" as const, trial_ends_at: day(-1), stripe_subscription_id: null as string | null, trial_ended_email_sent_at: null as string | null, ...o });

test("a trial past its end that was not swept yet has ended", () => {
  assert.equal(trialEnded(row(), NOW), true);
});

test("a trial still running has not ended", () => {
  assert.equal(trialEnded(row({ trial_ends_at: day(3) }), NOW), false);
});

test("a swept trial (status expired, email stamped after the end or still to send) has ended", () => {
  assert.equal(trialEnded(row({ status: "expired" }), NOW), true); // email not sent yet
  assert.equal(trialEnded(row({ status: "expired", trial_ended_email_sent_at: day(-0.9) }), NOW), true); // stamped by the sweep later
});

test("a second team created without a trial (expired, email stamped at the same instant as the end) is NOT 'ended'", () => {
  const t = day(-5);
  assert.equal(trialEnded(row({ status: "expired", trial_ends_at: t, trial_ended_email_sent_at: t }), NOW), false);
});

test("anything that ever had a Stripe subscription is not a plain ended trial", () => {
  assert.equal(trialEnded(row({ status: "expired", stripe_subscription_id: "sub_1" }), NOW), false); // unpaid past the grace period
  assert.equal(trialEnded(row({ status: "trial", stripe_subscription_id: "sub_1" }), NOW), false);
});

test("cancelled, active and past_due rows are never 'ended trial'", () => {
  for (const status of ["cancelled", "active", "past_due"] as const) assert.equal(trialEnded(row({ status }), NOW), false);
});
