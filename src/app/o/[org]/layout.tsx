import { getMyOrgs, getOrgContext, requireUser } from "@/lib/auth";
import { InstallBanner } from "@/components/app/pwa";
import { Sidebar } from "@/components/app/sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function OrgLayout(props: LayoutProps<"/o/[org]">) {
  const { org: slug } = await props.params;
  const user = await requireUser(`/o/${slug}`);
  const ctx = await getOrgContext(slug);
  const orgs = await getMyOrgs();
  const { count: pendingApprovals } = await (await createClient())
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.org.id)
    .eq("status", "pending_approval");

  return (
    <div className="min-h-dvh">
      <Sidebar
        org={{ ...ctx.org, role: ctx.me.role }}
        orgs={orgs}
        me={{ name: ctx.me.display_name, email: user.email ?? "", color: ctx.me.color }}
        pendingApprovals={pendingApprovals ?? 0}
      />
      <main className="pb-28 lg:pb-10 lg:pl-[260px]">
        <div className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-8 sm:pt-10"><InstallBanner />
        {props.children}</div>
      </main>
    </div>
  );
}
