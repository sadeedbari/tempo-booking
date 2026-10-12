import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { addDaysToKey, startOfDayInZone, todayKey } from "@/lib/format";
import { buildDashboard, type DBooking } from "@/lib/dashboard";
import { DashboardView, RANGES } from "./view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage(props: PageProps<"/o/[org]/dashboard">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, members, me, isAdmin } = await getOrgContext(slug);
  const tz = org.timezone;

  const requested = Number(sp.range);
  const rangeDays = (RANGES as readonly number[]).includes(requested) ? requested : 30;
  const now = new Date();
  const today = todayKey(tz);
  const start = addDaysToKey(today, -(rangeDays - 1));
  const prevStart = addDaysToKey(start, -rangeDays);

  const supabase = await createClient();
  let bookingsQuery = supabase
    .from("bookings")
    .select("id, starts_at, ends_at, status, price_cents, deposit_cents, payment_status, service_id, service_name, member_id, customer_id, source, customer:customers(name)")
    .eq("org_id", org.id)
    .gte("starts_at", startOfDayInZone(prevStart, tz).toISOString())
    .lt("starts_at", startOfDayInZone(addDaysToKey(today, 8), tz).toISOString())
    .order("starts_at")
    .limit(5000);
  // Staff only ever see their own work; money and customer lists are for owners and admins.
  if (!isAdmin) bookingsQuery = bookingsQuery.eq("member_id", me.id);

  const [bookingsRes, customersRes, rulesRes, shiftsRes, servicesRes] = await Promise.all([
    bookingsQuery,
    isAdmin ? supabase.from("customers").select("id, name, created_at").eq("org_id", org.id).limit(5000) : Promise.resolve({ data: [] }),
    supabase.from("availability_rules").select("member_id, weekday, start_time, end_time").eq("org_id", org.id),
    org.schedule_mode === "shifts"
      ? supabase.from("shifts").select("member_id, day, start_time, end_time").eq("org_id", org.id).gte("day", start).lte("day", today)
      : Promise.resolve({ data: [] }),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
  ]);

  const bookings: DBooking[] = (bookingsRes.data ?? []).map((b) => ({
    ...(b as unknown as DBooking),
    customer_name: (b.customer as unknown as { name: string } | null)?.name ?? null,
  }));
  const bookable = members.filter((m) => m.bookable);
  const memberIds = isAdmin ? bookable.map((m) => m.id) : [me.id];

  const d = buildDashboard({
    bookings,
    customers: (customersRes.data ?? []) as { id: string; name: string; created_at: string }[],
    rules: (rulesRes.data ?? []) as { member_id: string; weekday: number; start_time: string; end_time: string }[],
    shifts: (shiftsRes.data ?? []) as { member_id: string; day: string; start_time: string; end_time: string }[],
    scheduleMode: org.schedule_mode,
    memberIds,
    tz,
    today,
    rangeDays,
    now,
  });


  return (
    <DashboardView
      slug={slug}
      org={org}
      me={me}
      members={members}
      isAdmin={isAdmin}
      d={d}
      rangeDays={rangeDays}
      now={now}
      today={today}
      facts={{
        services: servicesRes.count ?? 0,
        hasHours: (rulesRes.data ?? []).length > 0 || org.schedule_mode === "shifts",
        hasOnlineBooking: bookings.some((b) => b.source === "online"),
      }}
    />
  );
}
