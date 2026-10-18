"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { notifyBooking, sendInviteEmail } from "@/lib/notify";
import { syncBookingCalendar, syncSessionCalendar } from "@/lib/calendar/sync";
import { refundDeposit } from "@/lib/bookings";
import { flushWaitlist, sendWaitlistCancelled } from "@/lib/waitlist";
import { decrypt } from "@/lib/calendar/crypto";
import { getProvider } from "@/lib/calendar/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { PALETTE, RESERVED_SLUGS, slugify } from "@/lib/utils";
import { friendlyDbError as friendly } from "@/lib/db-errors";
import { copyPairs, hasSameLocationOverlap, periodDays, type SchedulePeriod } from "@/lib/schedule";
import { normalizePhone } from "@/lib/phone";
import { withUnit } from "@/lib/address";
import { dayKey } from "@/lib/format";
import { checkCapacity, getBillingStatus, planInactiveMessage } from "@/lib/billing-server";
import type { UpgradeOffer } from "@/lib/billing";
import type { BookingStatus, Organization, OrgRole } from "@/lib/types";

export type ActionResult = {
  ok?: boolean;
  error?: string;
  id?: string;
  /** For a repeating appointment: how many dates were booked, and the dates that were skipped (with why). */
  booked?: number;
  skipped?: { startsAt: string; reason: string }[];
  /** Something that worked but needs a look (for example a refund that didn't go through). */
  warning?: string;
  /** How many people were affected by a change to a session or a series (for example, told about a move). */
  people?: number;
  /** How many sessions a change to a series covered. */
  sessions?: number;
  /** The change would go beyond the plan: what to offer (the owner can add it in one click). */
  upgrade?: UpgradeOffer;
};

/** The same time of day `weeks` weeks later in the business's time zone, even across a clock change. */
function addWeeksLocal(d: Date, weeks: number, timeZone: string) {
  const local = new TZDate(d.getTime(), timeZone);
  local.setDate(local.getDate() + weeks * 7);
  return new Date(local.getTime());
}

/** The date of `dateIso` at the time of day of `timeSource`, in the business time zone (so it holds across a clock change). */
function withTimeOfDay(dateIso: string, timeSource: Date, timeZone: string) {
  const day = new TZDate(new Date(dateIso).getTime(), timeZone);
  const t = new TZDate(timeSource.getTime(), timeZone);
  return new Date(new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), t.getHours(), t.getMinutes(), 0, timeZone).getTime());
}

/** The team and the signed-in person's place in it, for an action that changes something. */
async function ctxFor(slug: string, adminOnly = false) {
  const ctx = await ctxRead(slug, adminOnly);
  // No active plan (trial over, cancelled, unpaid): the dashboard is read-only. The database refuses these writes
  // as well; this gives the plain-words reason first.
  const plan = await getBillingStatus(await createClient(), ctx.org.id);
  if (plan && !plan.entitled) {
    throw new Error(planInactiveMessage(ctx.isOwner));
  }
  return ctx;
}

/** Same, for actions that only read, or that must keep working without a plan (leaving, deleting the team). */
async function ctxRead(slug: string, adminOnly = false) {
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
  allow_series: z.boolean(),
  is_class: z.boolean(),
  class_capacity: z.coerce.number().int().min(1, "A class needs at least 1 spot.").max(500, "A class can have at most 500 spots.").default(10),
  active: z.boolean(),
});

export async function saveService(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug, true);
    const parsed = serviceSchema.safeParse({
      ...Object.fromEntries(formData),
      active: formData.get("active") === "on",
      auto_approve: formData.get("auto_approve") === "on",
      allow_series: formData.get("allow_series") === "on",
      is_class: formData.get("is_class") === "on",
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
      allow_series: v.allow_series && v.auto_approve && !v.is_class, // repeating appointments are confirmed automatically; classes are booked by session
      is_class: v.is_class,
      class_capacity: v.class_capacity,
      active: v.active,
    };

    let id = v.id || "";
    if (id && !v.is_class) {
      // A class with sessions coming up can't quietly turn back into an ordinary service.
      const { data: was } = await supabase.from("services").select("is_class").eq("id", id).eq("org_id", org.id).single();
      if (was?.is_class) {
        const { count } = await supabase.from("class_sessions").select("id", { count: "exact", head: true }).eq("service_id", id).eq("status", "scheduled").gt("starts_at", new Date().toISOString());
        if (count) return { error: `This class has ${count} upcoming ${count === 1 ? "session" : "sessions"}. Cancel them first, then switch it back.` };
      }
    }
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

    // Intake questions (only touched when the form sent them).
    const rawQuestions = formData.get("questions");
    if (typeof rawQuestions === "string") {
      const qr = await syncQuestions(supabase, org.id, id, rawQuestions);
      if (qr.error) return qr;
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

const questionSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")).or(z.null()),
  label: z.string().trim().min(1, "Give every question some text.").max(200, "Keep each question under 200 characters."),
  help_text: z.string().trim().max(300, "Keep help text under 300 characters.").optional().or(z.null()),
  type: z.enum(["text", "paragraph", "choice", "multi", "yes_no", "agree", "date"]),
  options: z.array(z.string().trim().min(1).max(80, "Keep each choice under 80 characters.")).max(12, "A question can have at most 12 choices.").default([]),
  required: z.boolean().default(false),
});

