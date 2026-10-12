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
import { org, members, services, rules, customers, bookings, dashboardSample } from "../fixtures";
import { DashboardView } from "@/app/o/[org]/dashboard/view";
import { buildDashboard } from "@/lib/dashboard";
import { WorkflowsView } from "@/app/o/[org]/workflows/view";
import { WorkflowEditor } from "@/app/o/[org]/workflows/[id]/editor";
import { DEFAULT_WORKFLOWS, STARTERS, type EditableWorkflow } from "@/lib/workflow-defaults";

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
  if (page === "workflows") {
    const list = DEFAULT_WORKFLOWS.map((d, i) => ({ id: `w${i}`, name: d.name, trigger: d.trigger, offset_minutes: d.offset_minutes, active: i !== 2, all_services: i !== 5, default_key: d.key, steps: d.steps.map((x) => ({ channel: x.channel, enabled: true })), services: i === 5 ? [{ service_id: "haircut" }] : [] }));
    const log = [
      { id: "l1", workflow_name: "Appointment reminder", channel: "email" as const, recipient: "ada.lovelace@example.com", status: "sent" as const, detail: null, created_at: new Date().toISOString() },
      { id: "l2", workflow_name: "Booking confirmed", channel: "sms" as const, recipient: "+14165551234", status: "failed" as const, detail: "Twilio error 30032", created_at: new Date().toISOString() },
    ];
    return shell(<WorkflowsView slug="lumen" timezone={org.timezone} workflows={list} log={log} tab={sp.tab === "activity" ? "activity" : "workflows"} emailReady smsReady={false} />);
  }
  if (page === "workflow") {
    const d = DEFAULT_WORKFLOWS[sp.k === "confirmed" ? 0 : 5];
    const w: EditableWorkflow = sp.new ? { ...STARTERS[1], active: true, all_services: true, service_ids: [], default_key: null, steps: STARTERS[1].steps.map((x) => ({ ...x, enabled: true })) } : { id: "00000000-0000-0000-0000-000000000000", name: d.name, trigger: d.trigger, offset_minutes: d.offset_minutes, active: true, all_services: true, service_ids: [], default_key: d.key, steps: d.steps.map((x) => ({ ...x, enabled: true })) };
    return shell(<WorkflowEditor slug="lumen" initial={w} services={services.map((x) => ({ id: x.id, name: x.name, color: x.color }))} business={{ name: org.name, phone: org.phone, accent: org.accent_color }} />);
  }
  if (page === "dashboard") {
    const rangeDays = [7, 30, 90].includes(Number(sp.range)) ? Number(sp.range) : 30;
    const nowD = new Date();
    const { list, custs } = dashboardSample(day);
    const dash = buildDashboard({ bookings: list, customers: custs, rules, shifts: [], scheduleMode: "availability", memberIds: members.map((m) => m.id), tz: org.timezone, today: day, rangeDays, now: nowD });
    return shell(<DashboardView slug="lumen" org={org} me={members[0]} members={members} isAdmin={sp.as !== "staff"} d={dash} rangeDays={rangeDays} now={nowD} today={day} basePath="/preview/dashboard" facts={{ services: 5, hasHours: true, hasOnlineBooking: false }} />);
  }
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
  if (page === "team") return shell(<TeamView slug="lumen" members={[...members, { ...members[2], id: "m4", user_id: null, email: "priya@lumen.studio", display_name: "Priya Shah", title: null, color: "#FF9500" }, { ...members[2], id: "m5", user_id: null, email: null, display_name: "Sam Ortiz", title: "Front desk", color: "#FF2D55" }]} me={members[0]} isAdmin invites={[{ id: "i1", org_id: "o1", member_id: "m4", email: "priya@lumen.studio", role: "member", token: "t", accepted_at: null, expires_at: "2026-10-19T12:00:00Z", created_at: "" }]} emails={{}} />);
  if (page === "availability") return shell(<AvailabilityView slug="lumen" org={org} members={members} memberId="m1" rules={rules.filter((r) => r.member_id === "m1")} timeOff={[]} />);
  return null;
}
