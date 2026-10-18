import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, features } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/messaging";
import {
  GRACE_DAYS, formatDateLong, graceEndsAt, lineItems, monthlyCents, money, planFits, planFromItems,
  planLimits, statusFromStripe, trialDaysLeft, upgradeFor,
  type Plan, type PriceIds, type Subscription, type UpgradeOffer, type Usage,
} from "@/lib/billing";

/** The three Stripe price ids, or null when billing isn't configured on this server. */
export function priceIds(): PriceIds | null {
  if (!env.stripePriceBase || !env.stripePriceLocation || !env.stripePricePack) return null;
  return { base: env.stripePriceBase, location: env.stripePriceLocation, pack: env.stripePricePack };
}

/* ───────────────────────────── Reading ───────────────────────────── */

/** What a business uses now. Invitations that will add a NEW person count as taken seats. */
export async function getUsage(supabase: SupabaseClient, orgId: string): Promise<Usage & { pendingInvites: number }> {
  const [locs, staff, invites] = await Promise.all([
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
    supabase.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    // Only owners/admins can read invitations; for everyone else this is simply 0 (the database still enforces the limit).
    supabase.from("invitations").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("accepted_at", null).is("member_id", null).gt("expires_at", new Date().toISOString()),
  ]);
  return { locations: locs.count ?? 0, staff: staff.count ?? 0, pendingInvites: invites.count ?? 0 };
}

/**
 * The usage that counts against the plan: pending invitations hold a seat, exactly as the database counts them
 * (private.invitations_limit_guard / memberships_limit_guard), so the meter, the downgrade check and the database agree.
 */
export function seatUsage(u: Usage & { pendingInvites: number }): Usage {
  return { locations: u.locations, staff: u.staff, invites: u.pendingInvites };
}

/** The owner's full subscription row (RLS only lets owners read it). */
export async function getSubscription(supabase: SupabaseClient, orgId: string): Promise<Subscription | null> {
  const { data } = await supabase.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle();
  return (data as Subscription | null) ?? null;
}

/** The summary any team member can see (no Stripe ids). */
export interface BillingStatus {
  status: Subscription["status"];
  entitled: boolean;
  trial_ends_at: string | null; // owners only (null for everyone else, who also see past_due as active)
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  max_locations: number;
  max_staff: number;
}
export async function getBillingStatus(supabase: SupabaseClient, orgId: string): Promise<BillingStatus | null> {
  const { data } = await supabase.rpc("billing_status", { p_org: orgId });
  return (data as BillingStatus | null) ?? null;
}

/** The plain-words message when something is refused because the plan isn't active (owners can fix it, others ask the owner). */
export function planInactiveMessage(isOwner: boolean): string {
  return isOwner
    ? "Your subscription isn't active, so changes are turned off. You can still view and export your data. Subscribe on the Billing page to switch everything back on."
    : "This business's subscription isn't active, so changes are turned off. Ask the account owner to subscribe on the Billing page.";
}

/** Null when the business has an active plan, otherwise the message to show. Used by actions that change something. */
export async function planBlockMessage(supabase: SupabaseClient, orgId: string, isOwner: boolean): Promise<string | null> {
  const status = await getBillingStatus(supabase, orgId);
  return status && !status.entitled ? planInactiveMessage(isOwner) : null;
}

export type Capacity =
  | { ok: true }
  | { ok: false; error: string; upgrade?: UpgradeOffer };

/**
 * Is there room for one more location or team member? The database enforces the same limits (so a direct API call
 * can't get around this); this check gives people the plain-words explanation and the one-click upgrade.
 * `reserve` = extra seats already spoken for (e.g. pending invitations).
 */
export async function checkCapacity(supabase: SupabaseClient, orgId: string, kind: "location" | "staff", isOwner: boolean): Promise<Capacity> {
  const status = await getBillingStatus(supabase, orgId);
  if (!status) return { ok: true }; // not readable: leave it to the database
  if (!status.entitled) {
    return { ok: false, error: isOwner ? "Your subscription isn't active, so nothing can be added. Subscribe on the Billing page." : "This business's subscription isn't active. Ask the account owner to subscribe on the Billing page." };
  }
  const usage = await getUsage(supabase, orgId);
  const used = kind === "location" ? usage.locations : usage.staff + usage.pendingInvites;
  const max = kind === "location" ? status.max_locations : status.max_staff;
  if (used + 1 <= max) return { ok: true };

  // The plan the business is on right now (a trial's limits are 1 location / 5 staff, which is a base plan).
  const plan: Plan = status.status === "trial"
    ? { extraLocations: 0, staffPacks: 0 }
    : { extraLocations: Math.max(0, status.max_locations - 1), staffPacks: Math.max(0, (status.max_staff - status.max_locations * 5) / 5) };
  const offer = upgradeFor(kind, plan, { locations: usage.locations, staff: usage.staff + usage.pendingInvites });
  const message = isOwner ? offer.message : `${offer.message.split(" Add ")[0]} Ask the account owner to add more on the Billing page.`;
  return {
    ok: false,
    error: message,
    upgrade: { kind, message, addedCents: offer.addedCents, canBuy: isOwner, needsCheckout: status.status === "trial" || status.status === "expired", plan: offer.plan },
  };
}