/** Makes a service's questions match the list the editor sent, keeping the ids of questions that still exist. */
async function syncQuestions(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, serviceId: string, raw: string): Promise<ActionResult> {
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return { error: "Your questions couldn't be read. Please try again." }; }
  const parsed = z.array(questionSchema).max(12, "A service can have at most 12 questions.").safeParse(list);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const questions = parsed.data;
  for (const [i, q] of questions.entries()) {
    if (q.type === "choice" || q.type === "multi") {
      const distinct = new Set(q.options.map((o) => o.toLowerCase()));
      if (distinct.size !== q.options.length) return { error: `Question ${i + 1}: each choice must be different.` };
      if (q.options.length < 2) return { error: `Question ${i + 1}: add at least two choices.` };
    }
  }

  const { data: current } = await supabase.from("service_questions").select("id").eq("service_id", serviceId).eq("org_id", orgId);
  const have = new Set((current ?? []).map((c) => c.id as string));
  const keep = new Set(questions.map((q) => q.id).filter((x): x is string => !!x && have.has(x)));

  const removed = [...have].filter((x) => !keep.has(x));
  if (removed.length) {
    const { error } = await supabase.from("service_questions").delete().in("id", removed).eq("org_id", orgId);
    if (error) return { error: friendly(error) };
  }
  for (const [position, q] of questions.entries()) {
    const row = {
      label: q.label,
      help_text: q.help_text || null,
      type: q.type,
      options: q.type === "choice" || q.type === "multi" ? q.options : [],
      required: q.required,
      position,
    };
    if (q.id && keep.has(q.id)) {
      const { error } = await supabase.from("service_questions").update(row).eq("id", q.id).eq("org_id", orgId);
      if (error) return { error: friendly(error) };
    } else {
      const { error } = await supabase.from("service_questions").insert({ ...row, org_id: orgId, service_id: serviceId });
      if (error) return { error: friendly(error) };
    }
  }
  return { ok: true };
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
    if (service.is_class) return { error: "This is a group class. Add people to one of its sessions instead." };
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

    // Answers to the service's booking questions, if the team filled any in. Every answer given is checked
    // against the real questions, but none is required when staff add a booking.
    let answers: unknown = null;
    const rawAnswers = formData.get("answers");
    if (typeof rawAnswers === "string" && rawAnswers.trim() && env.supabaseServiceKey) {
      let parsedAnswers: unknown;
      try { parsedAnswers = JSON.parse(rawAnswers); } catch { return { error: "The answers couldn't be read. Please try again." }; }
      if (parsedAnswers && typeof parsedAnswers === "object" && !Array.isArray(parsedAnswers) && Object.keys(parsedAnswers).length) {
        const { data, error } = await createAdminClient().rpc("build_intake_answers", { p_service: service.id, p_answers: parsedAnswers, p_enforce: false });
        if (error) return { error: error.code === "P0001" ? error.message : "The answers couldn't be saved. Please check them and try again." };
        answers = data;
      }
    }

    const start = new Date(v.starts_at);
    if (isNaN(start.getTime())) return { error: "Pick a valid date and time." };

    // A repeating appointment: the same time every few weeks. Each date is checked and booked like a single one.
    const repeatWeeks = Number(formData.get("repeat_weeks") || 0);
    const repeatCount = Number(formData.get("repeat_count") || 0);
    const series = Number.isInteger(repeatWeeks) && repeatWeeks >= 1 && repeatWeeks <= 4 && Number.isInteger(repeatCount) && repeatCount >= 2 && repeatCount <= 52 ? { weeks: repeatWeeks, count: repeatCount } : null;
    if (repeatWeeks && !series) return { error: "Choose how often it repeats and how many times (2 to 52)." };
    let seriesId: string | null = null;
    if (series) {
      const { data: row, error } = await supabase
        .from("booking_series")
        .insert({ org_id: org.id, customer_id: customerId, service_id: service.id, member_id: v.member_id, location_id: v.location_id || null, interval_weeks: series.weeks, count_requested: series.count, first_starts_at: start.toISOString(), source: "manual", created_by: userData.user?.id })
        .select("id")
        .single();
      if (error) return { error: friendly(error) };
      seriesId = row.id;
    }
    const dropSeries = async () => { if (seriesId) await supabase.from("booking_series").delete().eq("id", seriesId); };

    const placeFields =
      address && /^[A-Za-z0-9_-]{1,300}$/.test(String(formData.get("customer_address_place_id") ?? ""))
        ? {
            customer_address_place_id: String(formData.get("customer_address_place_id")),
            customer_address_lat: coord(formData.get("customer_address_lat"), 90),
            customer_address_lng: coord(formData.get("customer_address_lng"), 180),
          }
        : {};
    const booked: string[] = [];
    const skipped: { startsAt: string; reason: string }[] = [];
    for (let i = 0; i < (series?.count ?? 1); i++) {
      const at = series ? addWeeksLocal(start, i * series.weeks, org.timezone) : start;
      const end = new Date(at.getTime() + service.duration_minutes * 60_000);
      const blocked = new Date(end.getTime() + service.buffer_after_minutes * 60_000);
      const notScheduled = await assertScheduled(org, isAdmin, v.member_id, at, end, v.location_id || null);
      let failure = notScheduled;
      let bookingId: string | null = null;
      if (!failure) {
        const { data: booking, error } = await supabase
          .from("bookings")
          .insert({
            org_id: org.id,
            service_id: service.id,
            member_id: v.member_id,
            location_id: v.location_id || null,
            customer_address: address,
            ...placeFields,
            customer_id: customerId,
            starts_at: at.toISOString(),
            ends_at: end.toISOString(),
            blocked_until: blocked.toISOString(),
            status: "confirmed",
            service_name: service.name,
            notes: v.notes || null,
            price_cents: service.price_cents,
            deposit_cents: 0,
            currency: org.currency,
            source: "manual",
            answers,
            series_id: seriesId,
            series_index: series ? i : null,
            created_by: userData.user?.id,
          })
          .select("id")
          .single();
        if (error) failure = friendly(error) ?? "That time couldn't be booked.";
        else bookingId = booking.id;
      }
      if (bookingId) booked.push(bookingId);
      else if (i === 0) { await dropSeries(); return { error: failure ?? "That time couldn't be booked." }; } // the first time has to work
      else skipped.push({ startsAt: at.toISOString(), reason: failure ?? "Not available." });
    }

    // One confirmation for the whole series; it lists every date.
    await notifyBooking(booked[0], "confirmation", { by: userData.user?.id, customer: v.notify });
    // A booking made from a website message answers it: mark that message handled.
    const fromInquiry = String(formData.get("inquiry_id") ?? "");
    if (/^[0-9a-f-]{36}$/i.test(fromInquiry)) {
      await supabase.from("inquiries").update({ status: "handled" }).eq("id", fromInquiry).eq("org_id", org.id).eq("status", "new");
    }
    refresh(slug);
    return { ok: true, id: booked[0], booked: booked.length, skipped };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export interface SeriesSummary {
  bookingId: string;
  index: number;
  total: number;
  intervalWeeks: number;
  /** Active appointments from this one onwards, this one included. */
  later: number;
}

