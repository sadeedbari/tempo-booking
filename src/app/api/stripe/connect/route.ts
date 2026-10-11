import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getOrgContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * "Connect Stripe" button target.
 *  - First time (or setup unfinished): sends the owner to Stripe's hosted onboarding, which
 *    returns to /api/stripe/return.
 *  - Already connected with ?manage=1: opens their Stripe Express dashboard.
 * Stripe also uses this address as the refresh URL when an onboarding link expires, so the
 * owner just gets a fresh link instead of a dead end.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const { org, isAdmin } = await getOrgContext(slug);
  const back = (status: string) => NextResponse.redirect(new URL(`/o/${slug}/settings?stripe=${status}`, request.url));

  const stripe = getStripe();
  if (!isAdmin || !stripe) return back("error");

  try {
    let accountId = org.stripe_account_id;

    if (accountId && org.stripe_charges_enabled && request.nextUrl.searchParams.get("manage") === "1") {
      const login = await stripe.accounts.createLoginLink(accountId);
      return NextResponse.redirect(login.url);
    }

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        business_profile: { name: org.name, url: org.website || undefined },
        metadata: { org_id: org.id },
      });
      accountId = account.id;
      // Stripe fields are write-protected from the client; use the service role.
      await createAdminClient().from("organizations").update({ stripe_account_id: accountId }).eq("id", org.id);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${env.appUrl}/api/stripe/connect?org=${encodeURIComponent(slug)}`,
      return_url: `${env.appUrl}/api/stripe/return?org=${encodeURIComponent(slug)}`,
      type: "account_onboarding",
    });
    return NextResponse.redirect(link.url);
  } catch (e) {
    console.error("[stripe] connect failed", (e as Error).message);
    return back("error");
  }
}