/* ───────────────────────────── Stripe customer, Checkout, Portal ───────────────────────────── */

/**
 * An error whose message is safe and meant for the person using the page. Anything else thrown on the billing paths
 * (Stripe SDK errors can contain key hints, price ids or request ids) is logged on the server and replaced by a fixed
 * friendly message before it reaches the browser (see the billing actions).
 */
export class BillingUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingUserError";
  }
}

/**
 * Stripe still has a live subscription for this business that Tempo's own copy doesn't treat as paying (for example an
 * unpaid invoice past the grace period). `needsPortal` = the owner has to settle it in the Stripe Customer Portal.
 */
export class LiveSubscriptionError extends BillingUserError {
  constructor(message: string, readonly needsPortal: boolean) {
    super(message);
    this.name = "LiveSubscriptionError";
  }
}

export const PORTAL_MESSAGE = "Your subscription still exists at Stripe but has an unpaid invoice, so it can't be changed or started again here. Open Manage billing to pay it or update your card. Your plan switches back on as soon as the payment goes through.";

function requireBilling() {
  const stripe = getStripe();
  const prices = priceIds();
  if (!stripe || !prices || !features.billing) throw new BillingUserError("Billing isn't set up on this server yet.");
  return { stripe, prices };
}

/** Stripe subscription states that still bill (or may bill) the customer. */
const LIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);
export const isLiveStripeStatus = (s: string) => LIVE_STRIPE_STATUSES.has(s);

const isMissing = (e: unknown) => (e as { code?: string; statusCode?: number })?.code === "resource_missing" || (e as { statusCode?: number })?.statusCode === 404;

/** The Stripe customer for a business, created once and remembered. */
async function ensureCustomer(stripe: Stripe, org: { id: string; name: string }, email: string | undefined, sub: Subscription): Promise<string> {
  if (sub.stripe_customer_id) return sub.stripe_customer_id;
  // One customer per business even if two tabs race: the idempotency key makes Stripe return the same customer.
  const customer = await stripe.customers.create(
    { name: org.name, ...(email ? { email } : {}), metadata: { org_id: org.id } },
    { idempotencyKey: `tempo-customer-${org.id}` },
  );
  const admin = createAdminClient();
  // Two tabs at once: the first writer wins, the other uses that customer.
  const { data } = await admin.from("subscriptions").update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() }).eq("org_id", org.id).is("stripe_customer_id", null).select("stripe_customer_id");
  if (data?.length) return customer.id;
  const { data: row } = await admin.from("subscriptions").select("stripe_customer_id").eq("org_id", org.id).single();
  return row!.stripe_customer_id as string;
}

/** True when Stripe still has a live subscription we should change instead of starting a new one (our local copy). */
export function hasLiveSubscription(sub: Pick<Subscription, "status" | "stripe_subscription_id">) {
  return Boolean(sub.stripe_subscription_id) && (sub.status === "active" || sub.status === "past_due");
}

/** A subscription that still bills this Stripe customer, if any. Asks Stripe: our local row can be behind. */
export async function findLiveStripeSubscription(stripe: Stripe, customerId: string): Promise<Stripe.Subscription | null> {
  const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  return list.data.find((s) => isLiveStripeStatus(s.status)) ?? null;
}

/** A Stripe Checkout page for a new subscription. The amounts come from our price ids and the validated counts only. */
export async function createCheckoutUrl(org: { id: string; name: string; slug: string }, sub: Subscription, plan: Plan, email: string | undefined): Promise<string> {
  const { stripe, prices } = requireBilling();
  const customer = await ensureCustomer(stripe, org, email, sub);

  // Never start a second subscription: if Stripe already has a live one for this customer (our copy may be behind),
  // bring our copy up to date and send the owner to change it instead.
  const live = await findLiveStripeSubscription(stripe, customer);
  if (live) {
    await applyStripeSubscription(live, { orgHint: org.id, eventAt: nowSeconds() });
    // Unpaid / past due / paused: the owner can't "change" or "start" anything until the invoice is settled, and the only
    // place to do that is the Stripe Customer Portal (S-015). A healthy one just needs a page refresh.
    if (live.status !== "active" && live.status !== "trialing") throw new LiveSubscriptionError(PORTAL_MESSAGE, true);
    throw new LiveSubscriptionError("You already have a subscription. Refresh this page to see it, then use Change plan.", false);
  }

  const back = `${env.appUrl}/o/${encodeURIComponent(org.slug)}/settings/billing`;
  // The same business choosing the same plan within 10 minutes (a double click, a second tab) gets the same Checkout
  // page back from Stripe instead of a second one; the page also expires after an hour so old tabs can't be paid later.
  const bucket = Math.floor(Date.now() / 600_000);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer,
      client_reference_id: org.id,
      line_items: lineItems(plan, prices),
      metadata: { org_id: org.id },
      subscription_data: { metadata: { org_id: org.id } },
      expires_at: bucket * 600 + 3600, // fixed within the bucket so the idempotent retry has identical parameters (>= 50 min from now)
      // {CHECKOUT_SESSION_ID} lets the page confirm the payment immediately, without waiting for the webhook.
      success_url: `${back}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}?checkout=cancelled`,
      allow_promotion_codes: false,
      ...(env.stripeBillingTax ? { automatic_tax: { enabled: true }, billing_address_collection: "required" as const, customer_update: { address: "auto" as const, name: "auto" as const } } : {}),
    },
    { idempotencyKey: `tempo-checkout-${org.id}-${plan.extraLocations}-${plan.staffPacks}-${bucket}` },
  );
  if (!session.url) throw new BillingUserError("Stripe didn't return a payment page. Please try again.");
  return session.url;
}

