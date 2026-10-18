import "server-only";
import { Resend } from "resend";
import { env, features } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatDateTime, formatDuration, formatMoney, formatTime } from "@/lib/format";
import { isEntitled } from "@/lib/billing";
import { normalizePhone } from "@/lib/phone";
import { finalizeSms } from "@/lib/sms";
import { renderEmail, renderText, type Vars } from "@/lib/templates";
import { DEFAULT_WORKFLOWS, type Channel, type Trigger } from "@/lib/workflow-defaults";
import type { BookingAnswer } from "@/lib/types";

/**
 * Sends the messages businesses write in Workflows. Instant triggers (a booking is confirmed, cancelled, ...)
 * run from notifyBooking; timed ones (N before the start / after the end) run from the hourly job.
 * Nothing here throws into the caller: a failed message must never break a booking.
 */

export interface BookingForMessage {
  /** The customer's answers to the service's booking questions, if any. */
  answers: BookingAnswer[] | null;
  /** The dates of the repeating series this booking belongs to (filled in by loadBooking). */
  series?: { interval_weeks: number; dates: string[] } | null;
  series_id?: string | null;
  /** How many spots a class booking holds. */
  spots?: number;
  id: string;
  service_id: string | null;
  member_id: string;
  created_at: string;
  customer_address: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  service_name: string;
  price_cents: number;
  deposit_cents: number;
  currency: string;
  payment_status: string;
  manage_token: string;
  location: { name: string; address: string | null } | null;
  customer: { name: string; email: string; phone: string | null; sms_consent_at: string | null } | null;
  member: { display_name: string } | null;
  service: { location_type: string; location_detail: string | null; duration_minutes: number } | null;
  org: { id: string; name: string; slug: string; timezone: string; address: string | null; phone: string | null; accent_color: string; notify_push: boolean; reminder_hours_before: number };
}

export const BOOKING_SELECT =
  "id, answers, series_id, spots, service_id, member_id, created_at, customer_address, starts_at, ends_at, status, service_name, price_cents, deposit_cents, currency, payment_status, manage_token, customer:customers(name, email, phone, sms_consent_at), location:locations(name, address), member:memberships(display_name), service:services(location_type, location_detail, duration_minutes), org:organizations(id, name, slug, timezone, address, phone, accent_color, notify_push, reminder_hours_before)";

export async function loadBooking(bookingId: string): Promise<BookingForMessage | null> {
  if (!env.supabaseServiceKey) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("bookings").select(BOOKING_SELECT).eq("id", bookingId).single();
  const b = data as unknown as BookingForMessage | null;
  if (b?.series_id) {
    const [{ data: s }, { data: dates }] = await Promise.all([
      admin.from("booking_series").select("interval_weeks").eq("id", b.series_id).single(),
      admin.from("bookings").select("starts_at").eq("series_id", b.series_id).in("status", ["confirmed", "pending_approval", "pending_payment"]).order("starts_at"),
    ]);
    if (s) b.series = { interval_weeks: s.interval_weeks as number, dates: (dates ?? []).map((d) => d.starts_at as string) };
  }
  return b;
}

