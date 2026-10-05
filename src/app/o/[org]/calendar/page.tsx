import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { addDaysToKey, startOfDayInZone, todayKey, weekdayOfKey } from "@/lib/format";
import type { AvailabilityRule, Booking, Customer, Location, Service, Shift, TimeOff } from "@/lib/types";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage(props: PageProps<"/o/[org]/calendar">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, members, me } = await getOrgContext(slug);
  const tz = org.timezone;

  const view = sp.view === "week" ? "week" : "day";
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey(tz);
  // Weeks start on Monday.
  const weekStart = addDaysToKey(date, -((weekdayOfKey(date) + 6) % 7));
  const rangeStart = view === "week" ? weekStart : date;
  const rangeEnd = addDaysToKey(rangeStart, view === "week" ? 7 : 1);

  const supabase = await createClient();
  const [bookings, services, rules, timeOff, customers, locations, shifts] = await Promise.all([
    supabase
      .from("bookings")
      .select("*, customer:customers(id, name, email, phone)")
      .eq("org_id", org.id)
      .gte("starts_at", startOfDayInZone(rangeStart, tz).toISOString())
      .lt("starts_at", startOfDayInZone(rangeEnd, tz).toISOString())
      .neq("status", "cancelled")
      .order("starts_at"),
    supabase.from("services").select("*").eq("org_id", org.id).order("position"),
    supabase.from("availability_rules").select("*").eq("org_id", org.id),
    supabase
      .from("time_off")
      .select("*")
      .eq("org_id", org.id)
      .lt("starts_at", startOfDayInZone(rangeEnd, tz).toISOString())
      .gt("ends_at", startOfDayInZone(rangeStart, tz).toISOString()),
    supabase.from("customers").select("id, name, email, phone").eq("org_id", org.id).order("name").limit(500),
    supabase.from("locations").select("*").eq("org_id", org.id).eq("active", true).order("position").order("created_at"),
    org.schedule_mode === "shifts"
      ? supabase.from("shifts").select("*").eq("org_id", org.id).gte("day", rangeStart).lt("day", rangeEnd)
      : Promise.resolve({ data: [] as Shift[] }),
  ]);

  return (
    <CalendarView
      slug={slug}
      org={org}
      view={view}
      date={date}
      rangeStart={rangeStart}
      members={members}
      meId={me.id}
      bookings={(bookings.data ?? []) as Booking[]}
      services={(services.data ?? []) as Service[]}
      rules={(rules.data ?? []) as AvailabilityRule[]}
      timeOff={(timeOff.data ?? []) as TimeOff[]}
      customers={(customers.data ?? []) as Customer[]}
      locations={(locations.data ?? []) as Location[]}
      shifts={(shifts.data ?? []) as Shift[]}
      welcome={sp.welcome === "1"}
    />
  );
}
