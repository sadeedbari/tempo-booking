"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { notifyBooking, sendInviteEmail } from "@/lib/notify";
import { syncBookingCalendar } from "@/lib/calendar/sync";
import { refundDeposit } from "@/lib/bookings";
import { decrypt } from "@/lib/calendar/crypto";
import { getProvider } from "@/lib/calendar/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PALETTE, RESERVED_SLUGS, slugify } from "@/lib/utils";
import { friendlyDbError as friendly } from "@/lib/db-errors";
import { copyPairs, hasSameLocationOverlap, periodDays, type SchedulePeriod } from "@/lib/schedule";
import { normalizePhone } from "@/lib/phone";
import { withUnit } from "@/lib/address";
import { dayKey } from "@/lib/format";
import type { BookingStatus, Organization, OrgRole } from "@/lib/types";

export type ActionResult = { ok?: boolean; error?: string; id?: string };

async function ctxFor(slug: string, adminOnly = false) {
  const ctx = await getOrgContext(slug);
  if (adminOnly && !ctx.isAdmin) throw new Error("Only owners and admins can do that.");
  return ctx;
}

function refresh(slug: string) {
  revalidatePath(`/o/${slug}`, "layout");
}

/* ───────────────────────────── Services ───────────────────────────── */

const serviceSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Give the service a name").max(80),
  description: z.string().trim().max(500).optional(),
  kind: z.enum(["appointment", "meeting"]),
  duration_minutes: z.coerce.number().int().min(5).max(720),
  buffer_after_minutes: z.coerce.number().int().min(0).max(240),
  price: z.coerce.number().min(0).max(100000),
  deposit: z.coerce.number().min(0).max(100000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  location_type: z.enum(["in_person", "video", "phone"]),
  location_detail: z.string().trim().max(300).optional(),
  address_mode: z.enum(["off", "optional", "required"]).default("off"),
  auto_approve: z.boolean(),
  active: z.boolean(),
});

