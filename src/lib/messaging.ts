import "server-only";
import { Resend } from "resend";
import { env, features } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatDateTime, formatDuration, formatMoney, formatTime } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { finalizeSms } from "@/lib/sms";
import { renderEmail, renderText, type Vars } from "@/lib/templates";
import { DEFAULT_WORKFLOWS, type Channel, type Trigger } from "@/lib/workflow-defaults";

/**
 * Sends the messages businesses write in Workflows. Instant triggers (a booking is confirmed, cancelled, ...)
 * run from notifyBooking; timed ones (N before the start / after the end) run from the hourly job.
 * Nothing here throws into the caller: a failed message must never break a booking.
 */

export interface BookingForMessage {
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
  "id, service_id, member_id, created_at, customer_address, starts_at, ends_at, status, service_name, price_cents, deposit_cents, currency, payment_status, manage_token, customer:customers(name, email, phone, sms_consent_at), location:locations(name, address), member:memberships(display_name), service:services(location_type, location_detail, duration_minutes), org:organizations(id, name, slug, timezone, address, phone, accent_color, notify_push, reminder_hours_before)";

export async function loadBooking(bookingId: string): Promise<BookingForMessage | null> {
  if (!env.supabaseServiceKey) return null;
  const { data } = await createAdminClient().from("bookings").select(BOOKING_SELECT).eq("id", bookingId).single();
  return data as unknown as BookingForMessage | null;
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
    duration: b.service ? formatDuration(b.service.duration_minutes) : "",
    date: formatDate(b.starts_at, tz),
    time: formatTime(b.starts_at, tz),
    date_time: formatDateTime(b.starts_at, tz),
    staff_name: b.member?.display_name ?? "",
    location: where,
    price: b.price_cents ? formatMoney(b.price_cents, b.currency) : "",
    deposit: b.payment_status === "paid" && b.deposit_cents > 0 ? `${formatMoney(b.deposit_cents, b.currency)} paid` : "",
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

/** Sends one step of a workflow for one booking, and records it. */
async function deliver(b: BookingForMessage, wf: { id: string; name: string }, step: LoadedStep, opts: { dedupe?: boolean } = {}): Promise<boolean> {
  if (!b.customer) return false;
  const vars = bookingVars(b);

  let to: string | null;
  if (step.channel === "email") to = b.customer.email;
  else to = b.customer.phone && b.customer.sms_consent_at ? normalizePhone(b.customer.phone, b.currency) : null; // texts need the customer's agreement
  if (!to) return false;

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("message_log")
    .insert({
      org_id: b.org.id,
      booking_id: b.id,
      workflow_id: wf.id,
      step_id: step.id,
      workflow_name: wf.name,
      channel: step.channel,
      recipient: to,
      status: "sending",
      dedupe_key: opts.dedupe ? `${step.id}:${b.id}:${b.starts_at}` : null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code !== "23505") console.error("[messaging] log", error.message); // 23505 = already sent for this appointment time
    return false;
  }

  let result: { ok: boolean; error?: string };
  if (step.channel === "email") {
    const e = renderEmail({ subject: step.subject, body: step.body, vars, accent: b.org.accent_color || "#007AFF", phone: b.org.phone });
    result = await sendEmail({ to, businessName: b.org.name, subject: e.subject, html: e.html, text: e.text });
  } else {
    result = await sendSms(to, finalizeSms(renderText(step.body, vars)));
  }
  await admin.from("message_log").update({ status: result.ok ? "sent" : "failed", detail: result.error?.slice(0, 300) ?? null }).eq("id", row.id);
  return result.ok;
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
  for (const w of (data ?? []) as unknown as LoadedWorkflow[]) {
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
