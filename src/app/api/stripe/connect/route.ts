import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getOrgContext, getUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createConnectedAccount, onboardingLink } from "@/lib/stripe-connect";

/**
 * "Connect Stripe" button target.
 *  - First time (or setup unfinished): sends the owner to Stripe's hosted onboarding, which
 *    returns to /api/stripe/return. A business that already has a Stripe login can sign in there.
 *  - Already connected with ?manage=1: opens their Stripe dashboard.
 * Stripe also uses this address as the refresh URL when an onboarding link expires, so the
 * owner just gets a fresh link instead of a dead end.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const { org, isAdmin } = await getOrgContext(slug);
  const back = (status: string, reason?: string) =>
    NextResponse.redirect(new URL(`/o/${slug}/settings?stripe=${status}${reason ? `&reason=${reason}` : ""}`, request.url));

  if (!isAdmin || !getStripe()) return back("error");

  try {
    let accountId = org.stripe_account_id;

    if (accountId && org.stripe_charges_enabled && request.nextUrl.searchParams.get("manage") === "1") {
      return NextResponse.redirect("https://dashboard.stripe.com/");
    }

    if (!accountId) {
      accountId = await createConnectedAccount(org, (await getUser())?.email ?? undefined);
      // Stripe fields are write-protected from the client; use the service role.
      await createAdminClient().from("organizations").update({ stripe_account_id: accountId }).eq("id", org.id);
    }

    return NextResponse.redirect(await onboardingLink(accountId, slug));
  } catch (e) {
    const message = (e as Error).message ?? "";
    console.error("[stripe] connect failed", message);
    // Tell the owner what to fix for the common cases.
    if (/signed up for Connect|Connect/i.test(message) && /sign|enabled|platform/i.test(message)) return back("error", "connect_disabled");
    if (/Invalid API Key|api_key|Expired API Key/i.test(message)) return back("error", "bad_key");
    return back("error");
  }
}
