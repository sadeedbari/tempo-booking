import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { Customer } from "@/lib/types";
import { CustomersView } from "./view";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage(props: PageProps<"/o/[org]/customers">) {
  const { org: slug } = await props.params;
  const { org, isAdmin } = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: customers }, { data: stats }] = await Promise.all([
    supabase.from("customers").select("*").eq("org_id", org.id).order("name"),
    supabase.from("bookings").select("customer_id, starts_at, status, price_cents").eq("org_id", org.id).neq("status", "cancelled"),
  ]);
  const agg: Record<string, { visits: number; last: string | null; spent: number }> = {};
  (stats ?? []).forEach((b) => {
    if (!b.customer_id) return;
    const a = (agg[b.customer_id] ??= { visits: 0, last: null, spent: 0 });
    a.visits++;
    if (!a.last || b.starts_at > a.last) a.last = b.starts_at;
    if (b.status === "completed") a.spent += b.price_cents;
  });
  return <CustomersView slug={slug} org={org} canDelete={isAdmin} customers={(customers ?? []) as Customer[]} stats={agg} />;
}