/** Where a booking sits in its repeating series ("2 of 6, every week"), or null if it isn't part of one. */
export async function getSeriesSummary(slug: string, bookingId: string): Promise<SeriesSummary | null> {
  try {
    const { org } = await ctxRead(slug);
    const supabase = await createClient();
    const { data: b } = await supabase.from("bookings").select("series_id, starts_at").eq("id", bookingId).eq("org_id", org.id).single();
    if (!b?.series_id) return null;
    const [{ data: s }, { data: all }] = await Promise.all([
      supabase.from("booking_series").select("interval_weeks").eq("id", b.series_id).single(),
      supabase.from("bookings").select("starts_at, status").eq("series_id", b.series_id).eq("org_id", org.id).order("starts_at"),
    ]);
    if (!s || !all) return null;
    const active = ["confirmed", "pending_payment", "pending_approval"];
    return {
      bookingId,
      index: all.filter((x) => x.starts_at <= b.starts_at).length,
      total: all.length,
      intervalWeeks: s.interval_weeks as number,
      later: all.filter((x) => x.starts_at >= b.starts_at && active.includes(x.status as string)).length,
    };
  } catch {
    return null;
  }
}

/** Cancels this appointment and every later one in its series. The customer is told once. */
export async function cancelSeriesFollowing(slug: string, bookingId: string, notify = true): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data: b } = await supabase.from("bookings").select("series_id, starts_at").eq("id", bookingId).eq("org_id", org.id).single();
    if (!b?.series_id) return { error: "This booking isn't part of a repeating series." };
    const { data: cancelled, error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("series_id", b.series_id)
      .eq("org_id", org.id)
      .gte("starts_at", b.starts_at)
      .in("status", ["confirmed", "pending_payment", "pending_approval"])
      .select("id");
    if (error) return { error: friendly(error) };
    const ids = (cancelled ?? []).map((c) => c.id as string);
    for (const id of ids) if (id !== bookingId) await syncBookingCalendar(id);
    await notifyBooking(bookingId, "cancellation", { by: userData.user?.id, customer: notify });
    refresh(slug);
    return { ok: true, booked: ids.length };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────────── Group classes ───────────────────────────── */

const sessionSchema = z.object({
  service_id: z.string().uuid({ message: "Choose a class" }),
  member_id: z.string().uuid({ message: "Choose who leads it" }),
  location_id: z.string().uuid().optional().or(z.literal("")),
  starts_at: z.string().min(10),
  capacity: z.coerce.number().int().min(1, "A class needs at least 1 spot.").max(500, "A class can have at most 500 spots."),
  notes: z.string().trim().max(500, "Keep the notes under 500 characters.").optional(),
});

/** Adds a class session, or the same session every few weeks. Dates that clash are skipped and reported; the first has to work. */
export async function createSessions(slug: string, formData: FormData): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const parsed = sessionSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data: service } = await supabase.from("services").select("*").eq("id", v.service_id).eq("org_id", org.id).single();
    if (!service?.is_class) return { error: "Choose a class service for this session." };
    const start = new Date(v.starts_at);
    if (isNaN(start.getTime())) return { error: "Pick a valid date and time." };
    if (start.getTime() <= Date.now()) return { error: "Pick a time in the future." };

    const repeatWeeks = Number(formData.get("repeat_weeks") || 0);
    const repeatCount = Number(formData.get("repeat_count") || 0);
    const repeat = Number.isInteger(repeatWeeks) && repeatWeeks >= 1 && repeatWeeks <= 4 && Number.isInteger(repeatCount) && repeatCount >= 2 && repeatCount <= 52 ? { weeks: repeatWeeks, count: repeatCount } : null;
    if (repeatWeeks && !repeat) return { error: "Choose how often it repeats and how many sessions (2 to 52)." };

    const created: string[] = [];
    const skipped: { startsAt: string; reason: string }[] = [];
    // Sessions added together share a series, so "this and all later ones" can be changed or cancelled at once.
    const seriesId = repeat ? crypto.randomUUID() : null;
    for (let i = 0; i < (repeat?.count ?? 1); i++) {
      const at = repeat ? addWeeksLocal(start, i * repeat.weeks, org.timezone) : start;
      const end = new Date(at.getTime() + service.duration_minutes * 60_000);
      const blocked = new Date(end.getTime() + service.buffer_after_minutes * 60_000);
      const { data, error } = await supabase
        .from("class_sessions")
        .insert({
          org_id: org.id,
          service_id: service.id,
          member_id: v.member_id,
          location_id: v.location_id || null,
          starts_at: at.toISOString(),
          ends_at: end.toISOString(),
          blocked_until: blocked.toISOString(),
          capacity: v.capacity,
          notes: v.notes || null,
          series_id: seriesId,
          series_index: seriesId ? i : null,
          created_by: userData.user?.id,
        })
        .select("id")
        .single();
      if (error) {
        const reason = friendly(error) ?? "That time couldn't be used.";
        if (i === 0) return { error: reason };
        skipped.push({ startsAt: at.toISOString(), reason });
      } else created.push(data.id);
    }
    for (const id of created) await syncSessionCalendar(id);
    refresh(slug);
    return { ok: true, id: created[0], booked: created.length, skipped };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export interface SessionAttendee {
  bookingId: string;
  customerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  status: BookingStatus;
  notes: string | null;
  /** How many spots they hold, and who is coming with them. */
  spots: number;
  guests: string | null;
  paid: boolean;
  answers: { id: string; label: string; value: string | string[] }[];
}

