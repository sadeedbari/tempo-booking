import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { todayKey } from "@/lib/format";
import { periodDays, periodStart } from "@/lib/schedule";
import type { Location, Shift } from "@/lib/types";
import { ScheduleView } from "./view";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage(props: PageProps<"/o/[org]/schedule">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, members, me, isAdmin } = await getOrgContext(slug);

  const period = sp.view === "month" ? "month" : "week";
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey(org.timezone);
  const start = periodStart(period, date);
  const days = periodDays(period, start);

  const supabase = await createClient();
  const [shifts, locations, links] = await Promise.all([
    supabase
      .from("shifts")
      .select("*")
      .eq("org_id", org.id)
      .gte("day", days[0])
      .lte("day", days[days.length - 1])
      .order("day")
      .order("start_time"),
    supabase.from("locations").select("*").eq("org_id", org.id).eq("active", true).order("position").order("created_at"),
    supabase.from("member_locations").select("location_id, member_id"),
  ]);
  const locationList = (locations.data ?? []) as Location[];
  // Which people work at which location (a location nobody is assigned to is open to everyone).
  const locationStaff: Record<string, string[]> = {};
  (links.data ?? []).forEach((r) => (locationStaff[r.location_id] ??= []).push(r.member_id));
  const locationId = typeof sp.location === "string" && locationList.some((l) => l.id === sp.location) ? sp.location : "all";

  return (
    <ScheduleView
      slug={slug}
      org={org}
      period={period}
      start={start}
      days={days}
      today={todayKey(org.timezone)}
      members={members.filter((m) => m.bookable)}
      meId={me.id}
      isAdmin={isAdmin}
      shifts={(shifts.data ?? []) as Shift[]}
      locations={locationList}
      locationStaff={locationStaff}
      locationId={locationId}
    />
  );
}
