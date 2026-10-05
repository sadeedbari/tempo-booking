import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { Invitation } from "@/lib/types";
import { features } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { availableProviders } from "@/lib/calendar/providers";
import { CalendarCard } from "./calendar-card";
import { TeamView } from "./view";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage(props: PageProps<"/o/[org]/team">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, members, me, isAdmin } = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: invites }, { data: profiles }] = await Promise.all([
    isAdmin
      ? supabase.from("invitations").select("*").eq("org_id", org.id).is("accepted_at", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id, email"),
  ]);
  const emails = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.email]));

  // Tokens never leave the server: only the connected address and state are read.
  const providers = availableProviders();
  const connections: Record<string, { email: string | null; needsReauth: boolean }> = {};
  if (features.calendar) {
    const { data } = await createAdminClient().from("calendar_connections").select("provider, external_email, status").eq("member_id", me.id);
    (data ?? []).forEach((c) => (connections[c.provider] = { email: c.external_email, needsReauth: c.status !== "active" }));
  }
  return (
    <>
      <TeamView slug={slug} members={members} me={me} isAdmin={isAdmin} invites={(invites ?? []) as Invitation[]} emails={emails} />
      <div className="mt-10">
        <CalendarCard slug={slug} providers={providers} connections={connections} result={typeof sp.calendar === "string" ? sp.calendar : undefined} />
      </div>
    </>
  );
}