/** Who is in a session, for the roster. */
export async function getSessionRoster(slug: string, sessionId: string): Promise<{ attendees: SessionAttendee[] } | null> {
  try {
    const { org } = await ctxRead(slug);
    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("bookings")
      .select("id, status, notes, answers, payment_status, spots, guest_names, customer:customers(id, name, email, phone)")
      .eq("session_id", sessionId)
      .eq("org_id", org.id)
      .order("created_at");
    if (error) return null;
    const attendees = (rows ?? []).map((r) => {
      const c = r.customer as unknown as { id: string; name: string; email: string; phone: string | null } | null;
      return {
        bookingId: r.id as string,
        customerId: c?.id ?? null,
        name: c?.name ?? "Customer",
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        status: r.status as BookingStatus,
        notes: (r.notes as string | null) ?? null,
        spots: (r.spots as number | null) ?? 1,
        guests: (r.guest_names as string | null) ?? null,
        paid: r.payment_status === "paid",
        answers: Array.isArray(r.answers) ? (r.answers as SessionAttendee["answers"]) : [],
      };
    });
    return { attendees };
  } catch {
    return null;
  }
}

/** Where a session sits in its weekly series ("3 of 8"), and how many scheduled sessions come after it. Null if it stands alone. */
export async function getSessionSeries(slug: string, sessionId: string): Promise<{ index: number; total: number; later: number } | null> {
  try {
    const { org } = await ctxRead(slug);
    const supabase = await createClient();
    const { data: s } = await supabase.from("class_sessions").select("series_id, starts_at").eq("id", sessionId).eq("org_id", org.id).single();
    if (!s?.series_id) return null;
    const { data: all } = await supabase.from("class_sessions").select("starts_at, status").eq("series_id", s.series_id).eq("org_id", org.id).order("starts_at");
    const live = (all ?? []).filter((x) => x.status === "scheduled");
    if (live.length < 2) return null;
    return {
      index: live.filter((x) => x.starts_at <= s.starts_at).length,
      total: live.length,
      later: live.filter((x) => x.starts_at > s.starts_at).length,
    };
  } catch {
    return null;
  }
}

