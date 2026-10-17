import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { Location, Service, ServiceQuestion } from "@/lib/types";
import { ServicesView } from "./view";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage(props: PageProps<"/o/[org]/services">) {
  const { org: slug } = await props.params;
  const { org, members, isAdmin } = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: services }, { data: staff }, { data: questions }, { data: locations }] = await Promise.all([
    supabase.from("services").select("*").eq("org_id", org.id).order("position").order("created_at"),
    supabase.from("service_staff").select("service_id, member_id"),
    supabase.from("service_questions").select("id, service_id, label, help_text, type, options, required").eq("org_id", org.id).order("position").order("created_at"),
    supabase.from("locations").select("*").eq("org_id", org.id).eq("active", true).order("position").order("created_at"),
  ]);
  const questionMap: Record<string, ServiceQuestion[]> = {};
  (questions ?? []).forEach((q) => (questionMap[q.service_id as string] ??= []).push(q as unknown as ServiceQuestion));
  const staffMap: Record<string, string[]> = {};
  (staff ?? []).forEach((s) => (staffMap[s.service_id] ??= []).push(s.member_id));
  return (
    <ServicesView
      slug={slug}
      org={org}
      services={(services ?? []) as Service[]}
      staffMap={staffMap}
      questionMap={questionMap}
      members={members.filter((m) => m.bookable)}
      locations={(locations ?? []) as Location[]}
      canEdit={isAdmin}
    />
  );
}
