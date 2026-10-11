"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyBooking } from "@/lib/notify";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { refreshExternalBusy } from "@/lib/calendar/sync";
import { normalizePhone } from "@/lib/phone";
import type { BusyInterval, PublicOrg, PublicShift } from "@/lib/types";

export interface AvailabilityWindow {
  busy: BusyInterval[];
  /** Scheduled shifts in the window; empty unless the business schedules by shifts. */
  shifts: PublicShift[];
}

/** Busy times and (in shifts mode) scheduled shifts for [from, to]; days are local "YYYY-MM-DD" keys. */
export async function getWindow(orgId: string, from: string, to: string, fromDay: string, toDay: string): Promise<AvailabilityWindow> {
  await refreshExternalBusy(orgId, from, to);
  const supabase = await createClient();
  const [busy, shifts] = await Promise.all([
    supabase.rpc("get_public_busy", { p_org: orgId, p_from: from, p_to: to }),
    supabase.rpc("get_public_shifts", { p_org: orgId, p_from: fromDay, p_to: toDay }),
  ]);
  return { busy: (busy.data ?? []) as BusyInterval[], shifts: (shifts.data ?? []) as PublicShift[] };
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
  /** The customer ticked the box agreeing to booking text messages. */
  smsConsent?: boolean;
  notes: string;
}): Promise<BookResult> {
  // Pull the latest personal-calendar events so a just-added event blocks this slot.
  const slotStart = new Date(input.startsAt).getTime();
  await refreshExternalBusy(input.orgId, new Date(slotStart - 86_400_000).toISOString(), new Date(slotStart + 2 * 86_400_000).toISOString());
  const supabase = await createClient();

  // Store phone numbers in international format so texts can actually be delivered.
  let phone = input.phone.trim();
  if (phone) {
    const { data: pub } = await supabase.rpc("get_public_org", { p_slug: input.slug });
    const normalized = normalizePhone(phone, (pub as PublicOrg | null)?.org.currency);
    if (!normalized) return { ok: false, error: "That phone number doesn't look right. Include the area code, or leave it blank." };
    phone = normalized;
  }
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_org: input.orgId,
    p_service: input.serviceId,
    p_member: input.memberId,
    p_starts_at: input.startsAt,
    p_name: input.name.slice(0, 120),
    p_email: input.email.slice(0, 200),
    p_phone: phone,
    p_notes: input.notes.slice(0, 1000),
    p_location: input.locationId,
  });
  if (error) return { ok: false, error: error.message };
  const b = data as { id: string; manage_token: string; status: string };

  // Remember that they agreed to texts (the checkbox is only shown when a number is entered).
  if (input.smsConsent && phone && env.supabaseServiceKey) {
    try {
      const admin = createAdminClient();
      const { data: row } = await admin.from("bookings").select("customer_id").eq("id", b.id).single();
      if (row?.customer_id) {
        await admin.from("customers").update({ sms_consent_at: new Date().toISOString() }).eq("id", row.customer_id).is("sms_consent_at", null);
      }
    } catch (e) {
      console.error("[sms] couldn't record consent", (e as Error).message);
    }
  }

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
    if (!org.stripe_account_id) return { ok: false, error: "Online payments aren't available right now." };
    // Direct charge: created on the business's own Stripe account, with Tempo's fee on top.
    const session = await stripe.checkout.sessions.create(
      {
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
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
        metadata: { booking_id: b.id },
      },
      metadata: { booking_id: b.id },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${env.appUrl}/booking/${b.manage_token}?paid=1`,
      cancel_url: `${env.appUrl}/${input.slug}?cancelled=1`,
      },
      { stripeAccount: org.stripe_account_id },
    );
    await admin.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", b.id);
    return { ok: true, token: b.manage_token, checkoutUrl: session.url ?? undefined };
  }

  await notifyBooking(b.id, b.status === "pending_approval" ? "request" : "confirmation");
  return { ok: true, token: b.manage_token };
}
