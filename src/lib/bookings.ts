import "server-only";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Refunds a booking's paid deposit in full (reversing the transfer to the
 * business's Stripe account). A no-op when nothing was paid.
 */
export async function refundDeposit(bookingId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: b } = await admin.from("bookings").select("id, payment_status, stripe_checkout_session_id").eq("id", bookingId).single();
  if (!b || b.payment_status !== "paid" || !b.stripe_checkout_session_id) return { ok: true };

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe isn't configured, so the deposit couldn't be refunded." };
  try {
    const session = await stripe.checkout.sessions.retrieve(b.stripe_checkout_session_id);
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntent) return { ok: false, error: "Couldn't find the payment to refund." };
    await stripe.refunds.create({ payment_intent: paymentIntent, reverse_transfer: true });
    await admin.from("bookings").update({ payment_status: "refunded" }).eq("id", bookingId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Refund failed: ${(e as Error).message}` };
  }
}
