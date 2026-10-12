import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth";
import { parseRange } from "@/lib/dashboard";
import { loadDashboard } from "@/lib/dashboard-data";
import { DashboardView } from "./view";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage(props: PageProps<"/o/[org]/dashboard">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const ctx = await getOrgContext(slug);
  const rangeDays = parseRange(sp.range);
  const { d, now, today, facts } = await loadDashboard(ctx, rangeDays);

  return (
    <DashboardView
      slug={slug}
      org={ctx.org}
      me={ctx.me}
      members={ctx.members}
      isAdmin={ctx.isAdmin}
      d={d}
      rangeDays={rangeDays}
      now={now}
      today={today}
      facts={facts}
    />
  );
}
