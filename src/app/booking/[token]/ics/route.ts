import { createClient } from "@/lib/supabase/server";

function ics(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(_: Request, ctx: RouteContext<"/booking/[token]/ics">) {
  const { token } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_booking_by_token", { p_token: token });
  if (!data) return new Response("Not found", { status: 404 });
  const b = data as { id: string; starts_at: string; ends_at: string; service_name: string; staff_name: string | null; location_detail: string | null; org: { name: string; address: string | null } };
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tempo//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.id}@tempo`,
    `DTSTAMP:${ics(new Date())}`,
    `DTSTART:${ics(new Date(b.starts_at))}`,
    `DTEND:${ics(new Date(b.ends_at))}`,
    `SUMMARY:${esc(`${b.service_name} — ${b.org.name}`)}`,
    `DESCRIPTION:${esc(`${b.staff_name ? `With ${b.staff_name}. ` : ""}Manage: ${new URL(`/booking/${token}`, _.url).toString()}`)}`,
    ...(b.location_detail || b.org.address ? [`LOCATION:${esc(b.location_detail || b.org.address || "")}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="booking.ics"`,
    },
  });
}
