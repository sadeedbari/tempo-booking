"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getOrgContext, getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { features } from "@/lib/env";
import { parsePlan, planFits } from "@/lib/billing";
import {
  BillingUserError, LiveSubscriptionError, changePlan as changeStripePlan, checkCapacity, createCheckoutUrl, createPortalUrl, getSubscription, getUsage,
  hasLiveSubscription, seatUsage, setCancelAtPeriodEnd,
} from "@/lib/billing-server";

/**
 * Billing actions. Owner only, checked here on the server for every call (the page hiding a button is not security).
 * The browser only ever sends counts (extra locations, staff packs); prices and limits are worked out on the server
 * from those counts, and whole numbers within range are enforced by parsePlan.
 */
/** `portal` = the message tells the owner to settle things in the Stripe Customer Portal ("Manage billing"). */
export type BillingResult = { ok?: boolean; error?: string; url?: string; portal?: boolean };

/**
 * What the browser gets when something throws. Only BillingUserError (written for people) passes through; anything
 * else (Stripe SDK errors can carry key hints, price ids or request ids) is logged without its message and replaced by
 * a fixed sentence. Next.js's own control-flow errors (redirect(), notFound(), the sign-in redirect inside
 * getOrgContext) are re-thrown so they still work.
 */
function fail(e: unknown): BillingResult {
  unstable_rethrow(e);
  if (e instanceof LiveSubscriptionError) return { error: e.message, ...(e.needsPortal ? { portal: true } : {}) };
  if (e instanceof BillingUserError) return { error: e.message };
  const err = e as { type?: string; code?: string; statusCode?: number };
  console.error("[billing] action failed:", err?.type ?? "", err?.code ?? "", err?.statusCode ?? "", e instanceof Error ? e.name : typeof e);
  return { error: "Something went wrong with billing. Please try again in a moment." };
}

async function ownerCtx(slug: string) {
  const ctx = await getOrgContext(slug);
  if (!ctx.isOwner) throw new BillingUserError("Only the account owner can manage billing.");
  if (!features.billing) throw new BillingUserError("Billing isn't set up on this server yet.");
  const supabase = await createClient();
  const sub = await getSubscription(supabase, ctx.org.id);
  if (!sub) throw new BillingUserError("No subscription was found for this business.");
  return { ctx, supabase, sub };
}

const done = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

/** Goes to Stripe Checkout for a new subscription. */
export async function startCheckout(slug: string, input: { extraLocations: unknown; staffPacks: unknown }): Promise<BillingResult> {
  try {
    const { ctx, supabase, sub } = await ownerCtx(slug);
    const plan = parsePlan(input);
    if (!plan) return { error: "Choose a whole number of locations and staff packs." };
    if (hasLiveSubscription(sub)) return { error: "You already have a subscription. Use Change plan instead." };
    const fit = planFits(plan, seatUsage(await getUsage(supabase, ctx.org.id)));
    if (!fit.ok) return { error: fit.reason };
    const user = await getUser();
    return { ok: true, url: await createCheckoutUrl(ctx.org, sub, plan, user?.email ?? undefined) };
  } catch (e) {
    return fail(e);
  }
}

/** Changes the plan of a paying business: upgrades are prorated now, downgrades are refused while in use. */
export async function changeSubscriptionPlan(slug: string, input: { extraLocations: unknown; staffPacks: unknown }): Promise<BillingResult> {
  try {
    const { ctx, supabase, sub } = await ownerCtx(slug);
    const plan = parsePlan(input);
    if (!plan) return { error: "Choose a whole number of locations and staff packs." };
    const r = await changeStripePlan(ctx.org.id, sub, plan, seatUsage(await getUsage(supabase, ctx.org.id)));
    if (!r.ok) return { error: r.error, ...(r.portal ? { portal: true } : {}) };
    done(slug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * One-click "add what I need" from an upgrade prompt: adds one location, or enough staff packs for one more person.
 * The size of the change is decided here from the real usage, not by the browser.
 */
export async function addOnForLimit(slug: string, kind: "location" | "staff"): Promise<BillingResult> {
  try {
    if (kind !== "location" && kind !== "staff") return { error: "Unknown add-on." };
    const { ctx, supabase, sub } = await ownerCtx(slug);
    if (!hasLiveSubscription(sub)) return { error: "Subscribe first to add more.", url: `/o/${slug}/settings/billing` };
    const cap = await checkCapacity(supabase, ctx.org.id, kind, true);
    if (cap.ok) return { ok: true }; // already enough room (e.g. someone else just upgraded)
    if (!cap.upgrade) return { error: cap.error };
    const usage = seatUsage(await getUsage(supabase, ctx.org.id));
    const r = await changeStripePlan(ctx.org.id, sub, cap.upgrade.plan, usage);
    if (!r.ok) return { error: r.error };
    done(slug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The Stripe Customer Portal: card, invoices. */
export async function openPortal(slug: string): Promise<BillingResult> {
  try {
    const { ctx, sub } = await ownerCtx(slug);
    const user = await getUser();
    return { ok: true, url: await createPortalUrl(ctx.org, sub, user?.email ?? undefined) };
  } catch (e) {
    return fail(e);
  }
}

/** Cancel at the end of the paid period. Access continues until then. */
export async function cancelSubscription(slug: string): Promise<BillingResult> {
  try {
    const { ctx, sub } = await ownerCtx(slug);
    const r = await setCancelAtPeriodEnd(ctx.org.id, sub, true);
    if (!r.ok) return { error: r.error };
    done(slug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Take a cancellation back before the period ends. */
export async function resumeSubscription(slug: string): Promise<BillingResult> {
  try {
    const { ctx, sub } = await ownerCtx(slug);
    const r = await setCancelAtPeriodEnd(ctx.org.id, sub, false);
    if (!r.ok) return { error: r.error };
    done(slug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