/** The Stripe Customer Portal (card, invoices). */
export async function createPortalUrl(org: { id: string; name: string; slug: string }, sub: Subscription, email: string | undefined): Promise<string> {
  const { stripe } = requireBilling();
  const customer = await ensureCustomer(stripe, org, email, sub);
  const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${env.appUrl}/o/${encodeURIComponent(org.slug)}/settings/billing` });
  return session.url;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** After Checkout: confirm the session belongs to this business and apply the subscription straight away. */
export async function confirmCheckout(orgId: string, sessionId: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe || !/^cs_[A-Za-z0-9_]{4,200}$/.test(sessionId)) return false;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== orgId || session.metadata?.org_id !== orgId || session.mode !== "subscription") return false;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subId || session.status !== "complete") return false;
  const sub = await stripe.subscriptions.retrieve(subId);
  const r = await applyStripeSubscription(sub, { orgHint: orgId, eventAt: nowSeconds() });
  if (r?.started) await sendSubscriptionEmail(r.orgId, "started");
  return Boolean(r);
}

/* ───────────────────────────── Changing the plan ───────────────────────────── */

export type ChangeResult = { ok: true } | { ok: false; error: string; /** the owner must go to Manage billing (Customer Portal) */ portal?: boolean };

/**
 * Moves a paying business to a new plan. Upgrades are charged (prorated) straight away; downgrades are refused while
 * the business uses more than the new plan includes, and otherwise credited (prorated) on the next invoice.
 */
export async function changePlan(orgId: string, sub: Subscription, plan: Plan, usage: Usage): Promise<ChangeResult> {
  const { stripe, prices } = requireBilling();
  if (!hasLiveSubscription(sub)) {
    // Expired locally but Stripe may still hold the (unpaid) subscription: the way out is the Customer Portal, not "Subscribe".
    if (sub.status === "expired" && sub.stripe_subscription_id) {
      const theirs = await retrieveSubscription(stripe, sub.stripe_subscription_id);
      if (theirs && isLiveStripeStatus(theirs.status)) return { ok: false, error: PORTAL_MESSAGE, portal: true };
    }
    return { ok: false, error: "There's no active subscription to change. Subscribe first." };
  }
  const fit = planFits(plan, usage);
  if (!fit.ok) return { ok: false, error: fit.reason };

  const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id!);
  const now = planFromItems(current.items.data.map((i) => ({ price: i.price.id, quantity: i.quantity ?? 0 })), prices);
  if (now.extraLocations === plan.extraLocations && now.staffPacks === plan.staffPacks) return { ok: true };
  const upgrade = monthlyCents(plan) > monthlyCents(now);

  // Update each of our three items; items we don't know about are left alone.
  const want = new Map(lineItems(plan, prices).map((i) => [i.price, i.quantity]));
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  for (const price of [prices.base, prices.location, prices.pack]) {
    const existing = current.items.data.find((i) => i.price.id === price);
    const qty = want.get(price) ?? 0;
    if (existing && qty > 0) items.push({ id: existing.id, quantity: qty });
    else if (existing) items.push({ id: existing.id, deleted: true });
    else if (qty > 0) items.push({ price, quantity: qty });
  }
  try {
    const updated = await stripe.subscriptions.update(current.id, {
      items,
      // Upgrade: charge the prorated amount now (and refuse the change if the card is declined). Downgrade: credit it.
      proration_behavior: upgrade ? "always_invoice" : "create_prorations",
      ...(upgrade ? { payment_behavior: "error_if_incomplete" as const } : {}),
    });
    const r = await applyStripeSubscription(updated, { orgHint: orgId, eventAt: nowSeconds() });
    if (r?.changed) await sendSubscriptionEmail(orgId, "changed", { before: r.before });
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("[billing] change plan failed:", (e as { type?: string }).type ?? "", (e as { code?: string }).code ?? "");
    if ((e as { type?: string }).type === "StripeCardError" || /payment|card|declin/i.test(msg)) {
      return { ok: false, error: "The card on file was declined, so your plan wasn't changed. Update your card from Manage billing and try again." };
    }
    return { ok: false, error: "Stripe couldn't change your plan just now. Please try again in a moment." };
  }
}

/** Cancel at the end of the paid period (access continues until then) or take the cancellation back. */
export async function setCancelAtPeriodEnd(orgId: string, sub: Subscription, cancel: boolean): Promise<ChangeResult> {
  const { stripe } = requireBilling();
  if (!hasLiveSubscription(sub)) return { ok: false, error: "There's no active subscription." };
  try {
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id!, { cancel_at_period_end: cancel });
    await applyStripeSubscription(updated, { orgHint: orgId, eventAt: nowSeconds() });
    return { ok: true };
  } catch (e) {
    console.error("[billing] cancel/resume failed:", (e as { type?: string }).type ?? "", (e as { code?: string }).code ?? "");
    return { ok: false, error: "Stripe couldn't update your subscription just now. Please try again in a moment." };
  }
}

/* ───────────────────────────── Keeping our copy in step with Stripe ───────────────────────────── */

export interface ApplyResult {
  orgId: string;
  /** The business just became a paying one (was a trial, expired or cancelled before). */
  started: boolean;
  /** The plan (locations / packs) changed on a business that was already paying. */
  changed: boolean;
  /** A payment problem just started (the plan went from fine to past_due): the owner should be told, once. */
  paymentFailed: boolean;
  before: Plan;
}

const ymd = (n: number) => new Date(n * 1000).toISOString();

/**
 * Tells the platform operator something needs attention. Always logged; also emailed to BILLING_ALERT_EMAIL when that is
 * set. Never throws (an alert must not break billing). Carries Stripe ids only, no names or email addresses.
 */
export async function alertOperator(subject: string, lines: string[]): Promise<void> {
  console.error(`[billing] ALERT: ${subject} | ${lines.join(" | ")}`);
  if (!env.billingAlertEmail) return;
  try {
    const html = `<div style="font-family:sans-serif"><h1 style="font-size:18px">${esc(subject)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
    const r = await sendEmail({ to: env.billingAlertEmail, businessName: "Tempo billing alerts", subject: `[Tempo billing] ${subject}`, html, text: `${subject}\n\n${lines.join("\n")}` });
    if (!r.ok) console.error("[billing] alert email not sent:", r.error);
  } catch (e) {
    console.error("[billing] alert email failed:", (e as Error).message);
  }
}

