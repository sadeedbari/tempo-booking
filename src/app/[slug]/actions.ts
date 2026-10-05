"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyBooking } from "@/lib/notify";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { refreshExternalBusy } from "@/lib/calendar/sync";
import type { BusyInterval } from "@/lib/types";

export async function getBusy(orgId: string, from: string, to: string): Promise<BusyInterval[]> {
  await refreshExternalBusy(orgId, from, to);
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_busy", { p_org: orgId, p_from: from, p_to: to });
  return (data ?? []) as BusyInterval[];
}

export type BookResult =
  | { ok: true; token: string; checkoutUrl?: string }
  | { ok: false; error: string };

export async function book(input: {
  orgId: string;
  slug: string;
  serviceId: string;
  memberId: string | null;
  locationId: string | null;
  startsAt: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
}): Promise<BookResult> {
  // Pull the latest personal-calendar events so a just-added event blocks this slot.
  const slotStart = new Date(input.startsAt).getTime();
  await refreshExternalBusy(input.orgId, new Date(slotStart - 86_400_000).toISOString(), new Date(slotStart + 2 * 86_400_000).toISOString());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_org: input.orgId,
    p_service: input.serviceId,
    p_member: input.memberId,
    p_starts_at: input.startsAt,
    p_name: input.name.slice(0, 120),
    p_email: input.email.slice(0, 200),
    p_phone: input.phone.slice(0, 40),
    p_notes: input.notes.slice(0, 1000),
    p_location: input.locationId,
  });
  if (error) return { ok: false, error: error.message };
  const b = data as { id: string; manage_token: string; status: string };

  if (b.status === "pending_payment") {
    const stripe = getStripe();
    if (!stripe || !env.supabaseServiceKey) return { ok: false, error: "Online payments aren't available right now." };
    const admin = createAdminClient();
    const { data: full } = await admin
      .from("bookings")
      .select("id, deposit_cents, currency, service_name, starts_at, org:organizations(name, stripe_account_id), customer:customers(email)")
      .eq("id", b.id)
      .single();
    const org = full?.org as unknown as { name: string; stripe_account_id: string };
    const customer = full?.customer as unknown as { email: string };
    const fee = Math.round((full!.deposit_cents * env.platformFeePercent) / 100);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: full!.currency.toLowerCase(),
            unit_amount: full!.deposit_cents,
            product_data: { name: `Deposit · ${full!.service_name}`, description: org.name },
          },
        },
      ],
      payment_intent_data: {
        transfer_data: { destination: org.stripe_account_id },
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
        metadata: { booking_id: b.id },
      },
      metadata: { booking_id: b.id },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${env.appUrl}/booking/${b.manage_token}?paid=1`,
      cancel_url: `${env.appUrl}/${input.slug}?cancelled=1`,
    });
    await admin.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", b.id);
    return { ok: true, token: b.manage_token, checkoutUrl: session.url ?? undefined };
  }

  await notifyBooking(b.id, "confirmation");
  return { ok: true, token: b.manage_token };
}
