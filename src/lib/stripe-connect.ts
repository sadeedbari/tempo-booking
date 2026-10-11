import "server-only";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe Connect with Managed Risk: each business gets its own connected account with the full
 * Stripe Dashboard. Stripe (not Tempo) absorbs losses, which means payments are *direct
 * charges*: they're created on the business's account (the `stripeAccount` request option),
 * with Tempo's fee taken as an application fee.
 */

// Hosted onboarding collects the country when we can't infer it.
const COUNTRY_BY_CURRENCY: Record<string, string> = { CAD: "CA", USD: "US", GBP: "GB", AUD: "AU", NZD: "NZ" };

export async function createConnectedAccount(org: { id: string; name: string; currency: string }, contactEmail?: string) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe isn't configured");
  const country = COUNTRY_BY_CURRENCY[org.currency.toUpperCase()];
  const account = await stripe.v2.core.accounts.create({
    display_name: org.name,
    ...(contactEmail ? { contact_email: contactEmail } : {}),
    dashboard: "full",
    ...(country ? { identity: { country } } : {}),
    defaults: {
      currency: org.currency.toLowerCase(),
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
    },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    metadata: { org_id: org.id },
  });
  return account.id;
}

export async function onboardingLink(accountId: string, slug: string) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe isn't configured");
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: `${env.appUrl}/api/stripe/connect?org=${encodeURIComponent(slug)}`,
        return_url: `${env.appUrl}/api/stripe/return?org=${encodeURIComponent(slug)}`,
      },
    },
  });
  return link.url;
}

/** True once the account can take card payments. */
export async function accountCanCharge(accountId: string) {
  const stripe = getStripe();
  if (!stripe) return false;
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant"] });
  return account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
}

/** Re-checks Stripe and stores the result. Never throws. */
export async function syncChargesEnabled(orgId: string, accountId: string) {
  try {
    const enabled = await accountCanCharge(accountId);
    await createAdminClient().from("organizations").update({ stripe_charges_enabled: enabled }).eq("id", orgId);
    return enabled;
  } catch (e) {
    console.error("[stripe] status sync failed", (e as Error).message);
    return null;
  }
}