/**
 * Refunds every PAID invoice of a subscription (used for a cancelled duplicate). Each refund carries an idempotency key
 * built from the payment, so running it again (a webhook retry) never refunds twice; "already refunded" counts as done.
 * Returns what happened, never throws.
 */
async function refundPaidInvoices(stripe: Stripe, subscriptionId: string): Promise<{ refunded: { id: string; amount: number; currency: string }[]; failed: string[] }> {
  const refunded: { id: string; amount: number; currency: string }[] = [];
  const failed: string[] = [];
  try {
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: "paid", limit: 10 });
    for (const inv of invoices.data) {
      if (!inv.id || !(inv.amount_paid > 0)) continue;
      const payments = await stripe.invoicePayments.list({ invoice: inv.id, status: "paid", limit: 10 });
      for (const p of payments.data) {
        const pay = p.payment;
        const target = pay.type === "payment_intent" && pay.payment_intent
          ? { payment_intent: typeof pay.payment_intent === "string" ? pay.payment_intent : pay.payment_intent.id }
          : pay.type === "charge" && pay.charge
            ? { charge: typeof pay.charge === "string" ? pay.charge : pay.charge.id }
            : null;
        if (!target) { failed.push(inv.id); continue; }
        const key = "payment_intent" in target ? target.payment_intent : target.charge;
        try {
          const r = await stripe.refunds.create({ ...target, metadata: { reason: "tempo_duplicate_subscription", subscription: subscriptionId } }, { idempotencyKey: `tempo-dup-refund-${key}` });
          refunded.push({ id: r.id, amount: r.amount, currency: r.currency });
        } catch (e) {
          if ((e as { code?: string }).code === "charge_already_refunded") continue; // done earlier
          console.error("[billing] duplicate refund failed:", (e as { type?: string }).type ?? "", (e as { code?: string }).code ?? "");
          failed.push(inv.id);
        }
      }
    }
  } catch (e) {
    console.error("[billing] could not look up the duplicate's invoices:", (e as { type?: string }).type ?? "", (e as { code?: string }).code ?? "");
    failed.push("lookup");
  }
  return { refunded, failed };
}

/**
 * Cancels a second paid subscription for a business that already has one, so the customer isn't billed twice (S-016).
 * Stripe's cancel does not refund what was already charged, so the duplicate's paid invoices are refunded here
 * automatically (idempotent), and the operator is alerted either way: by log, and by email when BILLING_ALERT_EMAIL is
 * set. If a refund could not be made, the alert says so and the operator refunds it by hand in the Stripe dashboard.
 * The duplicate is by construction the NEWER subscription of a business whose existing one was just confirmed live at
 * Stripe, so refunding it can't refund the customer's real plan.
 */
