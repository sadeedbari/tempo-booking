import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth";
import { features } from "@/lib/env";
import { SettingsView } from "./view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(props: PageProps<"/o/[org]/settings">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, isAdmin, isOwner } = await getOrgContext(slug);
  return (
    <SettingsView
      slug={slug}
      org={org}
      isAdmin={isAdmin}
      isOwner={isOwner}
      features={features}
      stripeStatus={typeof sp.stripe === "string" ? sp.stripe : undefined}
    />
  );
}
