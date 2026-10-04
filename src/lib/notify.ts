import "server-only";
import { Resend } from "resend";
import { env, features } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, formatMoney, formatDuration } from "@/lib/format";

type Kind = "confirmation" | "cancellation" | "reminder" | "rescheduled";

interface BookingForEmail {
  id: string;
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
  customer: { name: string; email: string; phone: string | null } | null;
  member: { display_name: string } | null;
  service: { location_type: string; location_detail: string | null; duration_minutes: number } | null;
  org: { name: string; slug: string; timezone: string; address: string | null; phone: string | null; accent_color: string };
}

async function loadBooking(bookingId: string): Promise<BookingForEmail | null> {
  if (!env.supabaseServiceKey) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, service_name, price_cents, deposit_cents, currency, payment_status, manage_token, customer:customers(name, email, phone), location:locations(name, address), member:memberships(display_name), service:services(location_type, location_detail, duration_minutes), org:organizations(name, slug, timezone, address, phone, accent_color)",
    )
    .eq("id", bookingId)
    .single();
  return data as unknown as BookingForEmail | null;
}

const SUBJECT: Record<Kind, (b: BookingForEmail) => string> = {
  confirmation: (b) => `Confirmed: ${b.service_name} with ${b.org.name}`,
  cancellation: (b) => `Cancelled: ${b.service_name} with ${b.org.name}`,
  reminder: (b) => `Reminder: ${b.service_name} ${b.org.name ? `at ${b.org.name}` : ""}`,
  rescheduled: (b) => `Updated: ${b.service_name} with ${b.org.name}`,
};

const HEADLINE: Record<Kind, string> = {
  confirmation: "You're booked.",
  cancellation: "Your booking was cancelled.",
  reminder: "See you soon.",
  rescheduled: "Your booking has changed.",
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderEmail(kind: Kind, b: BookingForEmail) {
  const when = formatDateTime(b.starts_at, b.org.timezone);
  const manageUrl = `${env.appUrl}/booking/${b.manage_token}`;
  const where =
    b.service?.location_type === "video"
      ? b.service.location_detail || "Video call — link to follow"
      : b.service?.location_type === "phone"
        ? "Phone call"
        : b.location ? [b.location.name, b.location.address].filter(Boolean).join(", ") : b.org.address || "";
  const rows: [string, string][] = [
    ["When", when],
    ["Service", `${b.service_name}${b.service ? ` · ${formatDuration(b.service.duration_minutes)}` : ""}`],
    ...(b.member ? [["With", b.member.display_name] as [string, string]] : []),
    ...(where ? [["Where", where] as [string, string]] : []),
    ...(b.price_cents ? [["Price", formatMoney(b.price_cents, b.currency)] as [string, string]] : []),
    ...(b.payment_status === "paid" ? [["Deposit", `${formatMoney(b.deposit_cents, b.currency)} paid`] as [string, string]] : []),
  ];
  const accent = b.org.accent_color || "#007AFF";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;color:#1d1d1f">
  <div style="max-width:520px;margin:0 auto;padding:40px 20px">
    <div style="font-size:15px;font-weight:600;color:#6e6e73;margin-bottom:12px">${esc(b.org.name)}</div>
    <div style="background:#fff;border-radius:20px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <h1 style="margin:0 0 6px;font-size:26px;letter-spacing:-.02em">${HEADLINE[kind]}</h1>
      <p style="margin:0 0 24px;color:#6e6e73;font-size:15px">Hi ${esc(b.customer?.name?.split(" ")[0] ?? "there")}, here are the details.</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${rows.map(([k, v]) => `<tr><td style="padding:10px 0;color:#6e6e73;border-top:1px solid #eee;width:90px">${k}</td><td style="padding:10px 0;border-top:1px solid #eee;font-weight:500">${esc(v)}</td></tr>`).join("")}
      </table>
      ${kind !== "cancellation" ? `<a href="${manageUrl}" style="display:inline-block;margin-top:24px;background:${accent};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">Manage booking</a>` : `<a href="${env.appUrl}/${b.org.slug}" style="display:inline-block;margin-top:24px;background:${accent};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">Book again</a>`}
    </div>
    <p style="text-align:center;color:#86868b;font-size:12px;margin-top:20px">${b.org.phone ? `Questions? Call ${esc(b.org.phone)}. ` : ""}Sent by Tempo.</p>
  </div></body></html>`;
  const text = `${HEADLINE[kind]}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nManage: ${manageUrl}`;
  return { subject: SUBJECT[kind](b), html, text };
}

async function sendSms(to: string, body: string) {
  if (!features.sms) return;
  const auth = Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64");
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: env.twilioFrom!, Body: body }),
  }).catch((e) => console.error("[sms]", e));
}

/**
 * Sends booking emails (and SMS when configured). Never throws — a failed
 * notification must not break the booking itself.
 */
export async function notifyBooking(bookingId: string, kind: Kind) {
  try {
    const b = await loadBooking(bookingId);
    if (!b?.customer) return;
    if (features.email) {
      const resend = new Resend(env.resendApiKey);
      const { subject, html, text } = renderEmail(kind, b);
      await resend.emails.send({ from: env.emailFrom, to: b.customer.email, subject, html, text });
    } else {
      console.info(`[notify] ${kind} for booking ${bookingId} (email not configured)`);
    }
    if (b.customer.phone && (kind === "reminder" || kind === "confirmation")) {
      await sendSms(
        b.customer.phone,
        `${b.org.name}: ${kind === "reminder" ? "Reminder" : "Confirmed"} — ${b.service_name}, ${formatDateTime(b.starts_at, b.org.timezone)}. Manage: ${env.appUrl}/booking/${b.manage_token}`,
      );
    }
  } catch (e) {
    console.error("[notify]", e);
  }
}

export async function sendInviteEmail(opts: { to: string; orgName: string; inviter: string; token: string }) {
  const url = `${env.appUrl}/invite/${opts.token}`;
  if (!features.email) {
    console.info(`[notify] invite for ${opts.to}: ${url}`);
    return;
  }
  try {
    const resend = new Resend(env.resendApiKey);
    await resend.emails.send({
      from: env.emailFrom,
      to: opts.to,
      subject: `${opts.inviter} invited you to ${opts.orgName} on Tempo`,
      html: `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;color:#1d1d1f"><h1 style="font-size:24px">Join ${esc(opts.orgName)}</h1><p style="color:#6e6e73;font-size:15px">${esc(opts.inviter)} invited you to manage bookings together on Tempo.</p><a href="${url}" style="display:inline-block;margin-top:16px;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Accept invitation</a></div>`,
      text: `${opts.inviter} invited you to ${opts.orgName} on Tempo: ${url}`,
    });
  } catch (e) {
    console.error("[invite]", e);
  }
}
