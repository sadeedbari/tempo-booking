import { notFound } from "next/navigation";
import { todayKey } from "@/lib/format";
import { Sidebar } from "@/components/app/sidebar";
import { CalendarView } from "@/app/o/[org]/calendar/calendar-view";
import { ServicesView } from "@/app/o/[org]/services/view";
import { TeamView } from "@/app/o/[org]/team/view";
import { AvailabilityView } from "@/app/o/[org]/availability/view";
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
    return shell(<CalendarView slug="lumen" org={org} view={sp.view === "week" ? "week" : "day"} date={day} rangeStart={day} members={members} meId="m1" bookings={bookings(day)} services={services} rules={rules} timeOff={[]} customers={customers} />);
  if (page === "services") return shell(<ServicesView slug="lumen" org={org} services={services} staffMap={{}} members={members} canEdit />);
  if (page === "team") return shell(<TeamView slug="lumen" members={members} me={members[0]} isAdmin invites={[]} emails={{}} />);
  if (page === "availability") return shell(<AvailabilityView slug="lumen" org={org} members={members} memberId="m1" rules={rules.filter((r) => r.member_id === "m1")} timeOff={[]} />);
  return null;
}
