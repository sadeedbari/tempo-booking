import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgContext } from "@/lib/auth";

/** Stripe Connect onboarding returns here; refresh the account's status. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const { org, isAdmin } = await getOrgContext(slug);
  const stripe = getStripe();
  if (isAdmin && stripe && org.stripe_account_id) {
    const account = await stripe.accounts.retrieve(org.stripe_account_id);
    await createAdminClient()
      .from("organizations")
      .update({ stripe_charges_enabled: Boolean(account.charges_enabled) })
      .eq("id", org.id);
    return NextResponse.redirect(new URL(`/o/${slug}/settings?stripe=${account.charges_enabled ? "connected" : "pending"}`, request.url));
  }
  return NextResponse.redirect(new URL(`/o/${slug}/settings`, request.url));
}