/** The session ids to change: just this one, or this one and every later scheduled session of its series. */
async function sessionScope(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, sessionId: string, later: boolean) {
  const { data: s } = await supabase.from("class_sessions").select("id, series_id, starts_at, status").eq("id", sessionId).eq("org_id", orgId).single();
  if (!s) return null;
  if (!later || !s.series_id) return { s, list: [s] };
  const { data } = await supabase
    .from("class_sessions")
    .select("id, series_id, starts_at, status")
    .eq("series_id", s.series_id)
    .eq("org_id", orgId)
    .eq("status", "scheduled")
    .gte("starts_at", s.starts_at)
    .order("starts_at");
  return { s, list: data ?? [s] };
}

/** Changes a session's number of spots or notes, here or in every later session of its series. */
export async function updateSession(slug: string, sessionId: string, input: { capacity: number; notes: string; applyToLater?: boolean }): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const parsed = sessionSchema.pick({ capacity: true, notes: true }).safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const supabase = await createClient();
    const scope = await sessionScope(supabase, org.id, sessionId, !!input.applyToLater);
    if (!scope) return { error: "Session not found." };
    const done: string[] = [];
    const skipped: { startsAt: string; reason: string }[] = [];
    for (const t of scope.list) {
      const { data, error } = await supabase
        .from("class_sessions")
        .update({ capacity: parsed.data.capacity, notes: parsed.data.notes || null })
        .eq("id", t.id)
        .eq("org_id", org.id)
        .eq("status", "scheduled")
        .select("id");
      if (error || !data?.length) {
        const reason = error ? friendly(error) ?? "That session couldn't be changed." : "This session can't be changed any more.";
        if (t.id === sessionId) return { error: reason };
        skipped.push({ startsAt: t.starts_at as string, reason });
      } else done.push(t.id as string);
    }
    for (const id of done) await syncSessionCalendar(id);
    await flushWaitlist(); // more spots book in the people waiting
    refresh(slug);
    return { ok: true, booked: done.length, skipped };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Cancels one session and everyone's spot in it (refunding paid deposits). Returns the people who were in it. */
async function cancelOneSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  org: Organization,
  userId: string | undefined,
  sessionId: string,
  reason: string | null,
  notify: boolean,
): Promise<{ error?: string; ids: string[]; refundFailures: number }> {
  // Who is waiting now (the database lets them go as soon as the session is cancelled).
  const { data: info } = await supabase.from("class_sessions").select("starts_at, service:services(name)").eq("id", sessionId).eq("org_id", org.id).single();
  const { data: waiting } = await supabase.from("class_waitlist").select("name, email").eq("session_id", sessionId).eq("status", "waiting");
  // The session first, so nobody can join while the rest is being done.
  const { data: s, error } = await supabase
    .from("class_sessions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq("id", sessionId)
    .eq("org_id", org.id)
    .eq("status", "scheduled")
    .select("id");
  if (error) return { error: friendly(error), ids: [], refundFailures: 0 };
  if (!s?.length) return { error: "This session was already cancelled.", ids: [], refundFailures: 0 };

  const { data: spots } = await supabase
    .from("bookings")
    .select("id, payment_status")
    .eq("session_id", sessionId)
    .eq("org_id", org.id)
    .in("status", ["confirmed", "pending_payment", "pending_approval"]);
  let refundFailures = 0;
  for (const b of spots ?? []) {
    if (b.payment_status === "paid") {
      const refund = await refundDeposit(b.id as string);
      if (!refund.ok) refundFailures++;
    }
  }
  const ids = (spots ?? []).map((b) => b.id as string);
  if (ids.length) {
    const { error: e2 } = await supabase
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason ?? "Class cancelled" })
      .in("id", ids);
    if (e2) return { error: friendly(e2), ids: [], refundFailures };
  }
  for (const id of ids) await notifyBooking(id, "cancellation", { by: userId, customer: notify, push: false });
  if (notify && info && waiting?.length) {
    await sendWaitlistCancelled(org.id, waiting as { name: string; email: string }[], { serviceName: (info.service as unknown as { name: string } | null)?.name ?? "The class", startsAt: info.starts_at as string, reason });
  }
  await syncSessionCalendar(sessionId);
  return { ids, refundFailures };
}