async function cancelDuplicateSubscription(sub: Stripe.Subscription, orgId: string) {
  const stripe = getStripe();
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (!stripe) {
    await alertOperator("Duplicate subscription found, Stripe not available", [`subscription ${sub.id}`, `customer ${customer}`, `org ${orgId}`, "Cancel it and refund any charge in the Stripe dashboard."]);
    return;
  }
  try {
    await stripe.subscriptions.cancel(sub.id, { prorate: true, invoice_now: false });
  } catch (e) {
    if (!isMissing(e)) throw e; // the webhook answers 500 and Stripe retries (everything here is safe to repeat)
  }
  const { refunded, failed } = await refundPaidInvoices(stripe, sub.id);
  const amounts = refunded.map((r) => `${(r.amount / 100).toFixed(2)} ${r.currency.toUpperCase()} (${r.id})`).join(", ");
  await alertOperator(
    failed.length ? "Duplicate subscription cancelled; REFUND NEEDED" : "Duplicate subscription cancelled and refunded",
    [
      `subscription ${sub.id}`, `customer ${customer}`, `org ${orgId}`,
      refunded.length ? `refunded: ${amounts}` : failed.length ? "no refund could be made" : "no paid invoice to refund",
      ...(failed.length ? ["Some refunds could NOT be made automatically. Refund the charges of this subscription in the Stripe dashboard."] : []),
    ],
  );
}

/**
 * Is `sub` a different subscription from the paying one on `row`? Returns true when applying `sub` must stop: either it
 * is an old subscription ending (nothing to do) or a live duplicate, which is cancelled and refunded here (S-016).
 * Returns false when it may be applied (same subscription, nothing paying on the row, or ours is dead at Stripe).
 */
async function shouldStopForOtherSubscription(row: Subscription, sub: Stripe.Subscription): Promise<boolean> {
  if (!row.stripe_subscription_id || row.stripe_subscription_id === sub.id || !(row.status === "active" || row.status === "past_due")) return false;
  if (!isLiveStripeStatus(sub.status)) return true; // an old subscription ending: nothing to do
  // Is the one we have really still alive in Stripe? If so the newcomer is a duplicate: cancel it. If ours is dead
  // (our copy was behind), the new one simply takes over.
  let ours = true;
  const stripe = getStripe();
  if (stripe) {
    try {
      ours = isLiveStripeStatus((await stripe.subscriptions.retrieve(row.stripe_subscription_id)).status);
    } catch (e) {
      if (!isMissing(e)) throw e;
      ours = false;
    }
  }
  if (ours) {
    await cancelDuplicateSubscription(sub, row.org_id);
    return true;
  }
  return false;
}

/**
 * Writes a Stripe subscription into our `subscriptions` row. Safe to run any number of times with the same data.
 * `eventAt` (Stripe's time, in seconds) stops something older than what we already applied from undoing it; callers
 * always pass a subscription they just fetched from Stripe, so applying it is correct even when two events share a second.
 * Returns null when it doesn't belong to any business we know (or to an old subscription that was replaced).
 */
