/**
 * Subscription plan maths. Pure functions only (no database, no Stripe), so the rules are easy to test.
 * These mirror the database functions private.billing_entitled / private.billing_limits in
 * supabase/migrations/20261101000000_subscription_billing.sql: keep them in step.
 *
 * Pricing: base $15/mo = 1 location + 5 staff. Each extra location +$15/mo (and +5 staff). Each staff pack +$5/mo
 * (+5 staff, shared by the whole business). All amounts are in CAD cents and are ALWAYS computed here on the
 * server from the quantities, never taken from the browser.
 */

export const CURRENCY = "cad";
export const BASE_CENTS = 1500;
export const LOCATION_CENTS = 1500;
export const PACK_CENTS = 500;
export const STAFF_PER_LOCATION = 5;
export const STAFF_PER_PACK = 5;
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
export const TRIAL_LIMITS = { locations: 1, staff: 5 } as const;
export const MAX_EXTRA_LOCATIONS = 20;
export const MAX_STAFF_PACKS = 40;
/** Most teams one person can own. The database enforces it (private.max_owned_orgs() in the billing migration): change both. */
export const MAX_OWNED_ORGS = 3;
/** Time zone for dates when the business's own isn't known. */
export const DEFAULT_TIME_ZONE = "America/Toronto";

/** A long date ("November 15, 2026") in a fixed time zone, so the server and the browser always print the same day. */
export function formatDateLong(d: string | Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone }).format(new Date(d));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: DEFAULT_TIME_ZONE }).format(new Date(d)); // unknown zone name
  }
}

export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "expired";

/** What a business pays for beyond the base plan. */
export interface Plan {
  extraLocations: number;
  staffPacks: number;
}

/** The local copy of a business's subscription (the `subscriptions` table). */
export interface Subscription {
  org_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string;
  current_period_end: string | null;
  extra_locations: number;
  staff_packs: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  last_stripe_event_at: string | null;
  trial_reminder_sent_at: string | null;
  trial_ended_email_sent_at: string | null;
  updated_at?: string | null;
  last_reconciled_at?: string | null;
  stripe_missing_at?: string | null;
}

export interface Usage {
  /** Active locations only: a deactivated one does not use up the plan. */
  locations: number;
  /** Every membership: owners, admins and members, with or without a login, bookable or not. */
  staff: number;
  /**
   * Invitations that will add a NEW person. They reserve a seat in the database, so they count against the staff limit
   * exactly like members do (owners/admins only can see them; for everyone else this is simply left out).
   */
  invites?: number;
}

export interface Limits {
  locations: number;
  staff: number;
}

