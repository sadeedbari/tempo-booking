import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { applyStripeSubscription, retrieveSubscription, sendSubscriptionEmail } from "@/lib/billing-server";

/**
 * Stripe webhook for Tempo's OWN subscriptions (not the Connect endpoint at /api/stripe/webhook, which handles
 * customers' deposits). It has its own signing secret (STRIPE_BILLING_WEBHOOK_SECRET). In the Stripe dashboard create
 * it for "Your account" events, NOT "Connected and v2 accounts" (see docs/billing-setup.md).
 *
 *  - The signature is checked on the raw body before anything else; a forged request changes nothing.
 *  - Events from a connected account (event.account set) or from the other mode (test vs live) are refused.
 *  - Nothing in an event is trusted beyond the signature: the subscription is always re-read from Stripe with our own
 *    key, so what is applied is Stripe's current truth (which also makes out-of-order and same-second events harmless).
 *  - Idempotent and safe against concurrent duplicates: the event id is claimed (insert-first, unique id) before any
 *    work. A finished event is acknowledged and ignored; one being processed right now is answered 409 so Stripe
 *    retries later; one that failed is released so the retry runs it again.
 */
const IN_FLIGHT_MS = 5 * 60_000; // a claim older than this is treated as a crashed run and may be taken over

export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe || !env.stripeBillingWebhookSecret) return new Response("Billing webhook not configured", { status: 501 });

  const body = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.stripeBillingWebhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  // Only events about our own account. A Connect event (another business's own Stripe account) must never change a plan.
  if ((event as { account?: string }).account) return Response.json({ received: true, ignored: "connected account event" });
  // A test event can't reach a live server and vice versa (when the event says which mode it is).
  const keyIsLive = /^(sk|rk)_live_/.test(env.stripeSecretKey ?? "");
  if (typeof event.livemode === "boolean" && event.livemode !== keyIsLive) return Response.json({ received: true, ignored: "wrong mode" });

  const admin = createAdminClient();
  // Claim the event: insert first, the unique id decides who runs it.
  const { error: insertError } = await admin.from("stripe_billing_events").insert({ id: event.id, type: event.type });
  if (insertError) {
    if (insertError.code !== "23505") {
      console.error("[billing-webhook] could not record event:", insertError.message);
      return new Response("Could not record event", { status: 500 });
    }
    const { data: seen } = await admin.from("stripe_billing_events").select("processed_at, received_at").eq("id", event.id).single();
    if (seen?.processed_at) return Response.json({ received: true, duplicate: true });
    const claimedAt = seen?.received_at ? new Date(seen.received_at as string).getTime() : 0;
    if (Date.now() - claimedAt < IN_FLIGHT_MS) return new Response("Event is being processed", { status: 409 }); // Stripe retries
    // Stale claim (a run that never finished): take it over, atomically, so only one retry wins.
    const { data: won } = await admin.from("stripe_billing_events").update({ received_at: new Date().toISOString() }).eq("id", event.id).is("processed_at", null).eq("received_at", seen?.received_at as string).select("id");
    if (!won?.length) return new Response("Event is being processed", { status: 409 });
  }

  try {
    await handle(stripe, event);
  } catch (e) {
    console.error(`[billing-webhook] ${event.type} failed:`, (e as Error).message);
    // Release the claim so Stripe's retry can run it straight away.
    await admin.from("stripe_billing_events").update({ received_at: new Date(0).toISOString() }).eq("id", event.id);
    return new Response("Processing failed", { status: 500 }); // Stripe retries
  }
  await admin.from("stripe_billing_events").update({ processed_at: new Date().toISOString() }).eq("id", event.id);
  return Response.json({ received: true });
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

/** Re-reads the subscription from Stripe, applies it, and sends the owner the email that fits what changed. */
async function sync(stripe: Stripe, subscriptionId: string, event: Stripe.Event, orgHint?: string) {
  const sub = await retrieveSubscription(stripe, subscriptionId);
  if (!sub) return; // Stripe has no such subscription (not ours / gone)
  const r = await applyStripeSubscription(sub, { eventAt: event.created, orgHint });
  if (r?.started) await sendSubscriptionEmail(r.orgId, "started");
  else if (r?.paymentFailed) await sendSubscriptionEmail(r.orgId, "payment_failed"); // only when the problem STARTS, not on every retry
  else if (r?.changed) await sendSubscriptionEmail(r.orgId, "changed", { before: r.before });
}

async function handle(stripe: Stripe, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return;
      const subId = idOf(session.subscription);
      if (subId) await sync(stripe, subId, event, session.client_reference_id ?? undefined);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subId = (event.data.object as Stripe.Subscription).id;
      if (typeof subId === "string") await sync(stripe, subId, event);
      return;
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      // Only invoices of a subscription count (a one-off invoice must not start a grace period). Stripe's own view of
      // the subscription decides the status: past_due after a failed renewal, active again once paid.
      const subId = subscriptionOf(event.data.object as Stripe.Invoice);
      if (subId) await sync(stripe, subId, event);
      return;
    }
  }
}

/** The subscription an invoice belongs to (newer API versions keep it under `parent`). */
function subscriptionOf(inv: Stripe.Invoice): string | null {
  return idOf(inv.parent?.subscription_details?.subscription);
}
