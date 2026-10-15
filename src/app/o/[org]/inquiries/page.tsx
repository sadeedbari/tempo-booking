import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { Inquiry } from "@/lib/types";
import { InquiriesView } from "./view";

export const metadata: Metadata = { title: "Inquiries" };

export default async function InquiriesPage(props: PageProps<"/o/[org]/inquiries">) {
  const { org: slug } = await props.params;
  const { org, isAdmin } = await getOrgContext(slug);
  const supabase = await createClient();
  const { data } = await supabase
    .from("inquiries")
    .select("id, org_id, customer_id, service_id, service_name, name, email, phone, message, status, note, created_at, handled_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(300);
  return (
    <InquiriesView
      slug={slug}
      orgName={org.name}
      timezone={org.timezone}
      isAdmin={isAdmin}
      enabled={org.inquiries_enabled}
      inquiries={(data ?? []) as Inquiry[]}
    />
  );
}