/** The values a booking offers to templates. */
export function bookingVars(b: BookingForMessage): Vars {
  const tz = b.org.timezone;
  const where = b.customer_address
    ? b.customer_address
    : b.service?.location_type === "video"
      ? b.service.location_detail || "Video call - link to follow"
      : b.service?.location_type === "phone"
        ? "Phone call"
        : b.location
          ? [b.location.name, b.location.address].filter(Boolean).join(", ")
          : b.org.address || "";
  const manage = `${env.appUrl}/booking/${b.manage_token}`;
  const again = `${env.appUrl}/${b.org.slug}`;
  const name = b.customer?.name ?? "";
  return {
    customer_name: name,
    customer_first_name: name.split(" ")[0] || "there",
    business_name: b.org.name,
    business_phone: b.org.phone ?? "",
    service_name: b.service_name,
    series: b.series && b.series.dates.length > 1
      ? `Repeats ${b.series.interval_weeks === 1 ? "every week" : `every ${b.series.interval_weeks} weeks`}, ${b.series.dates.length} appointments:\n${b.series.dates.map((d) => formatDateTime(d, tz)).join("\n")}`
      : "",
    answers: (b.answers ?? []).map((a) => `${a.label}: ${Array.isArray(a.value) ? a.value.join(", ") : a.value}`).join("\n"),
    duration: b.service ? formatDuration(b.service.duration_minutes) : "",
    date: formatDate(b.starts_at, tz),
    time: formatTime(b.starts_at, tz),
    date_time: formatDateTime(b.starts_at, tz),
    staff_name: b.member?.display_name ?? "",
    location: where,
    price: b.price_cents ? formatMoney(b.price_cents, b.currency) : "",
    deposit: b.payment_status === "paid" && b.deposit_cents > 0 ? `${formatMoney(b.deposit_cents, b.currency)} paid` : "",
    spots: (b.spots ?? 1) > 1 ? `${b.spots} spots` : "",
    manage_link: manage,
    booking_link: again,
    manage_button: manage,
    booking_button: again,
  };
}

/* ───────────────────────────── Sending ───────────────────────────── */