export async function applyStripeSubscription(sub: Stripe.Subscription, opts: { eventAt?: number; orgHint?: string; retried?: boolean } = {}): Promise<ApplyResult | null> {
  const prices = priceIds();
  if (!prices) return null;
  const admin = createAdminClient();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const hint = opts.orgHint ?? sub.metadata?.org_id;

  // Find the business by what we stored first (our own subscription id, then customer id); the metadata is only a hint
  // and is accepted only when the stored customer matches (or none is stored yet).
  let row: Subscription | null = null;
  const byId = await admin.from("subscriptions").select("*").eq("stripe_subscription_id", sub.id).maybeSingle();
  row = (byId.data as Subscription | null) ?? null;
  if (!row) {
    const byCustomer = await admin.from("subscriptions").select("*").eq("stripe_customer_id", customerId).maybeSingle();
    row = (byCustomer.data as Subscription | null) ?? null;
  }
  if (!row && hint && /^[0-9a-f-]{36}$/i.test(hint)) {
    const byHint = await admin.from("subscriptions").select("*").eq("org_id", hint).maybeSingle();
    const h = byHint.data as Subscription | null;
    if (h && (!h.stripe_customer_id || h.stripe_customer_id === customerId)) row = h;
  }
  if (!row) return null;

  // A different subscription of the same business must not overwrite the live one.
  if (await shouldStopForOtherSubscription(row, sub)) return null;
  // Older than what we already applied.
  if (opts.eventAt && row.last_stripe_event_at && new Date(row.last_stripe_event_at).getTime() > opts.eventAt * 1000) return null;

  const plan = planFromItems(sub.items.data.map((i) => ({ price: i.price.id, quantity: i.quantity ?? 0 })), prices);
  const before: Plan = { extraLocations: row.extra_locations, staffPacks: row.staff_packs };
  const wasPaying = row.status === "active" || row.status === "past_due";
  let status = statusFromStripe(sub.status) ?? row.status;
  // Grace expiry is sticky (D-018): the sweep expires a past_due row after GRACE_DAYS, but Stripe keeps saying past_due while
  // it retries the card. Re-applying that must not bring the row back to past_due (it would flip every hour and look
  // like a new "started" subscription). Only a paying state from Stripe (active/trialing) or a new subscription ends it.
  const graceExpired = row.status === "expired" && row.stripe_subscription_id === sub.id && status === "past_due";
  if (graceExpired) status = "expired";
  const periodEnds = sub.items.data.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  const periodEnd = periodEnds.length ? ymd(Math.min(...periodEnds)) : row.current_period_end;
  if (status === "active" && !periodEnd) console.warn(`[billing] active subscription ${sub.id} has no period end; a cancel at period end would not lapse locally`);

  const patch: Record<string, unknown> = {
    status,
    extra_locations: plan.extraLocations,
    staff_packs: plan.staffPacks,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    cancel_at_period_end: status === "cancelled" ? false : Boolean(sub.cancel_at_period_end),
    current_period_end: periodEnd,
    past_due_since: status === "past_due" || graceExpired ? row.past_due_since ?? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    ...(opts.eventAt ? { last_stripe_event_at: ymd(opts.eventAt) } : {}),
  };
  // Compare-and-set on the status we read: when two deliveries of the same news run at once, only one changes the row
  // (and so only one sends the "started" email); the other finds nothing to change.
  // It also compares updated_at, so a read that is older than a write made in the meantime (a webhook, a plan change, the
  // sweep) can't overwrite it (S-014); the newer write wins and this one is dropped.
  let write = admin.from("subscriptions").update(patch).eq("org_id", row.org_id).eq("status", row.status);
  if (row.updated_at) write = write.eq("updated_at", row.updated_at);
  const { data: changedRows, error } = await write.select("org_id");
  if (error) throw new Error(`could not save subscription: ${error.message}`);
  if (!changedRows?.length) {
    // Lost the compare-and-set: another write got in first. If that write put a DIFFERENT live subscription on the row, this
    // one is a duplicate and must still be cancelled and refunded, not dropped (S-018).
    const { data: now } = await admin.from("subscriptions").select("*").eq("org_id", row.org_id).maybeSingle();
    if (now && await shouldStopForOtherSubscription(now as Subscription, sub)) return null;
    // The winner is a different subscription that is already dead at Stripe: this live one should take over. Try once more
    // against the fresh row (S-020); a second lost race leaves it to the next webhook, Subscribe click or hourly reconcile.
    const winner = now as Subscription | null;
    if (winner && !opts.retried && winner.stripe_subscription_id && winner.stripe_subscription_id !== sub.id && isLiveStripeStatus(sub.status)) {
      return applyStripeSubscription(sub, { ...opts, retried: true });
    }
    return { orgId: row.org_id, started: false, changed: false, paymentFailed: false, before };
  }

  const nowPaying = status === "active" || status === "past_due";
  return {
    orgId: row.org_id,
    // "Subscription is active" is only for a genuinely paying (active) state, never for past_due or expired.
    started: status === "active" && !wasPaying,
    changed: wasPaying && nowPaying && (before.extraLocations !== plan.extraLocations || before.staffPacks !== plan.staffPacks),
    paymentFailed: status === "past_due" && row.status !== "past_due",
    before,
  };
}

