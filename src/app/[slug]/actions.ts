"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyBooking } from "@/lib/notify";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { refreshExternalBusy } from "@/lib/calendar/sync";
import { normalizePhone } from "@/lib/phone";
import { withUnit } from "@/lib/address";
import { flushWaitlist, sendWaitlistJoined } from "@/lib/waitlist";
import type { BusyInterval, PublicOrg, PublicSession, PublicShift } from "@/lib/types";

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

/** Upcoming sessions of a class, with how many spots are taken (never who). */
export async function getSessions(orgId: string, serviceId: string): Promise<PublicSession[]> {
  const supabase = await createClient();
  const from = new Date();
  const to = new Date(from.getTime() + 120 * 86_400_000);
  const { data } = await supabase.rpc("get_public_sessions", { p_org: orgId, p_from: from.toISOString(), p_to: to.toISOString() });
  return ((data ?? []) as PublicSession[]).filter((s) => s.service_id === serviceId);
}

export type WaitlistResult = { ok: true; token: string; position: number } | { ok: false; error: string };

/** Puts someone on the waitlist of a full class session. They're booked in automatically if a spot opens. */
export async function joinWaitlist(input: {
  orgId: string;
  slug: string;
  sessionId: string;
  name: string;
  email: string;
  phone: string;
  spots?: number;
  guests?: string;
  notes?: string;
  answers?: Record<string, string | string[]>;
}): Promise<WaitlistResult> {
  const supabase = await createClient();
  let phone = (input.phone ?? "").trim();
  if (phone) {
    const { data: pub } = await supabase.rpc("get_public_org", { p_slug: input.slug });
    const normalized = normalizePhone(phone, (pub as PublicOrg | null)?.org.currency);
    if (!normalized) return { ok: false, error: "That phone number doesn't look right. Include the area code, or leave it blank." };
    phone = normalized;
  }
  const { data, error } = await supabase.rpc("join_class_waitlist", {
    p_org: input.orgId,
    p_session: input.sessionId,
    p_name: input.name.slice(0, 120),
    p_email: input.email.slice(0, 200),
    p_phone: phone,
    p_notes: (input.notes ?? "").slice(0, 1000),
    p_answers: cleanAnswers(input.answers),
    p_spots: wholeNumber(input.spots ?? 1, 1, 6) ?? 1,
    p_guests: (input.guests ?? "").slice(0, 300),
  });
  if (error) {
    if (error.code === "P0001") return { ok: false, error: error.message };
    console.error("[waitlist] unexpected database error:", error.code, error.message);
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }
  const r = data as { token: string; position: number };
  await sendWaitlistJoined(r.token);
  return { ok: true, token: r.token, position: r.position };
}

/** Dates of a repeating appointment that couldn't be booked, with the reason in plain words. */
export interface SkippedDate {
  startsAt: string;
  reason: string;
}

export type BookResult =
  | { ok: true; token: string; checkoutUrl?: string; series?: { booked: number; skipped: SkippedDate[] } }
  | { ok: false; error: string };

/** How a repeating appointment repeats: every N weeks, this many times in all (the first one included). */
export interface SeriesInput {
  intervalWeeks: number;
  count: number;
}

const wholeNumber = (n: unknown, min: number, max: number) => (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null);

