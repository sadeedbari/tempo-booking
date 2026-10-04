import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth";
import { features } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Location } from "@/lib/types";
import { SettingsView } from "./view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(props: PageProps<"/o/[org]/settings">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, isAdmin, isOwner, members } = await getOrgContext(slug);
  const supabase = await createClient();
  const [locs, links] = await Promise.all([
    supabase.from("locations").select("*").eq("org_id", org.id).order("position").order("created_at"),
    supabase.from("member_locations").select("location_id, member_id"),
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
      members={members}
      features={features}
      stripeStatus={typeof sp.stripe === "string" ? sp.stripe : undefined}
    />
  );
}
