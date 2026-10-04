import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Membership, Organization } from "@/lib/types";

export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export async function requireUser(next?: string) {
  const user = await getUser();
  if (!user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}

export interface OrgContext {
  org: Organization;
  me: Membership;
  members: Membership[];
  isAdmin: boolean;
  isOwner: boolean;
}

/** Loads the team for a slug and the signed-in user's membership in it. */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser(`/o/${slug}`);
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("*").eq("slug", slug).maybeSingle();
  if (!org) notFound();
  const { data: members } = await supabase
    .from("memberships")
    .select("*")
    .eq("org_id", org.id)
    .order("created_at");
  const me = (members ?? []).find((m) => m.user_id === user.id);
  if (!me) notFound();
  return {
    org: org as Organization,
    me: me as Membership,
    members: (members ?? []) as Membership[],
    isAdmin: me.role === "owner" || me.role === "admin",
    isOwner: me.role === "owner",
  };
});

export const getMyOrgs = cache(async () => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, slug, accent_color)")
    .eq("user_id", user.id)
    .order("created_at");
  return (data ?? [])
    .map((r) => ({ role: r.role as string, ...(r.organizations as unknown as Pick<Organization, "id" | "name" | "slug" | "accent_color">) }))
    .filter((o) => o.slug);
});
