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
import { RESERVED_SLUGS, slugify } from "@/lib/utils";
import { copyPairs, periodDays, type SchedulePeriod } from "@/lib/schedule";
import { dayKey } from "@/lib/format";
import type { BookingStatus, Organization, OrgRole } from "@/lib/types";

export type ActionResult = { ok?: boolean; error?: string; id?: string };

function friendly(error: { code?: string; message: string } | null): string | undefined {
  if (!error) return undefined;
  if (error.code === "23P01") return "That time overlaps another booking for this team member.";
  if (error.code === "23505") return "That already exists — try a different name or link.";
  if (error.code === "42501") return "You don't have permission to do that.";
  return error.message;
}

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
  active: z.boolean(),
});

export async function saveService(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const parsed = serviceSchema.safeParse({
      ...Object.fromEntries(formData),
      active: formData.get("active") === "on",
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
  starts_at: z.string().min(10),
  customer_id: z.string().uuid().optional().or(z.literal("")),
  customer_name: z.string().trim().max(120).optional(),
  customer_email: z.string().trim().email().optional().or(z.literal("")),
  customer_phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
  notify: z.boolean(),
});

export async function createManualBooking(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org, isAdmin } = await ctxFor(slug);
    const parsed = manualBookingSchema.safeParse({ ...Object.fromEntries(formData), notify: formData.get("notify") === "on" });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();

    const { data: service } = await supabase.from("services").select("*").eq("id", v.service_id).eq("org_id", org.id).single();
    if (!service) return { error: "Service not found." };

    let customerId = v.customer_id || null;
    if (!customerId) {
      if (!v.customer_name || !v.customer_email) return { error: "Add the customer's name and email." };
      const { data: c, error } = await supabase
        .from("customers")
        .upsert(
          { org_id: org.id, name: v.customer_name, email: v.customer_email.toLowerCase(), phone: v.customer_phone || null },
          { onConflict: "org_id,email" },
        )
        .select("id")
        .single();
      if (error) return { error: friendly(error) };
      customerId = c.id;
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

    if (v.notify) await notifyBooking(booking.id, "confirmation");
    else await syncBookingCalendar(booking.id);
    refresh(slug);
    return { ok: true, id: booking.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setBookingStatus(slug: string, id: string, status: BookingStatus, notify = true): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const supabase = await createClient();
    const patch: Record<string, unknown> = { status };
    if (status === "cancelled") patch.cancelled_at = new Date().toISOString();
    const { error } = await supabase.from("bookings").update(patch).eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendly(error) };
    if (status === "cancelled" && notify) await notifyBooking(id, "cancellation");
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
    await notifyBooking(id, "confirmation");
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
    const { org, isAdmin } = await ctxFor(slug);
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
    await notifyBooking(id, "rescheduled");
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
  .max(6);

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
    for (let i = 0; i < list.length; i++) {
      if (list[i].end <= list[i].start) return { error: "Each shift must end after it starts." };
      if (i > 0 && list[i].start < list[i - 1].end) return { error: "Shifts on the same day can't overlap." };
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

/** Copies the previous week/month onto the period starting at `targetStart`. */
export async function copySchedule(
  slug: string,
  period: SchedulePeriod,
  targetStart: string,
  replace: boolean,
): Promise<ActionResult & { copied?: number }> {
  try {
    const { org } = await ctxFor(slug, true);
    if (!DAY.test(targetStart)) return { error: "Pick a valid period." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("copy_shifts", { p_org: org.id, p_pairs: copyPairs(period, targetStart), p_replace: replace });
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true, copied: data as number };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Seeds shifts for a period from everyone's recurring weekly hours (only for days with no shifts yet). */
export async function fillFromWeeklyHours(slug: string, period: SchedulePeriod, start: string): Promise<ActionResult & { copied?: number }> {
  try {
    const { org } = await ctxFor(slug, true);
    if (!DAY.test(start)) return { error: "Pick a valid period." };
    const days = periodDays(period, start);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("fill_shifts_from_weekly", { p_org: org.id, p_from: days[0], p_to: days[days.length - 1] });
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
    const row = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      phone: String(formData.get("phone") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null,
    };
    if (!row.name || !z.string().email().safeParse(row.email).success) return { error: "Add a name and a valid email." };
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("customers").update(row).eq("id", id).eq("org_id", org.id)
      : await supabase.from("customers").insert({ ...row, org_id: org.id });
    if (error) return { error: friendly(error) };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Team ───────────────────────────── */

export async function inviteMember(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org, me } = await ctxFor(slug, true);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const role = (formData.get("role") === "admin" ? "admin" : "member") as OrgRole;
    if (!z.string().email().safeParse(email).success) return { error: "Enter a valid email address." };
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("invitations")
      .insert({ org_id: org.id, email, role, invited_by: userData.user?.id })
      .select("token")
      .single();
    if (error) return { error: friendly(error) };
    await sendInviteEmail({ to: email, orgName: org.name, inviter: me.display_name || "Your teammate", token: data.token });
    refresh(slug);
    return { ok: true, id: data.token };
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
    if (isAdmin && (role === "owner" || role === "admin" || role === "member")) patch.role = role;
    const supabase = await createClient();
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
  reminder_hours_before: z.coerce.number().int().min(0).max(168),
  booking_confirmation: z.enum(["auto", "manual"]),
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

export async function deleteOrg(slug: string): Promise<ActionResult> {
  const { org, isOwner } = await ctxFor(slug);
  if (!isOwner) return { error: "Only owners can delete a team." };
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").delete().eq("id", org.id);
  if (error) return { error: friendly(error) };
  redirect("/app");
}

/* ───────────────────────────── Payments ───────────────────────────── */
