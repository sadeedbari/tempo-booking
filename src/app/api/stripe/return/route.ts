import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { syncChargesEnabled } from "@/lib/stripe-connect";

/** Stripe onboarding returns here; re-check the account's status and go back to Settings. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const { org, isAdmin } = await getOrgContext(slug);
  const settings = (status: string) => NextResponse.redirect(new URL(`/o/${slug}/settings?stripe=${status}`, request.url));

  if (!isAdmin || !org.stripe_account_id) return NextResponse.redirect(new URL(`/o/${slug}/settings`, request.url));
  const enabled = await syncChargesEnabled(org.id, org.stripe_account_id);
  if (enabled === null) return settings("error");
  return settings(enabled ? "connected" : "pending");
}
