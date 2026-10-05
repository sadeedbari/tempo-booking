import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { features } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, verifyState } from "@/lib/calendar/crypto";
import { emailFromIdToken, exchangeCode } from "@/lib/calendar/google";
import { refreshExternalBusy } from "@/lib/calendar/sync";

/** Google redirects here after the user approves (or declines) calendar access. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const back = (slug: string, result: string) => NextResponse.redirect(new URL(`/o/${slug}/team?calendar=${result}`, request.url));

  if (!features.calendar) return NextResponse.redirect(new URL("/app", request.url));
  const state = verifyState(sp.get("state") ?? "");
  if (!state) return NextResponse.redirect(new URL("/app", request.url));
  const slug = state.slug;

  if (sp.get("error") || !sp.get("code")) return back(slug, "denied");

  // The person finishing the flow must be the one who started it.
  const { org, me } = await getOrgContext(slug);
  if (me.id !== state.member || me.user_id !== state.user || org.id !== state.org) return back(slug, "error");

  try {
    const t = await exchangeCode(sp.get("code")!);
    if (!t.refresh_token) return back(slug, "error");
    const admin = createAdminClient();
    const { error } = await admin.from("calendar_connections").upsert(
      {
        org_id: org.id,
        member_id: me.id,
        provider: "google",
        external_email: emailFromIdToken(t.id_token),
        calendar_id: "primary",
        refresh_token_enc: encrypt(t.refresh_token),
        access_token_enc: encrypt(t.access_token),
        access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        status: "active",
      },
      { onConflict: "member_id,provider" },
    );
    if (error) throw error;
    // Prime the mirror so existing events block slots right away.
    const from = new Date().toISOString();
    const to = new Date(Date.now() + org.max_advance_days * 86_400_000).toISOString();
    await refreshExternalBusy(org.id, from, to, { memberId: me.id });
    return back(slug, "connected");
  } catch (e) {
    console.error("[google] callback failed", (e as Error).message);
    return back(slug, "error");
  }
}