/** "Business name <bookings@your-domain>": the business shows as the sender, the address stays Tempo's verified one. */
export function fromAddress(businessName: string) {
  const m = env.emailFrom.match(/<([^>]+)>/);
  const address = m ? m[1] : env.emailFrom;
  const name = businessName.replace(/["<>\\\r\n]/g, "").trim();
  return name ? `${name} <${address}>` : env.emailFrom;
}

export async function sendEmail(o: { to: string; businessName: string; subject: string; html: string; text: string; replyTo?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!features.email) return { ok: false, error: "Email isn't set up on this server." };
  try {
    const { error } = await new Resend(env.resendApiKey).emails.send({ from: fromAddress(o.businessName), to: o.to, subject: o.subject, html: o.html, text: o.text, ...(o.replyTo ? { replyTo: o.replyTo } : {}) });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!features.sms) return { ok: false, error: "Texting isn't set up on this server." };
  try {
    const auth = Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64");
    const res = await fetch(`${env.twilioApiBase ?? "https://api.twilio.com"}/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: env.twilioFrom!, Body: body }),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: j.message ?? `Twilio error ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ───────────────────────────── Workflows ───────────────────────────── */

export interface LoadedStep {
  id: string;
  channel: Channel;
  subject: string;
  body: string;
  enabled: boolean;
  position: number;
}
export interface LoadedWorkflow {
  id: string;
  org_id: string;
  name: string;
  trigger: Trigger;
  offset_minutes: number;
  all_services: boolean;
  steps: LoadedStep[];
  services: { service_id: string }[];
}

const WORKFLOW_SELECT = "id, org_id, name, trigger, offset_minutes, all_services, steps:workflow_steps(id, channel, subject, body, enabled, position), services:workflow_services(service_id)";

const appliesTo = (w: LoadedWorkflow, serviceId: string | null) => w.all_services || (serviceId !== null && w.services.some((s) => s.service_id === serviceId));

/**
 * Creates a business's built-in workflows the first time they're needed. Safe to call any time and from
 * several places at once: a unique (org, default_key) means only one caller creates each one.
 */
export async function ensureDefaultWorkflows(orgId: string, reminderHoursBefore: number) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("workflows").select("default_key").eq("org_id", orgId).not("default_key", "is", null);
  const have = new Set((existing ?? []).map((w) => w.default_key as string));
  const missing = DEFAULT_WORKFLOWS.filter((d) => !have.has(d.key));
  if (!missing.length) return;

  const rows = missing.map((d) => {
    // The old "send reminder N hours before" setting carries over (0 meant "don't send").
    const reminder = d.key === "reminder";
    return {
      org_id: orgId,
      name: d.name,
      trigger: d.trigger,
      offset_minutes: reminder && reminderHoursBefore > 0 ? reminderHoursBefore * 60 : d.offset_minutes,
      active: reminder ? reminderHoursBefore > 0 : true,
      default_key: d.key,
      position: DEFAULT_WORKFLOWS.indexOf(d),
    };
  });
  const { data: created } = await admin.from("workflows").upsert(rows, { onConflict: "org_id,default_key", ignoreDuplicates: true }).select("id, default_key");
  const steps = (created ?? []).flatMap((w) => {
    const def = DEFAULT_WORKFLOWS.find((d) => d.key === w.default_key)!;
    return def.steps.map((s, position) => ({ workflow_id: w.id, org_id: orgId, channel: s.channel, subject: s.subject, body: s.body, position }));
  });
  if (steps.length) await admin.from("workflow_steps").insert(steps);
}

/** Everything needed to send one step of a workflow, whether it is about a booking or a website message. */
interface SendContext {
  orgId: string;
  businessName: string;
  businessPhone: string | null;
  accent: string;
  bookingId: string | null;
  inquiryId: string | null;
  vars: Vars;
  /** When set, a second send with the same key is skipped (reminders, one confirmation per day). */
  dedupeKey: string | null;
}

/** Sends one step to `to` (an email address or an international phone number) and records it. */
async function sendStep(c: SendContext, wf: { id: string; name: string }, step: LoadedStep, to: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("message_log")
    .insert({
      org_id: c.orgId,
      booking_id: c.bookingId,
      inquiry_id: c.inquiryId,
      workflow_id: wf.id,
      step_id: step.id,
      workflow_name: wf.name,
      channel: step.channel,
      recipient: to,
      status: "sending",
      dedupe_key: c.dedupeKey,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code !== "23505") console.error("[messaging] log", error.message); // 23505 = already sent
    return false;
  }

  let result: { ok: boolean; error?: string };
  if (step.channel === "email") {
    const e = renderEmail({ subject: step.subject, body: step.body, vars: c.vars, accent: c.accent || "#007AFF", phone: c.businessPhone });
    result = await sendEmail({ to, businessName: c.businessName, subject: e.subject, html: e.html, text: e.text });
  } else {
    result = await sendSms(to, finalizeSms(renderText(step.body, c.vars)));
  }
  await admin.from("message_log").update({ status: result.ok ? "sent" : "failed", detail: result.error?.slice(0, 300) ?? null }).eq("id", row.id);
  return result.ok;
}

/** Sends one step of a workflow for one booking, and records it. */
async function deliver(b: BookingForMessage, wf: { id: string; name: string }, step: LoadedStep, opts: { dedupe?: boolean } = {}): Promise<boolean> {
  if (!b.customer) return false;
  let to: string | null;
  if (step.channel === "email") to = b.customer.email;
  else to = b.customer.phone && b.customer.sms_consent_at ? normalizePhone(b.customer.phone, b.currency) : null; // texts need the customer's agreement
  if (!to) return false;
  return sendStep(
    {
      orgId: b.org.id,
      businessName: b.org.name,
      businessPhone: b.org.phone,
      accent: b.org.accent_color,
      bookingId: b.id,
      inquiryId: null,
      vars: bookingVars(b),
      dedupeKey: opts.dedupe ? `${step.id}:${b.id}:${b.starts_at}` : null,
    },
    wf,
    step,
    to,
  );
}

/**
 * Runs the "a website message is received" workflows for one inquiry: by default a short thank-you email to the
 * visitor. Each step goes to the same address at most once a day, so the form can't be used to flood someone's inbox.
 * Texts only go to visitors who already agreed to them. Never throws.
 */
export async function fireInquiryReceived(inquiryId: string) {
  try {
    if (!env.supabaseServiceKey) return;
    const admin = createAdminClient();
    const { data } = await admin
      .from("inquiries")
      .select("id, service_id, service_name, name, email, message, customer:customers(phone, sms_consent_at), org:organizations(id, name, slug, accent_color, phone, currency, reminder_hours_before)")
      .eq("id", inquiryId)
      .single();
    if (!data) return;
    const inq = data as unknown as {
      id: string; service_id: string | null; service_name: string; name: string; email: string; message: string;
      customer: { phone: string | null; sms_consent_at: string | null } | null;
      org: { id: string; name: string; slug: string; accent_color: string; phone: string | null; currency: string; reminder_hours_before: number };
    };

    await ensureDefaultWorkflows(inq.org.id, inq.org.reminder_hours_before);
    const { data: wfs } = await admin.from("workflows").select(WORKFLOW_SELECT).eq("org_id", inq.org.id).eq("trigger", "inquiry_received").eq("active", true).order("position");

    const again = `${env.appUrl}/${inq.org.slug}`;
    const vars: Vars = {
      customer_name: inq.name,
      customer_first_name: inq.name.trim().split(/\s+/)[0] || "there",
      business_name: inq.org.name,
      business_phone: inq.org.phone ?? "",
      service_name: inq.service_name,
      inquiry_message: inq.message,
      booking_link: again,
      booking_button: again,
    };
    const day = new Date().toISOString().slice(0, 10);
    const sms = inq.customer?.phone && inq.customer.sms_consent_at ? normalizePhone(inq.customer.phone, inq.org.currency) : null;

    for (const w of (wfs ?? []) as unknown as LoadedWorkflow[]) {
      if (!appliesTo(w, inq.service_id)) continue;
      for (const step of [...w.steps].sort((x, y) => x.position - y.position)) {
        if (!step.enabled) continue;
        const to = step.channel === "email" ? inq.email : sms;
        if (!to) continue;
        await sendStep(
          {
            orgId: inq.org.id,
            businessName: inq.org.name,
            businessPhone: inq.org.phone,
            accent: inq.org.accent_color,
            bookingId: null,
            inquiryId: inq.id,
            vars,
            dedupeKey: `${step.id}:inquiry:${to.toLowerCase()}:${day}`,
          },
          w,
          step,
          to,
        );
      }
    }
  } catch (e) {
    console.error("[messaging] inquiry", e);
  }
}

/** Runs every active workflow for an instant trigger (a booking was confirmed, cancelled, ...). */
export async function fireTrigger(b: BookingForMessage, trigger: Trigger) {
  try {
    if (!b.customer) return;
    await ensureDefaultWorkflows(b.org.id, b.org.reminder_hours_before);
    const { data } = await createAdminClient().from("workflows").select(WORKFLOW_SELECT).eq("org_id", b.org.id).eq("trigger", trigger).eq("active", true).order("position");
    for (const w of (data ?? []) as unknown as LoadedWorkflow[]) {
      if (!appliesTo(w, b.service_id)) continue;
      for (const step of [...w.steps].sort((x, y) => x.position - y.position)) {
        if (step.enabled) await deliver(b, w, step);
      }
    }
  } catch (e) {
    console.error("[messaging]", e);
  }
}

const HOUR = 3600_000;

const PLAN_LOOKUP_CHUNK = 100;
const PLAN_COLUMNS = "org_id, status, trial_ends_at, current_period_end, cancel_at_period_end, past_due_since";

/**
 * Which of these businesses must not send timed messages because they have no active plan. The lookup is paged in chunks
 * (a long `in (...)` list overflows the request URL, and one big answer can be cut off by the API's row limit). A business with no
 * subscription row counts as paused (fail closed). If a chunk can't be read, it is logged and retried one business at a time,
 * so only the businesses whose own lookup fails are paused for this run (they are retried next hour), never everyone (D-017).
 */
export async function findPausedOrgs(admin: ReturnType<typeof createAdminClient>, orgIds: string[], now: Date): Promise<Set<string>> {
  const paused = new Set<string>();
  const judge = (id: string, sub: unknown) => {
    if (!sub || !isEntitled(sub as Parameters<typeof isEntitled>[0], now)) paused.add(id);
  };
  for (let i = 0; i < orgIds.length; i += PLAN_LOOKUP_CHUNK) {
    const chunk = orgIds.slice(i, i + PLAN_LOOKUP_CHUNK);
    const { data, error } = await admin.from("subscriptions").select(PLAN_COLUMNS).in("org_id", chunk);
    if (!error && data) {
      const byOrg = new Map((data as { org_id: string }[]).map((r) => [r.org_id, r]));
      for (const id of chunk) judge(id, byOrg.get(id));
      continue;
    }
    console.error(`[workflows] could not read the plans of ${chunk.length} businesses (${error?.message ?? "no data"}); trying them one by one`);
    for (const id of chunk) {
      const one = await admin.from("subscriptions").select(PLAN_COLUMNS).eq("org_id", id).maybeSingle();
      if (one.error) {
        console.error(`[workflows] could not read the plan of org ${id}; its timed messages wait until the next run: ${one.error.message}`);
        paused.add(id);
      } else {
        judge(id, one.data);
      }
    }
  }
  return paused;
}

/**
 * Sends the "N before the appointment" and "N after it ends" messages that have come due.
 * Runs from the hourly job. Each message is claimed before sending, so overlapping runs never double-send.
 */
export async function runTimedWorkflows(now = new Date(), onlyOrgs?: string[]) {
  const admin = createAdminClient();
  let sent = 0;

  // Businesses that haven't opened Workflows yet still get their built-in reminder.
  const [{ data: orgs }, { data: seeded }] = await Promise.all([
    onlyOrgs ? admin.from("organizations").select("id, reminder_hours_before").in("id", onlyOrgs) : admin.from("organizations").select("id, reminder_hours_before"),
    admin.from("workflows").select("org_id").eq("default_key", "reminder"),
  ]);
  const have = new Set((seeded ?? []).map((w) => w.org_id as string));
  for (const o of orgs ?? []) if (!have.has(o.id)) await ensureDefaultWorkflows(o.id, o.reminder_hours_before);

  let wq = admin.from("workflows").select(WORKFLOW_SELECT).eq("active", true).in("trigger", ["before_start", "after_end"]);
  if (onlyOrgs) wq = wq.in("org_id", onlyOrgs);
  const { data } = await wq;
  // Businesses with no active plan (trial over, cancelled, unpaid) don't send timed messages: they cost the platform
  // email/SMS fees. Messages about bookings that already happened (confirmations, cancellations) are unaffected.
  const orgIds = [...new Set(((data ?? []) as { org_id: string }[]).map((w) => w.org_id))];
  const paused = await findPausedOrgs(admin, orgIds, now);
  for (const w of (data ?? []) as unknown as LoadedWorkflow[]) {
    if (paused.has(w.org_id)) continue;
    const steps = w.steps.filter((s) => s.enabled).sort((x, y) => x.position - y.position);
    if (!steps.length) continue;
    const offset = w.offset_minutes * 60_000;

    let q = admin.from("bookings").select(BOOKING_SELECT).eq("org_id", w.org_id).limit(300);
    if (w.trigger === "before_start") {
      // Due once we're within the offset of the start, and the appointment hasn't started.
      q = q.eq("status", "confirmed").gt("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + offset).toISOString());
    } else {
      // Due once the offset after the end has passed; ignore anything older than two days.
      q = q.in("status", ["confirmed", "completed"]).lte("ends_at", new Date(now.getTime() - offset).toISOString()).gt("ends_at", new Date(now.getTime() - offset - 48 * HOUR).toISOString());
    }
    const { data: bookings } = await q;
    for (const b of (bookings ?? []) as unknown as BookingForMessage[]) {
      if (!appliesTo(w, b.service_id)) continue;
      // Booked after the reminder would have gone out (e.g. same-day booking): the confirmation already covers it.
      if (w.trigger === "before_start" && new Date(b.created_at).getTime() > new Date(b.starts_at).getTime() - offset) continue;
      for (const step of steps) {
        if (await deliver(b, w, step, { dedupe: true })) sent++;
      }
    }
  }
  return sent;
}
