import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { features } from "@/lib/env";
import { PageHeader, Notice } from "@/components/ui/misc";
import { effectiveStatus, isEntitled, parsePlan, trialDaysLeft } from "@/lib/billing";
import { confirmCheckout, getSubscription, getUsage } from "@/lib/billing-server";
import { BillingView } from "./view";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage(props: PageProps<"/o/[org]/settings/billing">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, isOwner } = await getOrgContext(slug);

  // Billing belongs to the owner. Everyone else sees a short explanation and nothing about the plan or payments.
  if (!isOwner) {
    return (
      <>
        <PageHeader title="Billing" />
        <div className="max-w-3xl"><Notice tone="blue">Only the account owner can see or change billing. Ask them if you need something changed.</Notice></div>
      </>
    );
  }

  // Back from Stripe Checkout: confirm the payment right now instead of waiting for the webhook.
  // The result is carried to a clean URL with a redirect, so the dashboard layout (and its plan banner) is rendered
  // again AFTER the plan was updated instead of showing the old state next to a "subscription is active" message.
  if (sp.checkout === "success" && typeof sp.session_id === "string" && features.billing) {
    let confirmed = false;
    try {
      confirmed = await confirmCheckout(org.id, sp.session_id);
    } catch (e) {
      console.error("[billing] could not confirm checkout:", (e as Error).message);
    }
    redirect(`/o/${slug}/settings/billing?checkout=${confirmed ? "done" : "processing"}`);
  }

  const supabase = await createClient();
  const [sub, usage] = await Promise.all([getSubscription(supabase, org.id), getUsage(supabase, org.id)]);
  if (!sub) {
    return (
      <>
        <PageHeader title="Billing" />
        <div className="max-w-3xl"><Notice>We couldn&apos;t load your subscription. Please try again in a moment.</Notice></div>
      </>
    );
  }

  const now = new Date();
  const wanted = parsePlan({ extraLocations: sp.locations, staffPacks: sp.packs });
  return (
    <BillingView
      slug={slug}
      configured={features.billing}
      sub={{
        status: effectiveStatus(sub, now),
        entitled: isEntitled(sub, now),
        trialEndsAt: sub.trial_ends_at,
        trialDaysLeft: trialDaysLeft(sub.trial_ends_at, now),
        periodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        pastDueSince: sub.past_due_since,
        extraLocations: sub.extra_locations,
        staffPacks: sub.staff_packs,
        hasCustomer: Boolean(sub.stripe_customer_id),
        live: Boolean(sub.stripe_subscription_id) && (sub.status === "active" || sub.status === "past_due"),
      }}
      usage={{ locations: usage.locations, staff: usage.staff, invites: usage.pendingInvites }}
      pendingInvites={usage.pendingInvites}
      initialPlan={wanted ?? { extraLocations: sub.extra_locations, staffPacks: sub.staff_packs }}
      timeZone={org.timezone}
      banner={sp.checkout === "done" ? "success" : sp.checkout === "processing" || sp.checkout === "success" ? "processing" : sp.checkout === "cancelled" ? "cancelled" : sp.notice === "no-trial" ? "no-trial" : undefined}
    />
  );
}
