import "server-only";
import { Resend } from "resend";
import { env, features } from "@/lib/env";
import { syncBookingCalendar } from "@/lib/calendar/sync";
import { pushBookingEvent } from "@/lib/push";
import { fireTrigger, loadBooking } from "@/lib/messaging";
import type { Trigger } from "@/lib/workflow-defaults";

type Kind = "confirmation" | "cancellation" | "rescheduled" | "request" | "declined";

const TRIGGER: Record<Kind, Trigger> = {
  confirmation: "booking_confirmed",
  cancellation: "booking_cancelled",
  rescheduled: "booking_rescheduled",
  request: "booking_requested",
  declined: "booking_declined",
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Tells the team (push) and the customer (the business's own workflows: email and text) about a booking
 * change. Never throws: a failed notification must not break the booking itself.
 * `by` is the signed-in person who made the change, so they aren't pinged about their own action.
 */
export async function notifyBooking(bookingId: string, kind: Kind, opts: { by?: string; push?: boolean; customer?: boolean } = {}) {
  await syncBookingCalendar(bookingId);
  try {
    const b = await loadBooking(bookingId);
    if (!b) return;
    if (opts.push !== false && (kind === "confirmation" || kind === "request" || kind === "rescheduled" || kind === "cancellation")) {
      await pushBookingEvent(b, kind, opts.by);
    }
    // `customer: false` = staff chose not to email/text the customer.
    if (opts.customer === false) return;
    await fireTrigger(b, TRIGGER[kind]);
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
