import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { features } from "@/lib/env";
import { signState } from "@/lib/calendar/crypto";
import { authUrl } from "@/lib/calendar/google";

/** Starts the Google OAuth flow for the signed-in team member's own calendar. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const { org, me } = await getOrgContext(slug);
  if (!features.calendar) return NextResponse.redirect(new URL(`/o/${slug}/team?calendar=unavailable`, request.url));
  const state = signState({ org: org.id, slug, member: me.id, user: me.user_id });
  return NextResponse.redirect(authUrl(state));
}
