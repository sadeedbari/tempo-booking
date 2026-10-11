import "server-only";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Refunds a booking's paid deposit in full, including Tempo's fee. A no-op when nothing was paid.
 */
export async function refundDeposit(bookingId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: b } = await admin.from("bookings").select("id, payment_status, stripe_checkout_session_id, org:organizations(stripe_account_id)").eq("id", bookingId).single();
  if (!b || b.payment_status !== "paid" || !b.stripe_checkout_session_id) return { ok: true };
  const accountId = (b.org as unknown as { stripe_account_id: string | null } | null)?.stripe_account_id;
  if (!accountId) return { ok: false, error: "Couldn't find the Stripe account to refund from." };

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe isn't configured, so the deposit couldn't be refunded." };
  try {
    // The deposit was charged on the business's own account, so refund it from there.
    const session = await stripe.checkout.sessions.retrieve(b.stripe_checkout_session_id, undefined, { stripeAccount: accountId });
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntent) return { ok: false, error: "Couldn't find the payment to refund." };
    await stripe.refunds.create({ payment_intent: paymentIntent, refund_application_fee: true }, { stripeAccount: accountId });
    await admin.from("bookings").update({ payment_status: "refunded" }).eq("id", bookingId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Refund failed: ${(e as Error).message}` };
  }
}