/** Whole numbers only, within range. Returns null for anything else (floats, strings, negatives, NaN, huge). */
export function parsePlan(input: { extraLocations?: unknown; staffPacks?: unknown }): Plan | null {
  const ok = (n: unknown, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
  const extraLocations = typeof input.extraLocations === "string" && /^\d{1,3}$/.test(input.extraLocations) ? Number(input.extraLocations) : input.extraLocations;
  const staffPacks = typeof input.staffPacks === "string" && /^\d{1,3}$/.test(input.staffPacks) ? Number(input.staffPacks) : input.staffPacks;
  if (!ok(extraLocations, MAX_EXTRA_LOCATIONS) || !ok(staffPacks, MAX_STAFF_PACKS)) return null;
  return { extraLocations, staffPacks };
}

/** Monthly price in cents: $15 + $15 per extra location + $5 per staff pack. */
export function monthlyCents(plan: Plan): number {
  return BASE_CENTS + plan.extraLocations * LOCATION_CENTS + plan.staffPacks * PACK_CENTS;
}

/** Locations = 1 + extra. Staff = locations x 5 + packs x 5. */
export function planLimits(plan: Plan): Limits {
  const locations = 1 + plan.extraLocations;
  return { locations, staff: locations * STAFF_PER_LOCATION + plan.staffPacks * STAFF_PER_PACK };
}

/** The limits that apply right now: the trial's fixed limits, or the paid plan's. */
export function effectiveLimits(sub: Pick<Subscription, "status" | "extra_locations" | "staff_packs">): Limits {
  if (sub.status === "trial") return { ...TRIAL_LIMITS };
  return planLimits({ extraLocations: sub.extra_locations, staffPacks: sub.staff_packs });
}

/** Does the business have an active plan right now? (Trial running, paid, or inside the payment grace period.) */
export function isEntitled(sub: Pick<Subscription, "status" | "trial_ends_at" | "current_period_end" | "cancel_at_period_end" | "past_due_since">, now = new Date()): boolean {
  const t = now.getTime();
  switch (sub.status) {
    case "trial":
      return new Date(sub.trial_ends_at).getTime() > t;
    case "active":
      // Cancelled at period end: stops 2 days after the period (slack for a late webhook).
      return !(sub.cancel_at_period_end && sub.current_period_end && new Date(sub.current_period_end).getTime() + 2 * 86_400_000 < t);
    case "past_due":
      return (sub.past_due_since ? new Date(sub.past_due_since).getTime() : t) + GRACE_DAYS * 86_400_000 > t;
    default:
      return false;
  }
}

/** The status to show people: a trial that ran out, or an unpaid plan past its grace period, reads as "expired". */
export function effectiveStatus(sub: Parameters<typeof isEntitled>[0], now = new Date()): SubscriptionStatus {
  if (isEntitled(sub, now)) return sub.status;
  if (sub.status === "trial" || sub.status === "past_due") return "expired";
  if (sub.status === "active") return "cancelled"; // cancel_at_period_end and the period is over
  return sub.status;
}

/**
 * Did this business have a free trial that has run out, and never subscribe? ("Your trial has ended" rather than the
 * plain "No active plan".) Two rows look alike once the status is "expired", so the difference is read from the data:
 *  - a trial that ran out: status "trial" past its end (not yet swept), or "expired" later by the hourly sweep, which
 *    stamps trial_ended_email_sent_at AFTER trial_ends_at (or leaves it empty while the email is still to be sent);
 *  - a team created WITHOUT a trial (a person's second team) is inserted already expired with trial_ended_email_sent_at
 *    equal to trial_ends_at (both now(), see private.organizations_start_trial), so it never reads as "ended".
 * A Stripe subscription at any point means it is not a plain ended trial (cancelled / unpaid have their own wording).
 */
export function trialEnded(
  sub: Pick<Subscription, "status" | "trial_ends_at" | "stripe_subscription_id" | "trial_ended_email_sent_at">,
  now = new Date(),
): boolean {
  if (sub.stripe_subscription_id) return false;
  if (sub.status === "trial") return new Date(sub.trial_ends_at).getTime() <= now.getTime();
  if (sub.status !== "expired") return false;
  if (!sub.trial_ended_email_sent_at) return true;
  return new Date(sub.trial_ended_email_sent_at).getTime() - new Date(sub.trial_ends_at).getTime() > 1000;
}

/** Whole days left in the trial (rounded up, never negative). */
export function trialDaysLeft(trialEndsAt: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / 86_400_000));
}

/** When the 7-day grace period after a failed payment ends. */
export function graceEndsAt(pastDueSince: string): Date {
  return new Date(new Date(pastDueSince).getTime() + GRACE_DAYS * 86_400_000);
}

/** What the app offers when something would go beyond the plan. */
export interface UpgradeOffer {
  kind: "location" | "staff";
  message: string;
  /** Extra cost per month if accepted, in cents. */
  addedCents: number;
  /** Only owners can buy; everyone else is told to ask. */
  canBuy: boolean;
  /** A trial business has no subscription yet, so it goes through Checkout instead of a one-click change. */
  needsCheckout: boolean;
  /** The plan the offer leads to (extra locations, staff packs). */
  plan: Plan;
}

export type FitResult = { ok: true } | { ok: false; reason: string };

