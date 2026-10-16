import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth";
import { env, features } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Location } from "@/lib/types";
import { syncChargesEnabled } from "@/lib/stripe-connect";
import { SettingsView } from "./view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(props: PageProps<"/o/[org]/settings">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const ctx = await getOrgContext(slug);
  const { isAdmin, isOwner, members } = ctx;
  let org = ctx.org;
  // A business that started Stripe setup but hasn't finished: ask Stripe (covers closing the tab early).
  if (isAdmin && features.payments && org.stripe_account_id && !org.stripe_charges_enabled) {
    const enabled = await syncChargesEnabled(org.id, org.stripe_account_id);
    if (enabled) org = { ...org, stripe_charges_enabled: true };
  }
  const supabase = await createClient();
  const [locs, links, svcs] = await Promise.all([
    supabase.from("locations").select("*").eq("org_id", org.id).order("position").order("created_at"),
    supabase.from("member_locations").select("location_id, member_id"),
    supabase.from("services").select("id, slug, name, contact_form").eq("org_id", org.id).eq("active", true).order("position"),
  ]);
  const locationStaff: Record<string, string[]> = {};
  (links.data ?? []).forEach((r) => (locationStaff[r.location_id] ??= []).push(r.member_id));
  return (
    <SettingsView
      slug={slug}
      org={org}
      isAdmin={isAdmin}
      isOwner={isOwner}
      locations={(locs.data ?? []) as Location[]}
      locationStaff={locationStaff}
      appUrl={env.appUrl}
      vapidKey={features.push ? env.vapidPublicKey! : ""}
      services={(svcs.data ?? []) as { id: string; slug: string; name: string; contact_form: boolean }[]}
      members={members}
      features={features}
      stripeStatus={typeof sp.stripe === "string" ? sp.stripe : undefined}
      stripeReason={typeof sp.reason === "string" ? sp.reason : undefined}
    />
  );
}
