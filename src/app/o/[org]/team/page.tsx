import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import type { Invitation } from "@/lib/types";
import { TeamView } from "./view";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage(props: PageProps<"/o/[org]/team">) {
  const { org: slug } = await props.params;
  const { org, members, me, isAdmin } = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: invites }, { data: profiles }] = await Promise.all([
    isAdmin
      ? supabase.from("invitations").select("*").eq("org_id", org.id).is("accepted_at", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id, email"),
  ]);
  const emails = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.email]));
  return <TeamView slug={slug} members={members} me={me} isAdmin={isAdmin} invites={(invites ?? []) as Invitation[]} emails={emails} />;
}