/** Cancels a session, or this one and every later session of its series. Each person is told once per session, and paid deposits are refunded. */
export async function cancelSession(slug: string, sessionId: string, opts: { reason?: string; notify: boolean; applyToLater?: boolean }): Promise<ActionResult> {
  try {
    const { org, me } = await ctxFor(slug);
    const supabase = await createClient();
    const reason = (opts.reason ?? "").trim().slice(0, 300) || null;
    const scope = await sessionScope(supabase, org.id, sessionId, !!opts.applyToLater);
    if (!scope) return { error: "Session not found." };
    let people = 0;
    let sessions = 0;
    let refundFailures = 0;
    for (const t of scope.list) {
      const r = await cancelOneSession(supabase, org, me.user_id ?? undefined, t.id as string, reason, opts.notify);
      if (r.error) {
        if (t.id === sessionId) return { error: r.error };
        continue;
      }
      sessions++;
      people += r.ids.length;
      refundFailures += r.refundFailures;
    }
    refresh(slug);
    return {
      ok: true,
      booked: people,
      sessions,
      warning: refundFailures ? `${refundFailures} deposit ${refundFailures === 1 ? "refund" : "refunds"} didn't go through. Refund ${refundFailures === 1 ? "it" : "them"} from your Stripe dashboard.` : undefined,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export interface MoveTarget {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
}

/** The other upcoming sessions of the same class that a person could be moved to, with how many spots each has taken. */
export async function getMoveTargets(slug: string, sessionId: string): Promise<MoveTarget[]> {
  try {
    const { org } = await ctxRead(slug);
    const supabase = await createClient();
    const { data: s } = await supabase.from("class_sessions").select("service_id").eq("id", sessionId).eq("org_id", org.id).single();
    if (!s) return [];
    const { data: list } = await supabase
      .from("class_sessions")
      .select("id, starts_at, ends_at, capacity")
      .eq("org_id", org.id)
      .eq("service_id", s.service_id)
      .eq("status", "scheduled")
      .gt("starts_at", new Date().toISOString())
      .neq("id", sessionId)
      .order("starts_at")
      .limit(40);
    const ids = (list ?? []).map((x) => x.id as string);
    const counts = new Map<string, number>();
    if (ids.length) {
      const { data: rows } = await supabase.from("bookings").select("session_id, spots").in("session_id", ids).in("status", ["confirmed", "pending_approval", "pending_payment"]);
      (rows ?? []).forEach((r) => counts.set(r.session_id as string, (counts.get(r.session_id as string) ?? 0) + ((r.spots as number | null) ?? 1)));
    }
    return (list ?? []).map((x) => ({ id: x.id as string, startsAt: x.starts_at as string, endsAt: x.ends_at as string, capacity: x.capacity as number, booked: counts.get(x.id as string) ?? 0 }));
  } catch {
    return [];
  }
}

/** Moves one person to another session of the same class. They get one email with the new time. */
export async function moveAttendee(slug: string, bookingId: string, toSessionId: string, notify: boolean): Promise<ActionResult> {
  try {
    const { me } = await ctxFor(slug);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("move_class_booking", { p_booking: bookingId, p_session: toSessionId });
    if (error) return { error: friendly(error) };
    const from = (data as { from_session: string }).from_session;
    await syncSessionCalendar(from); // the old session has one fewer; the new one is brought up to date by the notification
    await notifyBooking(bookingId, "rescheduled", { by: me.user_id ?? undefined, customer: notify, push: false });
    await flushWaitlist(); // the spot they left may book someone in
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Moves a session to a new time and/or instructor, and everyone booked into it moves with it. With scope "later" the
 * sessions after it in the series keep their dates and take the new time of day (and instructor). A session that
 * clashes is skipped and reported. Everyone whose time changed is told.
 */
export async function moveSession(
  slug: string,
  sessionId: string,
  input: { startsAt: string; memberId?: string; applyToLater?: boolean; notify: boolean },
): Promise<ActionResult> {
  try {
    const { org, me } = await ctxFor(slug);
    const supabase = await createClient();
    const first = new Date(input.startsAt);
    if (isNaN(first.getTime())) return { error: "Pick a valid date and time." };
    const scope = await sessionScope(supabase, org.id, sessionId, !!input.applyToLater);
    if (!scope) return { error: "Session not found." };
    const { data: current } = await supabase.from("class_sessions").select("id, starts_at, member_id").in("id", scope.list.map((x) => x.id as string));
    const byId = new Map((current ?? []).map((x) => [x.id as string, x]));

    const timeChanged: string[] = [];
    const movedSessions: string[] = [];
    const skipped: { startsAt: string; reason: string }[] = [];
    for (const t of scope.list) {
      const row = byId.get(t.id as string);
      if (!row) continue;
      const target = t.id === sessionId ? first : withTimeOfDay(row.starts_at as string, first, org.timezone);
      const sameTime = target.getTime() === new Date(row.starts_at as string).getTime();
      if (sameTime && (!input.memberId || input.memberId === row.member_id)) continue; // nothing to change here
      const { data, error } = await supabase.rpc("move_class_session", { p_session: t.id, p_starts_at: target.toISOString(), p_member: input.memberId || null });
      if (error) {
        const reason = friendly(error) ?? "That session couldn't be moved.";
        if (t.id === sessionId) return { error: reason };
        skipped.push({ startsAt: row.starts_at as string, reason });
        continue;
      }
      movedSessions.push(t.id as string);
      if (!sameTime) timeChanged.push(...(((data as { booking_ids: string[] }).booking_ids) ?? []));
    }
    for (const id of timeChanged) await notifyBooking(id, "rescheduled", { by: me.user_id ?? undefined, customer: input.notify, push: false });
    for (const id of movedSessions) await syncSessionCalendar(id);
    refresh(slug);
    return { ok: true, booked: movedSessions.length, people: timeChanged.length, skipped };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  spots: number;
  guests: string | null;
  joinedAt: string;
}

/** Who is waiting for a session, in the order they joined. */
export async function getSessionWaitlist(slug: string, sessionId: string): Promise<WaitlistEntry[]> {
  try {
    const { org } = await ctxRead(slug);
    const supabase = await createClient();
    const { data } = await supabase
      .from("class_waitlist")
      .select("id, name, email, phone, spots, guest_names, created_at")
      .eq("session_id", sessionId)
      .eq("org_id", org.id)
      .eq("status", "waiting")
      .order("created_at");
    return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, email: r.email as string, phone: (r.phone as string | null) ?? null, spots: r.spots as number, guests: (r.guest_names as string | null) ?? null, joinedAt: r.created_at as string }));
  } catch {
    return [];
  }
}

/** Takes someone off a session's waitlist. */
export async function removeWaitlistEntry(slug: string, id: string): Promise<ActionResult> {
  try {
    const { org } = await ctxFor(slug);
    const supabase = await createClient();
    const { data, error } = await supabase.from("class_waitlist").update({ status: "removed" }).eq("id", id).eq("org_id", org.id).eq("status", "waiting").select("id");
    if (error) return { error: friendly(error) };
    if (!data?.length) return { error: "They're no longer waiting." };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Puts someone into a session (a walk-in or a phone booking). The database refuses a full class. */
export async function addSessionAttendee(
  slug: string,
  sessionId: string,
  input: { customerId?: string; name?: string; email?: string; phone?: string; spots?: number; guests?: string; notify: boolean },
): Promise<ActionResult> {
  try {
    const { org, me } = await ctxFor(slug);
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data: session } = await supabase.from("class_sessions").select("*").eq("id", sessionId).eq("org_id", org.id).single();
    if (!session || session.status !== "scheduled") return { error: "This session isn't available." };
    const { data: service } = await supabase.from("services").select("id, name, price_cents").eq("id", session.service_id).single();
    if (!service) return { error: "The class for this session no longer exists." };

    let customerId = input.customerId || null;
    if (customerId) {
      const { data: c } = await supabase.from("customers").select("id").eq("id", customerId).eq("org_id", org.id).single();
      if (!c) return { error: "Customer not found." };
    } else {
      const name = (input.name ?? "").trim();
      const email = (input.email ?? "").trim().toLowerCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Add the person's name and a valid email." };
      let phone: string | null = null;
      if (input.phone?.trim()) {
        phone = normalizePhone(input.phone, org.currency);
        if (!phone) return { error: "That phone number doesn't look right. Include the area code, or leave it blank." };
      }
      const { data: c, error } = await supabase
        .from("customers")
        .upsert({ org_id: org.id, name: name.slice(0, 120), email, phone }, { onConflict: "org_id,email" })
        .select("id")
        .single();
      if (error) return { error: friendly(error) };
      customerId = c.id;
    }

    const spots = Number.isInteger(input.spots) && (input.spots as number) >= 1 && (input.spots as number) <= 6 ? (input.spots as number) : 1;
    const { data: already } = await supabase
      .from("bookings")
      .select("id")
      .eq("session_id", sessionId)
      .eq("customer_id", customerId)
      .in("status", ["confirmed", "pending_payment", "pending_approval"])
      .limit(1);
    if (already?.length) return { error: "That person is already in this session." };

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        org_id: org.id,
        service_id: service.id,
        session_id: sessionId,
        member_id: session.member_id,
        location_id: session.location_id,
        customer_id: customerId,
        starts_at: session.starts_at,
        ends_at: session.ends_at,
        blocked_until: session.blocked_until,
        status: "confirmed",
        service_name: service.name,
        price_cents: service.price_cents * spots,
        deposit_cents: 0,
        currency: org.currency,
        source: "manual",
        spots,
        guest_names: spots > 1 ? (input.guests ?? "").trim().slice(0, 300) || null : null,
        created_by: userData.user?.id,
      })
      .select("id")
      .single();
    if (error) return { error: friendly(error) };
    await notifyBooking(booking.id, "confirmation", { by: me.user_id ?? undefined, customer: input.notify, push: false });
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
    if (status === "cancelled") {
      await notifyBooking(id, "cancellation", { by: me.user_id ?? undefined, customer: notify });
      await flushWaitlist(); // a freed class spot books in whoever was waiting
    } else await syncBookingCalendar(id);
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
    await flushWaitlist();
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Moves one booking to a new start and person, checking the schedule. Returns what went wrong, or null. */
async function rescheduleOne(
  ctx: { org: Organization; isAdmin: boolean },
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  startsAt: string,
  memberId: string,
): Promise<string | null> {
  const { org, isAdmin } = ctx;
  const { data: b } = await supabase.from("bookings").select("starts_at, ends_at, blocked_until, location_id").eq("id", id).eq("org_id", org.id).single();
  if (!b) return "Booking not found.";
  const duration = new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime();
  const buffer = new Date(b.blocked_until).getTime() - new Date(b.ends_at).getTime();
  const start = new Date(startsAt);
  const notScheduled = await assertScheduled(org, isAdmin, memberId, start, new Date(start.getTime() + duration), b.location_id);
  if (notScheduled) return notScheduled;
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
  return error ? friendly(error) ?? "That time couldn't be booked." : null;
}

export async function rescheduleBooking(slug: string, id: string, startsAt: string, memberId: string): Promise<ActionResult> {
  try {
    const { org, isAdmin, me } = await ctxFor(slug);
    const supabase = await createClient();
    const problem = await rescheduleOne({ org, isAdmin }, supabase, id, startsAt, memberId);
    if (problem) return { error: problem };
    await notifyBooking(id, "rescheduled", { by: me.user_id ?? undefined });
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Changes this appointment of a repeating series and every later one: the same dates, at the new time and with the
 * new person. A date that doesn't fit is skipped and reported; the first has to work. The customer is told once.
 */
export async function editSeriesFollowing(slug: string, bookingId: string, input: { startsAt: string; memberId: string; notify: boolean }): Promise<ActionResult> {
  try {
    const { org, isAdmin, me } = await ctxFor(slug);
    const supabase = await createClient();
    const first = new Date(input.startsAt);
    if (isNaN(first.getTime())) return { error: "Pick a valid date and time." };
    const { data: b } = await supabase.from("bookings").select("id, series_id, starts_at").eq("id", bookingId).eq("org_id", org.id).single();
    if (!b?.series_id) return { error: "This booking isn't part of a repeating series." };
    const { data: later } = await supabase
      .from("bookings")
      .select("id, starts_at, member_id")
      .eq("series_id", b.series_id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .gte("starts_at", b.starts_at)
      .order("starts_at");
    const moved: string[] = [];
    const skipped: { startsAt: string; reason: string }[] = [];
    for (const x of later ?? []) {
      const target = x.id === b.id ? first : withTimeOfDay(x.starts_at as string, first, org.timezone);
      if (target.getTime() === new Date(x.starts_at as string).getTime() && x.member_id === input.memberId) continue; // nothing to change
      const problem = await rescheduleOne({ org, isAdmin }, supabase, x.id as string, target.toISOString(), input.memberId);
      if (!problem) moved.push(x.id as string);
      else if (x.id === b.id) return { error: problem }; // the date you chose has to work
      else skipped.push({ startsAt: x.starts_at as string, reason: problem });
    }
    if (moved.length) {
      // One email for the whole series; the calendars of everyone involved are brought up to date.
      await notifyBooking(moved[0], "rescheduled", { by: me.user_id ?? undefined, customer: input.notify });
      for (const id of moved.slice(1)) await syncBookingCalendar(id);
    }
    refresh(slug);
    return { ok: true, booked: moved.length, skipped };
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
    const { org, isOwner } = await ctxFor(slug, true);
    const parsed = locationSchema.safeParse({ ...Object.fromEntries(formData), active: formData.get("active") === "on" });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const supabase = await createClient();

    // Beyond the plan? A new location, or turning a hidden one back on, uses up a place (hidden ones don't count).
    let usesAPlace = Boolean(v.active) && !v.id;
    if (v.id && v.active) {
      const { data: before } = await supabase.from("locations").select("active").eq("id", v.id).eq("org_id", org.id).maybeSingle();
      usesAPlace = before ? !before.active : false;
    }
    if (usesAPlace) {
      const cap = await checkCapacity(supabase, org.id, "location", isOwner);
      if (!cap.ok) return { error: cap.error, upgrade: cap.upgrade };
    }
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
    const { me } = await ctxRead(slug);
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
    const { org, members, me, isOwner } = await ctxFor(slug, true);
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
    // Every team member counts toward the plan's staff limit (the database enforces it too).
    const cap = await checkCapacity(supabase, org.id, "staff", isOwner);
    if (!cap.ok) return { error: cap.error, upgrade: cap.upgrade };
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
    const { org, me, isOwner } = await ctxFor(slug, true);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const role = (formData.get("role") === "admin" ? "admin" : "member") as OrgRole;
    const memberId = String(formData.get("member_id") || "");
    if (!emailOk(email)) return { error: "Enter a valid email address." };

    const supabase = await createClient();
    // Inviting a brand-new person will add a team member, so it needs a free staff place (invitations already sent count).
    if (!memberId) {
      const cap = await checkCapacity(supabase, org.id, "staff", isOwner);
      if (!cap.ok) return { error: cap.error, upgrade: cap.upgrade };
    }
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
  const { org, isOwner } = await ctxRead(slug);
  if (!isOwner) return { error: "Only owners can delete a team." };
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").delete().eq("id", org.id);
  if (error) return { error: friendly(error) };
  redirect("/app");
}

/* ───────────────────────────── Payments ───────────────────────────── */