/** The current state of a subscription straight from Stripe, or null if Stripe has no such subscription. */
export async function retrieveSubscription(stripe: Stripe, id: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/* ───────────────────────────── Emails (transactional) ───────────────────────────── */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type SubscriptionEmail = "trial_ending" | "trial_ended" | "payment_failed" | "started" | "changed";

/** Owners of a business, with their email addresses (only people who can sign in). */
async function ownerEmails(orgId: string): Promise<{ org: { name: string; slug: string; timezone: string | null }; to: string[] } | null> {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("name, slug, timezone").eq("id", orgId).maybeSingle();
  if (!org) return null;
  const { data: owners } = await admin.from("memberships").select("user_id").eq("org_id", orgId).eq("role", "owner").not("user_id", "is", null);
  const ids = (owners ?? []).map((o) => o.user_id as string);
  if (!ids.length) return null;
  const { data: profiles } = await admin.from("profiles").select("email").in("id", ids);
  return { org, to: (profiles ?? []).map((p) => p.email as string).filter(Boolean) };
}

/**
 * Emails the owners about their subscription. These are transactional messages about their own account (not
 * marketing), so they need no opt-in. Never throws: a failed email must not break billing.
 */
export async function sendSubscriptionEmail(orgId: string, kind: SubscriptionEmail, extra: { before?: Plan } = {}): Promise<boolean> {
  try {
    const owners = await ownerEmails(orgId);
    if (!owners || !owners.to.length) return false;
    const admin = createAdminClient();
    const { data } = await admin.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle();
    const sub = data as Subscription | null;
    if (!sub) return false;
    const url = `${env.appUrl}/o/${encodeURIComponent(owners.org.slug)}/settings/billing`;
    const name = owners.org.name;
    // Dates in the business's own time zone (Toronto when unknown).
    const dateLong = (d: Date | string) => formatDateLong(d, owners.org.timezone ?? undefined);
    const plan: Plan = { extraLocations: sub.extra_locations, staffPacks: sub.staff_packs };
    const limits = planLimits(plan);
    const planLine = `${limits.locations} location${limits.locations === 1 ? "" : "s"}, ${limits.staff} staff, ${money(monthlyCents(plan))}/month`;

    let subject: string;
    let lines: string[];
    let button = "Open billing";
    switch (kind) {
      case "trial_ending": {
        const days = trialDaysLeft(sub.trial_ends_at);
        subject = `Your Tempo trial ends in ${days} day${days === 1 ? "" : "s"}`;
        lines = [
          `The free trial for ${name} ends on ${dateLong(sub.trial_ends_at)}.`,
          "To keep taking bookings, choose a plan before then. Plans start at $15/month (1 location, 5 staff). No card is needed until you subscribe.",
          "If you do nothing, your data is kept, but your booking page pauses and your dashboard becomes read-only.",
        ];
        button = "Choose a plan";
        break;
      }
      case "trial_ended":
        subject = `Your Tempo trial has ended`;
        lines = [
          `The free trial for ${name} has ended. Your booking page is paused and your dashboard is read-only. Nothing has been deleted, and you can still export your data.`,
          "Subscribe any time to switch everything back on right away.",
        ];
        button = "Subscribe";
        break;
      case "payment_failed": {
        const until = sub.past_due_since ? dateLong(graceEndsAt(sub.past_due_since)) : `${GRACE_DAYS} days from now`;
        subject = `We couldn't take your Tempo payment`;
        lines = [
          `The latest payment for ${name} didn't go through. Stripe will try again automatically.`,
          `Please update your card. If it isn't fixed by ${until}, your booking page will pause and your dashboard will become read-only until payment succeeds. Nothing is deleted.`,
        ];
        button = "Update payment method";
        break;
      }
      case "started":
        subject = `Your Tempo subscription is active`;
        lines = [`Thanks! ${name} is subscribed: ${planLine}.`, "You can change your plan, update your card and see invoices from the Billing page at any time."];
        break;
      case "changed": {
        subject = `Your Tempo plan was updated`;
        const b = extra.before ? planLimits(extra.before) : null;
        lines = [
          `The plan for ${name} is now: ${planLine}.`,
          ...(b ? [`Before: ${b.locations} location${b.locations === 1 ? "" : "s"}, ${b.staff} staff.`] : []),
          "Changes are prorated: upgrades are charged for the rest of the current period, and downgrades are credited on your next invoice.",
        ];
        break;
      }
    }
    const html = `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#1d1d1f"><h1 style="font-size:22px">${esc(subject)}</h1>${lines.map((l) => `<p style="color:#3a3a3c;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("")}<a href="${url}" style="display:inline-block;margin-top:12px;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${esc(button)}</a><p style="color:#8e8e93;font-size:12px;margin-top:28px">This is a message about your Tempo account, sent to the account owner.</p></div>`;
    const text = `${subject}\n\n${lines.join("\n\n")}\n\n${button}: ${url}`;
    const results = await Promise.all(owners.to.map((to) => sendEmail({ to, businessName: "Tempo", subject, html, text })));
    return results.some((r) => r.ok);
  } catch (e) {
    console.error("[billing] email failed:", e);
    return false;
  }
}

/* ───────────────────────────── Scheduled work (called from the cron route) ───────────────────────────── */

/**
 * Trial reminders (3 days before the end), trial-ended notices, and the status changes that happen with the clock:
 * a trial that ran out, an unpaid plan past its 7-day grace period, a cancelled plan past its period.
 * Idempotent: each email is claimed (timestamp set) before it is sent, and put back if sending failed.
 */
export async function runBillingSweep(now = new Date(), only?: string[]): Promise<{ reminders: number; ended: number; expired: number; reconciled: number; purged: number }> {
  const admin = createAdminClient();
  const iso = now.toISOString();
  const scoped = <T extends { in: (c: string, v: string[]) => T }>(q: T) => (only ? q.in("org_id", only) : q);
  let reminders = 0;
  let ended = 0;
  let expired = 0;

  // Unpaid past the grace period -> expired. Cancelled-at-period-end plans past their period -> cancelled.
  const graceCutoff = new Date(now.getTime() - GRACE_DAYS * 86_400_000).toISOString();
  const lapsed = await scoped(admin.from("subscriptions").update({ status: "expired", updated_at: iso }).eq("status", "past_due").lt("past_due_since", graceCutoff)).select("org_id");
  expired += lapsed.data?.length ?? 0;
  const slack = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  await scoped(admin.from("subscriptions").update({ status: "cancelled", cancel_at_period_end: false, updated_at: iso }).eq("status", "active").eq("cancel_at_period_end", true).lt("current_period_end", slack));

  // Trial ending within 3 days.
  const soon = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  const { data: ending } = await scoped(admin.from("subscriptions").select("org_id").eq("status", "trial").is("trial_reminder_sent_at", null).gt("trial_ends_at", iso).lte("trial_ends_at", soon).limit(200));
  for (const r of ending ?? []) {
    const { data: claimed } = await admin.from("subscriptions").update({ trial_reminder_sent_at: iso }).eq("org_id", r.org_id).is("trial_reminder_sent_at", null).select("org_id");
    if (!claimed?.length) continue;
    if (await sendSubscriptionEmail(r.org_id, "trial_ending")) reminders++;
    else await admin.from("subscriptions").update({ trial_reminder_sent_at: null }).eq("org_id", r.org_id); // retry next run
  }

  // Trial over without a subscription.
  const { data: over } = await scoped(admin.from("subscriptions").select("org_id").eq("status", "trial").lte("trial_ends_at", iso).limit(200));
  for (const r of over ?? []) {
    await admin.from("subscriptions").update({ status: "expired", updated_at: iso }).eq("org_id", r.org_id).eq("status", "trial");
    expired++;
  }
  const { data: needsNotice } = await scoped(admin.from("subscriptions").select("org_id").eq("status", "expired").is("stripe_subscription_id", null).is("trial_ended_email_sent_at", null).lte("trial_ends_at", iso).limit(200));
  for (const r of needsNotice ?? []) {
    const { data: claimed } = await admin.from("subscriptions").update({ trial_ended_email_sent_at: iso }).eq("org_id", r.org_id).is("trial_ended_email_sent_at", null).select("org_id");
    if (!claimed?.length) continue;
    if (await sendSubscriptionEmail(r.org_id, "trial_ended")) ended++;
    else await admin.from("subscriptions").update({ trial_ended_email_sent_at: null }).eq("org_id", r.org_id);
  }

  // Reconcile with Stripe: webhooks can be lost or misconfigured, so a bounded batch of paying businesses (the ones
  // checked longest ago first) is re-read from Stripe every run. Errors are tolerated and logged: one bad row or a
  // Stripe outage never stops the rest of the sweep.
  const reconciled = await reconcileWithStripe(only);

  // Housekeeping: webhook idempotency records older than 90 days are no longer needed (Stripe stops retrying after 3 days).
  let purged = 0;
  const { data: old, error: purgeError } = await admin.from("stripe_billing_events").delete().lt("received_at", new Date(now.getTime() - EVENT_RETENTION_DAYS * 86_400_000).toISOString()).select("id");
  if (purgeError) console.error("[billing] could not purge old events:", purgeError.message);
  else purged = old?.length ?? 0;
  return { reminders, ended, expired, reconciled, purged };
}

const EVENT_RETENTION_DAYS = 90;
const RECONCILE_BATCH = 25;

/**
 * Re-reads up to RECONCILE_BATCH subscriptions from Stripe and applies them. Returns how many were checked.
 * Fair rotation (S-014): rows are taken least-recently-checked first by last_reconciled_at, which is stamped after EVERY
 * attempt (found, not found, nothing to change, or an error), so rows Stripe doesn't know can't hog the batch.
 * A subscription Stripe says doesn't exist is only marked (stripe_missing_at, plus a log line): its entitlement is not
 * changed, because "no such subscription" is also what a wrong or switched API key looks like and must not cancel anyone.
 */
export async function reconcileWithStripe(only?: string[], limit = RECONCILE_BATCH): Promise<number> {
  const stripe = getStripe();
  if (!stripe || !priceIds()) return 0;
  const admin = createAdminClient();
  let q = admin.from("subscriptions").select("org_id, stripe_subscription_id, stripe_missing_at").not("stripe_subscription_id", "is", null).order("last_reconciled_at", { ascending: true, nullsFirst: true }).limit(limit);
  if (only) q = q.in("org_id", only);
  const { data: rows, error } = await q;
  if (error) {
    console.error("[billing] reconcile: could not list subscriptions:", error.message);
    return 0;
  }
  let checked = 0;
  for (const r of rows ?? []) {
    const stamp: Record<string, unknown> = { last_reconciled_at: new Date().toISOString() };
    try {
      const sub = await retrieveSubscription(stripe, r.stripe_subscription_id as string);
      if (!sub) {
        console.warn(`[billing] reconcile: Stripe has no subscription ${r.stripe_subscription_id} (org ${r.org_id})`);
        stamp.stripe_missing_at = (r.stripe_missing_at as string | null) ?? new Date().toISOString();
        continue;
      }
      if (r.stripe_missing_at) stamp.stripe_missing_at = null;
      const result = await applyStripeSubscription(sub, { orgHint: r.org_id as string });
      if (result?.started) await sendSubscriptionEmail(result.orgId, "started");
      else if (result?.paymentFailed) await sendSubscriptionEmail(result.orgId, "payment_failed");
      checked++;
    } catch (e) {
      console.error(`[billing] reconcile failed for org ${r.org_id}:`, (e as Error).message);
    } finally {
      // Never changes updated_at, so it can't make a concurrent compare-and-set write fail.
      const { error: stampError } = await admin.from("subscriptions").update(stamp).eq("org_id", r.org_id as string);
      if (stampError) console.error(`[billing] reconcile: could not stamp org ${r.org_id}:`, stampError.message);
    }
  }
  return checked;
}
