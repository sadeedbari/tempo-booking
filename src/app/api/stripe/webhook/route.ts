import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyBooking } from "@/lib/notify";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe || !env.stripeWebhookSecret) return new Response("Stripe not configured", { status: 501 });

  const body = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.stripeWebhookSecret);
  } catch (e) {
    return new Response(`Invalid signature: ${(e as Error).message}`, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.booking_id;
      if (bookingId && session.payment_status === "paid") {
        const { data: org } = await admin.from("bookings").select("org:organizations(booking_confirmation, stripe_account_id)").eq("id", bookingId).single();
        const o = org?.org as unknown as { booking_confirmation: string; stripe_account_id: string | null } | null;
        // The charge must have happened on this booking's own business's Stripe account.
        if (!o || (event.account && o.stripe_account_id !== event.account)) break;
        const manual = o.booking_confirmation === "manual";
        const { data } = await admin
          .from("bookings")
          .update({ status: manual ? "pending_approval" : "confirmed", payment_status: "paid" })
          .eq("id", bookingId)
          .eq("status", "pending_payment")
          .select("id");
        if (data?.length) await notifyBooking(bookingId, manual ? "request" : "confirmation");
      }
      break;
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.booking_id;
      if (bookingId) {
        await admin
          .from("bookings")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Payment not completed" })
          .eq("id", bookingId)
          .eq("status", "pending_payment");
      }
      break;
    }
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await admin
        .from("organizations")
        .update({ stripe_charges_enabled: Boolean(account.charges_enabled) })
        .eq("stripe_account_id", account.id);
      break;
    }
  }

  return Response.json({ received: true });
}