export async function saveService(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const parsed = serviceSchema.safeParse({
      ...Object.fromEntries(formData),
      active: formData.get("active") === "on",
      auto_approve: formData.get("auto_approve") === "on",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const price_cents = Math.round(v.price * 100);
    const deposit_cents = Math.round(v.deposit * 100);
    if (price_cents && deposit_cents > price_cents) return { error: "The deposit can't be more than the price." };

    const supabase = await createClient();
    const row = {
      org_id: org.id,
      name: v.name,
      description: v.description || null,
      kind: v.kind,
      duration_minutes: v.duration_minutes,
      buffer_after_minutes: v.buffer_after_minutes,
      price_cents,
      deposit_cents,
      color: v.color,
      location_type: v.location_type,
      location_detail: v.location_detail || null,
      address_mode: v.address_mode,
      auto_approve: v.auto_approve,
      active: v.active,
    };

    let id = v.id || "";
    if (id) {
      const { error } = await supabase.from("services").update(row).eq("id", id).eq("org_id", org.id);
      if (error) return { error: friendly(error) };
    } else {
      let s = slugify(v.name) || "service";
      const { data: existing } = await supabase.from("services").select("slug").eq("org_id", org.id);
      const taken = new Set((existing ?? []).map((x) => x.slug));
      for (let i = 2; taken.has(s); i++) s = `${slugify(v.name)}-${i}`;
      const { data, error } = await supabase
        .from("services")
        .insert({ ...row, slug: s, position: existing?.length ?? 0 })
        .select("id")
        .single();
      if (error) return { error: friendly(error) };
      id = data.id;
    }

    // Staff assignment — empty means "anyone on the team".
    const staff = formData.getAll("staff").map(String);
    await supabase.from("service_staff").delete().eq("service_id", id);
    if (staff.length) {
      const { error } = await supabase.from("service_staff").insert(staff.map((member_id) => ({ service_id: id, member_id })));
      if (error) return { error: friendly(error) };
    }

    refresh(slug);
    return { ok: true, id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteService(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const supabase = await createClient();
    const { error } = await supabase.from("services").delete().eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Bookings ───────────────────────────── */

const manualBookingSchema = z.object({
  service_id: z.string().uuid({ message: "Choose a service" }),
  member_id: z.string().uuid({ message: "Choose a team member" }),
  location_id: z.string().uuid().optional().or(z.literal("")),
  customer_address: z.string().trim().max(300).optional(),
  customer_unit: z.string().trim().max(30).optional(),
  starts_at: z.string().min(10),
  customer_id: z.string().uuid().optional().or(z.literal("")),
  customer_name: z.string().trim().max(120).optional(),
  customer_email: z.string().trim().email().optional().or(z.literal("")),
  customer_phone: z.string().trim().max(40).optional(),
  sms_consent: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
  notify: z.boolean(),
});

/** A latitude/longitude from a form field, or null if missing or out of range. */
function coord(v: FormDataEntryValue | null, max: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

export async function createManualBooking(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org, isAdmin } = await ctxFor(slug);
    const parsed = manualBookingSchema.safeParse({ ...Object.fromEntries(formData), notify: formData.get("notify") === "on", sms_consent: formData.get("sms_consent") === "on" });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();

    const { data: service } = await supabase.from("services").select("*").eq("id", v.service_id).eq("org_id", org.id).single();
    if (!service) return { error: "Service not found." };
    const address = service.address_mode === "off" ? null : withUnit(v.customer_address, v.customer_unit).slice(0, 300) || null;
    if (service.address_mode === "required" && !address) return { error: "Add the address where the team should go." };

    let customerId = v.customer_id || null;
    if (!customerId) {
      if (!v.customer_name || !v.customer_email) return { error: "Add the customer's name and email." };
      let phone: string | null = null;
      if (v.customer_phone) {
        phone = normalizePhone(v.customer_phone, org.currency);
        if (!phone) return { error: "That phone number doesn't look right. Include the area code, or leave it blank." };
      }
      const { data: c, error } = await supabase
        .from("customers")
        .upsert(
          { org_id: org.id, name: v.customer_name, email: v.customer_email.toLowerCase(), phone, ...(v.sms_consent && phone ? { sms_consent_at: new Date().toISOString() } : {}) },
          { onConflict: "org_id,email" },
        )
        .select("id")
        .single();
      if (error) return { error: friendly(error) };
      customerId = c.id;
    } else if (v.sms_consent) {
      // Staff confirmed an existing customer agreed to texts (only possible if they have a number on file).
      await supabase
        .from("customers")
        .update({ sms_consent_at: new Date().toISOString() })
        .eq("id", customerId)
        .eq("org_id", org.id)
        .not("phone", "is", null)
        .is("sms_consent_at", null);
    }

    const start = new Date(v.starts_at);
    if (isNaN(start.getTime())) return { error: "Pick a valid date and time." };
    const end = new Date(start.getTime() + service.duration_minutes * 60_000);
    const blocked = new Date(end.getTime() + service.buffer_after_minutes * 60_000);
    const notScheduled = await assertScheduled(org, isAdmin, v.member_id, start, end, v.location_id || null);
    if (notScheduled) return { error: notScheduled };

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        org_id: org.id,
        service_id: service.id,
        member_id: v.member_id,
        location_id: v.location_id || null,
        customer_address: address,
        ...(address && /^[A-Za-z0-9_-]{1,300}$/.test(String(formData.get("customer_address_place_id") ?? ""))
          ? {
              customer_address_place_id: String(formData.get("customer_address_place_id")),
              customer_address_lat: coord(formData.get("customer_address_lat"), 90),
              customer_address_lng: coord(formData.get("customer_address_lng"), 180),
            }
          : {}),
        customer_id: customerId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        blocked_until: blocked.toISOString(),
        status: "confirmed",
        service_name: service.name,
        notes: v.notes || null,
        price_cents: service.price_cents,
        deposit_cents: 0,
        currency: org.currency,
        source: "manual",
        created_by: userData.user?.id,
      })
      .select("id")
      .single();
    if (error) return { error: friendly(error) };

    await notifyBooking(booking.id, "confirmation", { by: userData.user?.id, customer: v.notify });
    // A booking made from a website message answers it: mark that message handled.
    const fromInquiry = String(formData.get("inquiry_id") ?? "");
    if (/^[0-9a-f-]{36}$/i.test(fromInquiry)) {
      await supabase.from("inquiries").update({ status: "handled" }).eq("id", fromInquiry).eq("org_id", org.id).eq("status", "new");
    }
    refresh(slug);
    return { ok: true, id: booking.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setBookingStatus(slug: string, id: string, status: BookingStatus, notify = true): Promise<ActionResult> {
  try {
    const { org, me } = await ctxFor(slug);
    const supabase = await createClient();
    const patch: Record<string, unknown> = { status };
    if (status === "cancelled") patch.cancelled_at = new Date().toISOString();
    const { error } = await supabase.from("bookings").update(patch).eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    if (status === "cancelled") await notifyBooking(id, "cancellation", { by: me.user_id ?? undefined, customer: notify });
    else await syncBookingCalendar(id);
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Accepts a booking request: it becomes confirmed and the customer is emailed. */
export async function approveBooking(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const supabase = await createClient();
    const { data, error } = await supabase.from("bookings").update({ status: "confirmed" }).eq("id", id).eq("org_id", org.id).eq("status", "pending_approval").select("id");
    if (error) return { error: friendly(error) };
    if (!data?.length) return { error: "This request was already handled." };
    await notifyBooking(id, "confirmation", { push: false }); // the team already heard about the request
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Declines a booking request: the customer is emailed and any deposit is refunded. */
export async function declineBooking(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const supabase = await createClient();
    const { data: b } = await supabase.from("bookings").select("id, status").eq("id", id).eq("org_id", org.id).single();
    if (!b || b.status !== "pending_approval") return { error: "This request was already handled." };
    const refund = await refundDeposit(id);
    if (!refund.ok) return { error: refund.error };
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Declined by the business" })
      .eq("id", id)
      .eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    await notifyBooking(id, "declined");
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function rescheduleBooking(slug: string, id: string, startsAt: string, memberId: string): Promise<ActionResult> {
  try {
    const { org, isAdmin, me } = await ctxFor(slug);
    const supabase = await createClient();
    const { data: b } = await supabase.from("bookings").select("starts_at, ends_at, blocked_until, location_id").eq("id", id).eq("org_id", org.id).single();
    if (!b) return { error: "Booking not found." };
    const duration = new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime();
    const buffer = new Date(b.blocked_until).getTime() - new Date(b.ends_at).getTime();
    const start = new Date(startsAt);
    const notScheduled = await assertScheduled(org, isAdmin, memberId, start, new Date(start.getTime() + duration), b.location_id);
    if (notScheduled) return { error: notScheduled };
    const { error } = await supabase
      .from("bookings")
      .update({
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + duration).toISOString(),
        blocked_until: new Date(start.getTime() + duration + buffer).toISOString(),
        member_id: memberId,
        reminder_sent_at: null,
      })
      .eq("id", id)
      .eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    await notifyBooking(id, "rescheduled", { by: me.user_id ?? undefined });
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Locations ───────────────────────────── */

const locationSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Give the location a name").max(80),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  active: z.boolean(),
});

export async function saveLocation(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const parsed = locationSchema.safeParse({ ...Object.fromEntries(formData), active: formData.get("active") === "on" });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const supabase = await createClient();
    const row = { org_id: org.id, name: v.name, address: v.address || null, phone: v.phone || null, active: v.active };

    let id = v.id || "";
    if (id) {
      const { error } = await supabase.from("locations").update(row).eq("id", id).eq("org_id", org.id);
      if (error) return { error: friendly(error) };
    } else {
      const { count } = await supabase.from("locations").select("id", { count: "exact", head: true }).eq("org_id", org.id);
      const { data, error } = await supabase.from("locations").insert({ ...row, position: count ?? 0 }).select("id").single();
      if (error) return { error: friendly(error) };
      id = data.id;
    }

    // Staff who work here — empty means everyone.
    const staff = formData.getAll("staff").map(String);
    await supabase.from("member_locations").delete().eq("location_id", id);
    if (staff.length) {
      const { error } = await supabase.from("member_locations").insert(staff.map((member_id) => ({ location_id: id, member_id })));
      if (error) return { error: friendly(error) };
    }

    refresh(slug);
    return { ok: true, id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteLocation(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const supabase = await createClient();
    const { error } = await supabase.from("locations").delete().eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Calendar sync ───────────────────────────── */

/** Disconnects one of the signed-in member's own calendars. Events already created stay on their calendar. */
export async function disconnectCalendar(slug: string, providerId: string): Promise<ActionResult> {
  try {
    const { me } = await ctxFor(slug);
    const admin = createAdminClient();
    const { data: conn } = await admin.from("calendar_connections").select("id, refresh_token_enc").eq("member_id", me.id).eq("provider", providerId).maybeSingle();
    if (conn) {
      await getProvider(providerId)?.revoke?.(decrypt(conn.refresh_token_enc));
      const { error } = await admin.from("calendar_connections").delete().eq("id", conn.id);
      if (error) return { error: friendly(error) };
    }
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Staff schedule (shifts) ───────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** In shifts mode, non-admins may only book inside a scheduled shift. Admins can override. */
async function assertScheduled(
  org: Organization,
  isAdmin: boolean,
  memberId: string,
  start: Date,
  end: Date,
  locationId: string | null,
): Promise<string | undefined> {
  if (org.schedule_mode !== "shifts" || isAdmin) return undefined;
  const day = dayKey(start, org.timezone);
  if (dayKey(end, org.timezone) !== day) return "A booking can't run past midnight.";
  const hhmm = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: org.timezone }).format(d);
  const supabase = await createClient();
  const { data } = await supabase.from("shifts").select("start_time, end_time, location_id").eq("member_id", memberId).eq("day", day);
  const s = hhmm(start);
  const e = hhmm(end);
  const ok = (data ?? []).some(
    (x) => x.start_time.slice(0, 5) <= s && x.end_time.slice(0, 5) >= e && (!locationId || !x.location_id || x.location_id === locationId),
  );
  return ok ? undefined : "That person isn't scheduled to work then. Ask an admin to add a shift first.";
}

const shiftsSchema = z
  .array(z.object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM), location_id: z.string().uuid().nullable() }))
  .max(12);

/** Replaces one person's shifts for one day (an empty list = day off). */
export async function saveDayShifts(
  slug: string,
  memberId: string,
  day: string,
  shifts: { start: string; end: string; location_id: string | null }[],
): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    if (!DAY.test(day)) return { error: "Pick a valid day." };
    const parsed = shiftsSchema.safeParse(shifts);
    if (!parsed.success) return { error: "Check the shift times." };
    const list = [...parsed.data].sort((a, b) => a.start.localeCompare(b.start));
    for (const s of list) if (s.end <= s.start) return { error: "Each shift must end after it starts." };
    // Two places at once is allowed (the schedule warns about it), but not twice at the same place.
    if (hasSameLocationOverlap(list.map((s) => ({ start: s.start, end: s.end, location_id: s.location_id })))) {
      return { error: "Shifts at the same location can't overlap." };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_day_shifts", { p_org: org.id, p_member: memberId, p_day: day, p_shifts: list });
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** null = all locations; a location id = just that one (checked to belong to the team); false = not found. */
async function scopedLocation(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, locationId?: string): Promise<string | null | false> {
  if (!locationId || locationId === "all") return null;
  const { data } = await supabase.from("locations").select("id").eq("id", locationId).eq("org_id", orgId).single();
  return data ? (data.id as string) : false;
}

/** Copies the previous week/month onto the period starting at `targetStart`. */
export async function copySchedule(
  slug: string,
  period: SchedulePeriod,
  targetStart: string,
  replace: boolean,
  locationId?: string,
): Promise<ActionResult & { copied?: number }> {
  try {
    const { org } = await ctxFor(slug, true);
    if (!DAY.test(targetStart)) return { error: "Pick a valid period." };
    const supabase = await createClient();
    const location = await scopedLocation(supabase, org.id, locationId);
    if (location === false) return { error: "Location not found." };
    const { data, error } = await supabase.rpc("copy_shifts", { p_org: org.id, p_pairs: copyPairs(period, targetStart), p_replace: replace, p_location: location });
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true, copied: data as number };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Seeds shifts for a period from everyone's recurring weekly hours (only for days with no shifts yet). */
export async function fillFromWeeklyHours(slug: string, period: SchedulePeriod, start: string, locationId?: string): Promise<ActionResult & { copied?: number }> {
  try {
    const { org } = await ctxFor(slug, true);
    if (!DAY.test(start)) return { error: "Pick a valid period." };
    const days = periodDays(period, start);
    const supabase = await createClient();
    const location = await scopedLocation(supabase, org.id, locationId);
    if (location === false) return { error: "Location not found." };
    const { data, error } = await supabase.rpc("fill_shifts_from_weekly", { p_org: org.id, p_from: days[0], p_to: days[days.length - 1], p_location: location });
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true, copied: data as number };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Chooses whether online booking follows recurring weekly hours or the admin-built schedule. */
export async function setScheduleMode(slug: string, mode: "availability" | "shifts"): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    if (mode !== "availability" && mode !== "shifts") return { error: "Unknown mode." };
    const supabase = await createClient();
    const { error } = await supabase.from("organizations").update({ schedule_mode: mode }).eq("id", org.id);
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Customers ───────────────────────────── */

export async function saveCustomer(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const id = String(formData.get("id") || "");
    const typedPhone = String(formData.get("phone") || "").trim();
    // Store phone numbers in international format so texts can be delivered.
    const phone = typedPhone ? normalizePhone(typedPhone, org.currency) : null;
    if (typedPhone && !phone) return { error: "That phone number doesn't look right. Include the area code, or leave it blank." };
    const row = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      phone,
      notes: String(formData.get("notes") || "").trim() || null,
    };
    if (!row.name || !z.string().email().safeParse(row.email).success) return { error: "Add a name and a valid email." };
    const supabase = await createClient();

    // Text consent: ticked box keeps the original date (or records now); unticked or no number clears it.
    const consent = Boolean(phone) && formData.get("sms_consent") === "on";
    let existingConsent: string | null = null;
    if (id) {
      const { data: cur } = await supabase.from("customers").select("sms_consent_at").eq("id", id).eq("org_id", org.id).maybeSingle();
      existingConsent = cur?.sms_consent_at ?? null;
    }
    const sms_consent_at = consent ? existingConsent ?? new Date().toISOString() : null;
    const { error } = id
      ? await supabase.from("customers").update({ ...row, sms_consent_at }).eq("id", id).eq("org_id", org.id)
      : await supabase.from("customers").insert({ ...row, sms_consent_at, org_id: org.id });
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Deletes a customer (owners and admins only). Their past bookings stay in the records but
 * lose the customer details; customers with upcoming bookings can't be deleted until those
 * are cancelled or done.
 */
export async function deleteCustomer(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const supabase = await createClient();
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("customer_id", id)
      .in("status", ["confirmed", "pending_payment", "pending_approval"])
      .gte("ends_at", new Date().toISOString());
    if (count) return { error: `This customer has ${count} upcoming booking${count === 1 ? "" : "s"}. Cancel ${count === 1 ? "it" : "them"} first.` };
    const { error } = await supabase.from("customers").delete().eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Team ───────────────────────────── */

const emailOk = (v: string) => z.string().email().max(254).safeParse(v).success;

/**
 * Adds a team member who doesn't need a login: just a name (and optionally a title and email).
 * With `invite` on, an invitation is also sent so they can sign in later; their login is then linked to this
 * same team member, keeping their hours and bookings.
 */
export async function addTeamMember(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org, members, me } = await ctxFor(slug, true);
    const name = String(formData.get("name") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const invite = formData.get("invite") === "on";
    const role = (formData.get("role") === "admin" ? "admin" : "member") as OrgRole;
    if (!name) return { error: "Enter a name." };
    if (name.length > 80 || title.length > 80) return { error: "That name or title is too long." };
    if (email && !emailOk(email)) return { error: "Enter a valid email address, or leave it blank." };
    if (invite && !email) return { error: "Add their email address to send an invitation." };

    const supabase = await createClient();
    const { data: memberId, error } = await supabase.rpc("add_team_member", {
      p_org: org.id,
      p_name: name,
      p_title: title,
      p_email: email,
      p_color: PALETTE[members.length % PALETTE.length],
    });
    if (error) return { error: friendly(error) };

    let token: string | undefined;
    if (invite) {
      const sent = await createInvite(org, me.display_name, email, role, memberId as string);
      if ("error" in sent) return { error: `${name} was added, but the invitation failed: ${sent.error}` };
      token = sent.token;
    }
    refresh(slug);
    return { ok: true, id: token };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function createInvite(org: { id: string; name: string }, inviter: string, email: string, role: OrgRole, memberId?: string): Promise<{ token: string } | { error: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("invitations")
    .insert({ org_id: org.id, email, role, invited_by: userData.user?.id, member_id: memberId ?? null })
    .select("token")
    .single();
  if (error) return { error: friendly(error) ?? error.message };
  await sendInviteEmail({ to: email, orgName: org.name, inviter: inviter || "Your teammate", token: data.token });
  return { token: data.token as string };
}

/** Invites someone by email. With `member_id`, the invitation is for a team member who was added without a login. */
export async function inviteMember(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org, me } = await ctxFor(slug, true);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const role = (formData.get("role") === "admin" ? "admin" : "member") as OrgRole;
    const memberId = String(formData.get("member_id") || "");
    if (!emailOk(email)) return { error: "Enter a valid email address." };

    const supabase = await createClient();
    if (memberId) {
      const { data: m } = await supabase.from("memberships").select("id, user_id").eq("id", memberId).eq("org_id", org.id).single();
      if (!m) return { error: "Team member not found." };
      if (m.user_id) return { error: "This person already has a login." };
      await supabase.from("memberships").update({ email }).eq("id", memberId).eq("org_id", org.id);
    }
    const sent = await createInvite(org, me.display_name, email, role, memberId || undefined);
    if ("error" in sent) return { error: sent.error };
    refresh(slug);
    return { ok: true, id: sent.token };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function revokeInvite(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const supabase = await createClient();
    const { error } = await supabase.from("invitations").delete().eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateMember(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org, me, isAdmin } = await ctxFor(slug);
    const id = String(formData.get("id"));
    if (id !== me.id && !isAdmin) return { error: "Only admins can edit other team members." };
    const patch: Record<string, unknown> = {
      display_name: String(formData.get("display_name") || "").trim(),
      title: String(formData.get("title") || "").trim() || null,
      color: String(formData.get("color") || "#007AFF"),
      bookable: formData.get("bookable") === "on",
    };
    const role = formData.get("role");
    const supabase = await createClient();
    const { data: target } = await supabase.from("memberships").select("user_id").eq("id", id).eq("org_id", org.id).single();
    if (!target) return { error: "Team member not found." };
    // Someone without a login stays Staff until they're invited and can sign in.
    if (isAdmin && target.user_id && (role === "owner" || role === "admin" || role === "member")) patch.role = role;
    if (isAdmin && !target.user_id && formData.has("email")) {
      const email = String(formData.get("email") || "").trim().toLowerCase();
      if (email && !emailOk(email)) return { error: "Enter a valid email address, or leave it blank." };
      patch.email = email || null;
    }
    const { error } = await supabase.from("memberships").update(patch).eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeMember(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org, me } = await ctxFor(slug);
    const supabase = await createClient();
    const { error } = await supabase.from("memberships").delete().eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    if (id === me.id) redirect("/app");
    refresh(slug);
    return { ok: true };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Availability ───────────────────────────── */

export async function saveAvailability(
  slug: string,
  memberId: string,
  rules: { weekday: number; start_time: string; end_time: string }[],
): Promise<ActionResult> {
  try {
    const { org, isAdmin } = await ctxFor(slug);
    if (org.schedule_mode === "shifts" && !isAdmin) return { error: "Your hours are set by the schedule your admin builds." };
    for (const r of rules) {
      if (r.end_time <= r.start_time) return { error: "Each block must end after it starts." };
    }
    const supabase = await createClient();
    const { error: delErr } = await supabase.from("availability_rules").delete().eq("member_id", memberId).eq("org_id", org.id);
    if (delErr) return { error: friendly(delErr) };
    if (rules.length) {
      const { error } = await supabase
        .from("availability_rules")
        .insert(rules.map((r) => ({ ...r, member_id: memberId, org_id: org.id })));
      if (error) return { error: friendly(error) };
    }
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function addTimeOff(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const starts = new Date(String(formData.get("starts_at")));
    const ends = new Date(String(formData.get("ends_at")));
    if (isNaN(starts.getTime()) || isNaN(ends.getTime()) || ends <= starts) return { error: "Choose a valid range." };
    const supabase = await createClient();
    const { error } = await supabase.from("time_off").insert({
      org_id: org.id,
      member_id: String(formData.get("member_id")),
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      reason: String(formData.get("reason") || "").trim() || null,
    });
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteTimeOff(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const supabase = await createClient();
    const { error } = await supabase.from("time_off").delete().eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Settings ───────────────────────────── */

const orgSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(3).max(40).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, "Links can use lowercase letters, numbers and dashes."),
  description: z.string().trim().max(500).optional(),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
  min_notice_minutes: z.coerce.number().int().min(0).max(10080),
  max_advance_days: z.coerce.number().int().min(1).max(365),
  slot_interval_minutes: z.coerce.number().int(),
  cancellation_window_hours: z.coerce.number().int().min(0).max(720),
  notify_push: z.enum(["on", ""]).optional(), // the switch sends "on" when enabled, "" when off
  inquiries_enabled: z.enum(["on", ""]).optional(),
  inquiry_notify_email: z.string().trim().max(254).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email address for new messages, or leave it empty.").optional(),
});

export async function updateOrg(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const parsed = orgSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    if (v.slug !== org.slug && RESERVED_SLUGS.has(v.slug)) return { error: "That link is reserved." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("organizations")
      .update({
        ...v,
        notify_push: v.notify_push === "on",
        inquiries_enabled: v.inquiries_enabled === "on",
        inquiry_notify_email: v.inquiry_notify_email || null,
        description: v.description || null,
        address: v.address || null,
        phone: v.phone || null,
        website: v.website || null,
      })
      .eq("id", org.id);
    if (error) return { error: friendly(error) };
    revalidatePath("/", "layout");
    if (v.slug !== org.slug) redirect(`/o/${v.slug}/settings`);
    return { ok: true };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    return { error: (e as Error).message };
  }
}

const contactOptionsSchema = z.object({
  success_message: z.string().trim().max(500, "Keep the thank-you message under 500 characters.").optional(),
});

/** Which services the website contact form offers, and the text visitors see after sending. */
export async function saveContactFormOptions(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const parsed = contactOptionsSchema.safeParse({ success_message: formData.get("success_message") ?? "" });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const listed = formData.getAll("service_ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    const supabase = await createClient();
    const { error: e1 } = await supabase.from("organizations").update({ inquiry_success_message: parsed.data.success_message || null }).eq("id", org.id);
    if (e1) return { error: friendly(e1) };
    // Every service of this team is either listed or not.
    const { data: all } = await supabase.from("services").select("id").eq("org_id", org.id);
    const ids = (all ?? []).map((s) => s.id as string);
    const on = ids.filter((id) => listed.includes(id));
    const off = ids.filter((id) => !listed.includes(id));
    if (on.length) {
      const { error } = await supabase.from("services").update({ contact_form: true }).eq("org_id", org.id).in("id", on);
      if (error) return { error: friendly(error) };
    }
    if (off.length) {
      const { error } = await supabase.from("services").update({ contact_form: false }).eq("org_id", org.id).in("id", off);
      if (error) return { error: friendly(error) };
    }
    revalidatePath(`/o/${slug}/settings`);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteOrg(slug: string): Promise<ActionResult> {
  const { org, isOwner } = await ctxFor(slug);
  if (!isOwner) return { error: "Only owners can delete a team." };
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").delete().eq("id", org.id);
  if (error) return { error: friendly(error) };
  redirect("/app");
}

/* ───────────────────────────── Payments ───────────────────────────── */
