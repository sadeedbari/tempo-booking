import { notFound } from "next/navigation";
import { todayKey } from "@/lib/format";
import { Sidebar } from "@/components/app/sidebar";
import { CalendarView } from "@/app/o/[org]/calendar/calendar-view";
import { ServicesView } from "@/app/o/[org]/services/view";
import { TeamView } from "@/app/o/[org]/team/view";
import { AvailabilityView } from "@/app/o/[org]/availability/view";
import { ScheduleView } from "@/app/o/[org]/schedule/view";
import { periodDays, periodStart } from "@/lib/schedule";
import { weekdayOfKey } from "@/lib/format";
import type { Shift } from "@/lib/types";
import { BookingPreview } from "../booking-preview";
import { org, members, services, rules, customers, bookings } from "../fixtures";

export default async function Preview(props: PageProps<"/preview/[page]">) {
  // Design previews with sample data — available in development only.
  if (process.env.NODE_ENV === "production") notFound();
  const { page } = await props.params;
  const sp = await props.searchParams;
  if (page === "booking") return <BookingPreview service={typeof sp.service === "string" ? sp.service : undefined} />;
  const day = todayKey(org.timezone);
  const shell = (c: React.ReactNode) => (
    <div className="min-h-dvh">
      <Sidebar org={{ ...org, role: "owner" }} orgs={[{ ...org, role: "owner" }]} me={{ name: "Maya Chen", email: "maya@lumen.studio", color: "#007AFF" }} />
      <main className="pb-24 lg:pb-10 lg:pl-[260px]"><div className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-8 sm:pt-10">{c}</div></main>
    </div>
  );
  if (page === "calendar")
    return shell(<CalendarView slug="lumen" org={org} view={sp.view === "week" ? "week" : "day"} date={day} rangeStart={day} members={members} meId="m1" bookings={bookings(day)} services={services} rules={rules} timeOff={[]} customers={customers} locations={[]} shifts={[]} />);
  if (page === "schedule") {
    const period = sp.view === "month" ? "month" : "week";
    const start = periodStart(period, day);
    const days = periodDays(period, start);
    // Sample roster: weekdays 9–5, Aisha on a split shift, Jordan off Wednesdays.
    const shifts: Shift[] = days.flatMap((d) =>
      members.flatMap((mm, i): Shift[] => {
        const wd = weekdayOfKey(d);
        if (wd === 0 || wd === 6 || (i === 1 && wd === 3)) return [];
        const mk = (n: number, s: string, e: string): Shift => ({ id: `${mm.id}-${d}-${n}`, org_id: "o1", member_id: mm.id, location_id: null, day: d, start_time: s, end_time: e });
        return i === 2 ? [mk(1, "09:00", "12:00"), mk(2, "14:00", "18:00")] : [mk(1, "09:00", "17:00")];
      }),
    );
    return shell(<ScheduleView slug="lumen" org={org} period={period} start={start} days={days} today={day} members={members} meId="m1" isAdmin={sp.as !== "staff"} shifts={shifts} locations={[]} />);
  }
  if (page === "services") return shell(<ServicesView slug="lumen" org={org} services={services} staffMap={{}} members={members} canEdit />);
  if (page === "team") return shell(<TeamView slug="lumen" members={members} me={members[0]} isAdmin invites={[]} emails={{}} />);
  if (page === "availability") return shell(<AvailabilityView slug="lumen" org={org} members={members} memberId="m1" rules={rules.filter((r) => r.member_id === "m1")} timeOff={[]} />);
  return null;
}