/** Only plain text and lists of text go to the database, which checks them against the real questions. */
function cleanAnswers(a: Record<string, string | string[]> | undefined) {
  if (!a || typeof a !== "object") return null;
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(a).slice(0, 40)) {
    if (!/^[0-9a-f-]{36}$/i.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 2500);
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 12).map((x) => x.slice(0, 100));
  }
  return Object.keys(out).length ? out : null;
}

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
  /** Where the team should go, for services that visit the customer. */
  address?: string;
  /** Optional unit/apartment, stored as part of the address. */
  unit?: string;
  /** Set when the address was picked from the Google suggestions. */
  addressPlace?: { placeId: string; lat: number | null; lng: number | null };
  /** The customer ticked the box agreeing to booking text messages. */
  smsConsent?: boolean;
  /** Answers to the service's intake questions: question id to text, or a list of choices. */
  answers?: Record<string, string | string[]>;
  /** Book the same time again every few weeks. */
  series?: SeriesInput;
  /** A spot in a class session (startsAt is then the session's start). */
  sessionId?: string;
  /** For a class: how many spots (1 to 6), and the names of the people coming with them. */
  spots?: number;
  guests?: string;
  notes: string;
}): Promise<BookResult> {
  // Pull the latest personal-calendar events so a just-added event blocks this slot.
  const slotStart = new Date(input.startsAt).getTime();
  if (!Number.isFinite(slotStart)) return { ok: false, error: "Please pick a time and try again." };
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
  const series = input.series && !input.sessionId ? { interval: wholeNumber(input.series.intervalWeeks, 1, 4), count: wholeNumber(input.series.count, 2, 26) } : null;
  if (series && (!series.interval || !series.count)) return { ok: false, error: "Please choose how often it repeats and how many times." };
  const { data, error } = input.sessionId
    ? await supabase.rpc("create_public_session_booking", {
        p_org: input.orgId,
        p_session: input.sessionId,
        p_name: input.name.slice(0, 120),
        p_email: input.email.slice(0, 200),
        p_phone: phone,
        p_notes: input.notes.slice(0, 1000),
        p_answers: cleanAnswers(input.answers),
        p_spots: wholeNumber(input.spots ?? 1, 1, 6) ?? 1,
        p_guests: (input.guests ?? "").slice(0, 300),
      })
    : await supabase.rpc(series ? "create_public_booking_series" : "create_public_booking", {
    ...(series ? { p_interval_weeks: series.interval, p_count: series.count } : {}),
    p_org: input.orgId,
    p_service: input.serviceId,
    p_member: input.memberId,
    p_starts_at: input.startsAt,
    p_name: input.name.slice(0, 120),
    p_email: input.email.slice(0, 200),
    p_phone: phone,
    p_notes: input.notes.slice(0, 1000),
    p_location: input.locationId,
    p_address: withUnit(input.address, input.unit).slice(0, 300),
    p_answers: cleanAnswers(input.answers),
  });
  if (error) {
    // The booking function words its own rules for people ("that time was just taken"); anything else is a fault.
    if (error.code === "P0001") return { ok: false, error: error.message };
    console.error("[book] unexpected database error:", error.code, error.message);
    return { ok: false, error: "Something went wrong while booking. Please try again in a moment." };
  }
  // A series comes back as a list; its first date is the one the customer's confirmation and manage link are about.
  const seriesResult = series ? (data as { booked: { id: string; manage_token: string; status: string }[]; skipped: { starts_at: string; reason: string }[] }) : null;
  const b = seriesResult ? seriesResult.booked[0] : (data as { id: string; manage_token: string; status: string });
  const bookedIds = seriesResult ? seriesResult.booked.map((x) => x.id) : [b.id];

  // Remember the exact place when the address came from the suggestion list.
  const place = input.addressPlace;
  if (place && input.address?.trim() && env.supabaseServiceKey && /^[A-Za-z0-9_-]{1,300}$/.test(place.placeId)) {
    const ok = (n: number | null, max: number) => (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max ? n : null);
    try {
      await createAdminClient()
        .from("bookings")
        .update({ customer_address_place_id: place.placeId, customer_address_lat: ok(place.lat, 90), customer_address_lng: ok(place.lng, 180) })
        .in("id", bookedIds);
    } catch (e) {
      console.error("[address] couldn't save the place", (e as Error).message);
    }
  }

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
    // If payment can't be started, free the time again right away instead of holding it for 30 minutes.
    const release = async () => {
      if (!env.supabaseServiceKey) return;
      await createAdminClient().from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Payment could not be started" }).eq("id", b.id).eq("status", "pending_payment");
    };
    const stripe = getStripe();
    if (!stripe || !env.supabaseServiceKey) {
      await release();
      return { ok: false, error: "Online payments aren't available right now." };
    }
    const admin = createAdminClient();
    const { data: full } = await admin
      .from("bookings")
      .select("id, deposit_cents, currency, service_name, starts_at, org:organizations(name, stripe_account_id), customer:customers(email)")
      .eq("id", b.id)
      .single();
    const org = full?.org as unknown as { name: string; stripe_account_id: string };
    const customer = full?.customer as unknown as { email: string };
    const fee = Math.round((full!.deposit_cents * env.platformFeePercent) / 100);
    if (!org.stripe_account_id) {
      await release();
      return { ok: false, error: "Online payments aren't available right now." };
    }
    try {
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
    } catch (e) {
      // Stripe is unreachable or refused: don't leave the time held for a payment that can't start.
      console.error("[book] couldn't start the payment:", (e as Error).message);
      await release();
      return { ok: false, error: "We couldn't start the payment just now, so nothing was booked. Please try again in a moment." };
    }
  }

  // One confirmation for the whole series: it lists every date.
  await notifyBooking(b.id, b.status === "pending_approval" ? "request" : "confirmation");
  if (input.sessionId) await flushWaitlist(); // an unpaid hold released along the way may have booked someone in
  return {
    ok: true,
    token: b.manage_token,
    ...(seriesResult ? { series: { booked: seriesResult.booked.length, skipped: seriesResult.skipped.map((s) => ({ startsAt: s.starts_at, reason: s.reason })) } } : {}),
  };
}

export type SeriesPreview =
  | { ok: true; dates: { startsAt: string; available: boolean; reason?: string }[] }
  | { ok: false; error: string };

/**
 * Which dates of a repeating appointment are free, checked with exactly the rules a real booking uses.
 * Nothing is booked: the database rolls the trial back.
 */
export async function previewSeries(input: {
  orgId: string;
  serviceId: string;
  memberId: string | null;
  locationId: string | null;
  startsAt: string;
  series: SeriesInput;
}): Promise<SeriesPreview> {
  const interval = wholeNumber(input.series?.intervalWeeks, 1, 4);
  const count = wholeNumber(input.series?.count, 2, 26);
  if (!interval || !count || !Number.isFinite(new Date(input.startsAt).getTime())) return { ok: false, error: "Please choose how often it repeats and how many times." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_public_booking_series", {
    p_org: input.orgId,
    p_service: input.serviceId,
    p_member: input.memberId,
    p_starts_at: input.startsAt,
    p_name: "Preview",
    p_email: "preview@example.com",
    p_phone: "",
    p_notes: "",
    p_location: input.locationId,
    p_address: "",
    p_answers: null,
    p_interval_weeks: interval,
    p_count: count,
    p_dry_run: true,
  });
  if (error) {
    if (error.code === "P0001") return { ok: false, error: error.message };
    console.error("[series] preview failed:", error.code, error.message);
    return { ok: false, error: "We couldn't check the dates just now. Please try again." };
  }
  const r = data as { booked: { starts_at: string }[]; skipped: { starts_at: string; reason: string }[] };
  const dates = [
    ...r.booked.map((x) => ({ startsAt: x.starts_at, available: true as boolean, reason: undefined as string | undefined })),
    ...r.skipped.map((x) => ({ startsAt: x.starts_at, available: false as boolean, reason: x.reason })),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { ok: true, dates };
}
