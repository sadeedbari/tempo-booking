import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { Service } from "@/lib/types";
import { ServicesView } from "./view";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage(props: PageProps<"/o/[org]/services">) {
  const { org: slug } = await props.params;
  const { org, members, isAdmin } = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: services }, { data: staff }] = await Promise.all([
    supabase.from("services").select("*").eq("org_id", org.id).order("position").order("created_at"),
    supabase.from("service_staff").select("service_id, member_id"),
  ]);
  const staffMap: Record<string, string[]> = {};
  (staff ?? []).forEach((s) => (staffMap[s.service_id] ??= []).push(s.member_id));
  return (
    <ServicesView
      slug={slug}
      org={org}
      services={(services ?? []) as Service[]}
      staffMap={staffMap}
      members={members.filter((m) => m.bookable)}
      canEdit={isAdmin}
    />
  );
}
