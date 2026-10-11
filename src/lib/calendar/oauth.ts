import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, signState, verifyState } from "./crypto";
import { getProvider } from "./providers";
import { refreshExternalBusy } from "./sync";
import type { ProviderId } from "./provider";

/** Starts the OAuth flow for the signed-in team member's own calendar. */
export async function startConnect(request: NextRequest, id: ProviderId) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const { org, me } = await getOrgContext(slug);
  const provider = getProvider(id);
  if (!provider) return NextResponse.redirect(new URL(`/o/${slug}/team?calendar=unavailable`, request.url));
  const state = signState({ org: org.id, slug, member: me.id, user: me.user_id, provider: id });
  return NextResponse.redirect(provider.authUrl(state));
}

/** The provider redirects here after the user approves (or declines) calendar access. */
export async function finishConnect(request: NextRequest, id: ProviderId) {
  const sp = request.nextUrl.searchParams;
  const provider = getProvider(id);
  const home = NextResponse.redirect(new URL("/app", request.url));
  if (!provider) return home;
  const state = verifyState(sp.get("state") ?? "");
  if (!state || state.provider !== id) return home;
  const slug = state.slug;
  const back = (result: string) => NextResponse.redirect(new URL(`/o/${slug}/team?calendar=${result}`, request.url));

  if (sp.get("error") || !sp.get("code")) return back("denied");

  // The person finishing the flow must be the one who started it.
  const { org, me } = await getOrgContext(slug);
  if (me.id !== state.member || me.user_id !== state.user || org.id !== state.org) return back("error");

  try {
    const t = await provider.exchangeCode(sp.get("code")!);
    if (!t.refreshToken) return back("error");
    const { error } = await createAdminClient().from("calendar_connections").upsert(
      {
        org_id: org.id,
        member_id: me.id,
        provider: id,
        external_email: t.email ?? null,
        calendar_id: "primary",
        refresh_token_enc: encrypt(t.refreshToken),
        access_token_enc: encrypt(t.accessToken),
        access_expires_at: new Date(Date.now() + t.expiresIn * 1000).toISOString(),
        status: "active",
      },
      { onConflict: "member_id,provider" },
    );
    if (error) throw error;
    // Prime the mirror so existing events block slots right away.
    await refreshExternalBusy(org.id, new Date().toISOString(), new Date(Date.now() + org.max_advance_days * 86_400_000).toISOString(), { memberId: me.id });
    return back("connected");
  } catch (e) {
    // The person left the calendar permission unticked: not a failure, just not connected.
    if ((e as { code?: string }).code === "missing_scope") return back("denied");
    console.error(`[calendar:${id}] callback failed`, (e as Error).message);
    return back("error");
  }
}
