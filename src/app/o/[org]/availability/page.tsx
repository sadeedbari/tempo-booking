import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { AvailabilityRule, TimeOff } from "@/lib/types";
import { AvailabilityView } from "./view";

export const metadata: Metadata = { title: "Availability" };

export default async function AvailabilityPage(props: PageProps<"/o/[org]/availability">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, members, me, isAdmin } = await getOrgContext(slug);
  const editable = isAdmin ? members : members.filter((m) => m.id === me.id);
  const memberId = typeof sp.member === "string" && editable.some((m) => m.id === sp.member) ? sp.member : me.id;
  const supabase = await createClient();
  const [{ data: rules }, { data: off }] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("member_id", memberId).order("weekday").order("start_time"),
    supabase.from("time_off").select("*").eq("member_id", memberId).gte("ends_at", new Date().toISOString()).order("starts_at"),
  ]);
  return (
    <AvailabilityView
      key={memberId}
      slug={slug}
      org={org}
      members={editable}
      memberId={memberId}
      rules={(rules ?? []) as AvailabilityRule[]}
      timeOff={(off ?? []) as TimeOff[]}
    />
  );
}
