import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { Booking, Service } from "@/lib/types";
import { BookingsList } from "./list";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage(props: PageProps<"/o/[org]/bookings">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const tab = sp.tab === "past" || sp.tab === "cancelled" ? sp.tab : "upcoming";
  const { org, members } = await getOrgContext(slug);
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  let q = supabase
    .from("bookings")
    .select("*, customer:customers(id, name, email, phone)")
    .eq("org_id", org.id)
    .limit(200);
  if (tab === "upcoming") q = q.gte("starts_at", nowIso).in("status", ["confirmed", "pending_payment", "pending_approval"]).order("starts_at");
  if (tab === "past") q = q.lt("starts_at", nowIso).neq("status", "cancelled").order("starts_at", { ascending: false });
  if (tab === "cancelled") q = q.eq("status", "cancelled").order("starts_at", { ascending: false });

  const [{ data: bookings }, { data: services }] = await Promise.all([
    q,
    supabase.from("services").select("*").eq("org_id", org.id),
  ]);

  return (
    <BookingsList
      slug={slug}
      org={org}
      tab={tab}
      bookings={(bookings ?? []) as Booking[]}
      services={(services ?? []) as Service[]}
      members={members.filter((m) => m.bookable)}
      allMembers={members}
    />
  );
}