/** Can a business that uses `usage` move to `plan`? Downgrades below current usage are refused with the reason. */
export function planFits(plan: Plan, usage: Usage): FitResult {
  const limits = planLimits(plan);
  if (usage.locations > limits.locations) {
    const n = usage.locations;
    return { ok: false, reason: `You use ${n} location${n === 1 ? "" : "s"} but this plan includes ${limits.locations}. Deactivate or delete ${n - limits.locations} location${n - limits.locations === 1 ? "" : "s"} first.` };
  }
  const seats = usage.staff + (usage.invites ?? 0);
  if (seats > limits.staff) {
    const over = seats - limits.staff;
    const inv = usage.invites ?? 0;
    const have = inv > 0
      ? `${usage.staff} team member${usage.staff === 1 ? "" : "s"} and ${inv} invitation${inv === 1 ? "" : "s"} waiting`
      : `${usage.staff} team members`;
    return { ok: false, reason: `You have ${have} but this plan includes ${limits.staff}. Remove ${over} team member${over === 1 ? "" : "s"}${inv > 0 ? " or cancel invitations" : ""} first, or keep more staff packs.` };
  }
  return { ok: true };
}

/**
 * What a business needs to add one more of something, as the smallest upgrade that makes room.
 * `kind: "location"` adds a location (which also brings 5 staff); `kind: "staff"` adds staff packs until one more fits.
 */
export function upgradeFor(kind: "location" | "staff", plan: Plan, usage: Usage): { plan: Plan; addedCents: number; message: string } {
  if (kind === "location") {
    const next = { ...plan, extraLocations: plan.extraLocations + 1 };
    return { plan: next, addedCents: LOCATION_CENTS, message: `Your plan includes ${planLimits(plan).locations} location${planLimits(plan).locations === 1 ? "" : "s"}. Add 1 more for ${money(LOCATION_CENTS)}/month (it includes 5 more staff).` };
  }
  let packs = plan.staffPacks;
  while (planLimits({ ...plan, staffPacks: packs }).staff < usage.staff + 1) packs += 1;
  const added = packs - plan.staffPacks;
  const next = { ...plan, staffPacks: packs };
  return { plan: next, addedCents: added * PACK_CENTS, message: `Your plan includes ${planLimits(plan).staff} staff. Add ${added * STAFF_PER_PACK} more for ${money(added * PACK_CENTS)}/month.` };
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

/** The three Stripe price ids the plan is made of (from environment variables). */
export interface PriceIds {
  base: string;
  location: string;
  pack: string;
}

export interface LineItem {
  price: string;
  quantity: number;
}

/** Stripe line items for a plan. Items with a quantity of 0 are left out (Stripe rejects them in Checkout). */
export function lineItems(plan: Plan, prices: PriceIds): LineItem[] {
  const items: LineItem[] = [{ price: prices.base, quantity: 1 }];
  if (plan.extraLocations > 0) items.push({ price: prices.location, quantity: plan.extraLocations });
  if (plan.staffPacks > 0) items.push({ price: prices.pack, quantity: plan.staffPacks });
  return items;
}

/** Reads the plan back out of a Stripe subscription's items. Unknown prices are ignored. */
export function planFromItems(items: { price: string; quantity: number }[], prices: PriceIds): Plan {
  let extraLocations = 0;
  let staffPacks = 0;
  for (const i of items) {
    if (i.price === prices.location) extraLocations += i.quantity;
    else if (i.price === prices.pack) staffPacks += i.quantity;
  }
  return { extraLocations, staffPacks };
}

/**
 * Which Stripe subscription status means what for Tempo. Returns null when nothing should change: an "incomplete"
 * subscription (first payment not made yet) must not give a trial business the grace period of a paying one.
 */
export function statusFromStripe(stripeStatus: string): SubscriptionStatus | null {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "cancelled";
    case "unpaid": // retries are over
    case "incomplete_expired": // the first payment never completed
    case "paused":
      return "expired";
    default:
      return null;
  }
}
