import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseRange } from "@/lib/dashboard";
import { loadDashboard } from "@/lib/dashboard-data";
import { customerSheets, homeSheets } from "@/lib/exports";
import { scheduleSheets } from "@/lib/exports";
import { workbookBuffer, XLSX_MIME, type Sheet } from "@/lib/excel";
import { periodDays, periodStart, type SchedulePeriod } from "@/lib/schedule";
import { todayKey } from "@/lib/format";
import type { Customer, Location, Shift } from "@/lib/types";

/**
 * Excel downloads: /api/export/{home|customers|schedule}?org=<slug>.
 * Everything is limited to what the signed-in person may see in the app: staff get only their own
 * work, and the customer list is for owners and admins.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/[kind]">) {
  const { kind } = await ctx.params;
  const sp = request.nextUrl.searchParams;
  const slug = sp.get("org") ?? "";
  const octx = await getOrgContext(slug); // sends signed-out visitors to sign in, and non-members to a 404
  const { org, members, me, isAdmin } = octx;
  const tz = org.timezone;
  const today = todayKey(tz);

  let sheets: Sheet[];
  let name: string;

  if (kind === "home") {
    const rangeDays = parseRange(sp.get("range"));
    const { d, bookings } = await loadDashboard(octx, rangeDays);
    sheets = homeSheets({ d, bookings, members, isAdmin, tz, currency: org.currency });
    name = `home-${today}-last-${rangeDays}-days`;
  } else if (kind === "customers") {
    if (!isAdmin) return new Response("Only owners and admins can export customers.", { status: 403 });
    const supabase = await createClient();
    const [{ data: customers }, { data: bookings }] = await Promise.all([
      supabase.from("customers").select("*").eq("org_id", org.id).order("name"),
      supabase.from("bookings").select("customer_id, starts_at, status, price_cents").eq("org_id", org.id).neq("status", "cancelled").limit(50000),
    ]);
    const stats: Record<string, { visits: number; last: string | null; spent: number }> = {};
    for (const b of bookings ?? []) {
      if (!b.customer_id) continue;
      const a = (stats[b.customer_id] ??= { visits: 0, last: null, spent: 0 });
      a.visits++;
      if (!a.last || b.starts_at > a.last) a.last = b.starts_at;
      if (b.status === "completed") a.spent += b.price_cents;
    }
    sheets = customerSheets({ customers: (customers ?? []) as Customer[], stats, tz, currency: org.currency });
    name = `customers-${today}`;
  } else if (kind === "schedule") {
    const period: SchedulePeriod = sp.get("view") === "month" ? "month" : "week";
    const raw = sp.get("date") ?? "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
    const start = periodStart(period, date);
    const days = periodDays(period, start);
    const supabase = await createClient();
    const [{ data: shifts }, { data: locations }] = await Promise.all([
      supabase.from("shifts").select("*").eq("org_id", org.id).gte("day", days[0]).lte("day", days[days.length - 1]).order("day").order("start_time"),
      supabase.from("locations").select("*").eq("org_id", org.id).order("position").order("created_at"),
    ]);
    const bookable = members.filter((m) => m.bookable);
    const people = isAdmin ? bookable : bookable.filter((m) => m.id === me.id);
    sheets = scheduleSheets({
      days,
      shifts: ((shifts ?? []) as Shift[]).filter((s) => people.some((p) => p.id === s.member_id)),
      members: people,
      locations: (locations ?? []) as Location[],
      period,
    });
    name = `schedule-${period === "week" ? "week" : "month"}-${days[0]}`;
  } else {
    return new Response("Unknown export.", { status: 404 });
  }

  const buffer = await workbookBuffer(sheets);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="tempo-${org.slug}-${name}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
