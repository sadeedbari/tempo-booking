import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { notifyBooking } from "@/lib/notify";
import { sendEmail } from "@/lib/messaging";
import { renderEmail } from "@/lib/templates";
import { formatDateTime } from "@/lib/format";

/**
 * People on a class waitlist are booked in by the database the moment a spot opens. This tells them: each one gets
 * their booking's usual confirmation (or "request received" if the class needs approval). Safe to call any time,
 * from several places at once: a person is claimed before they're told, so nobody is emailed twice.
 */
export async function flushWaitlist(limit = 50): Promise<number> {
  if (!env.supabaseServiceKey) return 0;
  try {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("class_waitlist")
      .select("id, booking_id")
      .eq("status", "booked")
      .is("notified_at", null)
      .order("promoted_at")
      .limit(limit);
    let told = 0;
    for (const r of rows ?? []) {
      const { data: claimed } = await admin.from("class_waitlist").update({ notified_at: new Date().toISOString() }).eq("id", r.id).is("notified_at", null).select("id");
      if (!claimed?.length || !r.booking_id) continue;
      const { data: b } = await admin.from("bookings").select("status").eq("id", r.booking_id).single();
      if (!b || b.status === "cancelled") continue; // they were taken off again straight away
      await notifyBooking(r.booking_id as string, b.status === "pending_approval" ? "request" : "confirmation");
      told++;
    }
    return told;
  } catch (e) {
    console.error("[waitlist] flush failed", (e as Error).message);
    return 0;
  }
}

interface EntryForEmail {
  name: string;
  email: string;
  spots: number;
  token: string;
  starts_at: string;
  service_name: string;
  org: { name: string; slug: string; timezone: string; accent_color: string; phone: string | null };
}

const leaveLink = (token: string) => `${env.appUrl}/waitlist/${token}`;

/** "You're on the waitlist": says where they are in line and how to leave. */
export async function sendWaitlistJoined(token: string): Promise<void> {
  if (!env.supabaseServiceKey) return;
  try {
    const admin = createAdminClient();
    const [{ data: w }, { data: info }] = await Promise.all([
      admin
        .from("class_waitlist")
        .select("name, email, spots, token, session:class_sessions(starts_at, service:services(name)), org:organizations(name, slug, timezone, accent_color, phone)")
        .eq("token", token)
        .single(),
      admin.rpc("get_waitlist_by_token", { p_token: token }),
    ]);
    if (!w) return;
    const session = w.session as unknown as { starts_at: string; service: { name: string } | null };
    const org = w.org as unknown as EntryForEmail["org"];
    const position = (info as { position?: number } | null)?.position;
    const vars = {
      customer_first_name: (w.name as string).split(" ")[0] || "there",
      business_name: org.name,
      service_name: session.service?.name ?? "the class",
      date_time: formatDateTime(session.starts_at, org.timezone),
      spots: (w.spots as number) > 1 ? `${w.spots} spots` : "",
      position: position ? String(position) : "",
      leave_link: leaveLink(w.token as string),
    };
    const e = renderEmail({
      subject: "You're on the waitlist: {{service_name}}",
      body: "Hi {{customer_first_name}},\n\n{{service_name}} on {{date_time}} is full right now, so we've put you on the waitlist.\n\nPlace in line: {{position}}\nSpots: {{spots}}\n\nIf a spot opens up, you'll be booked in automatically and we'll email you straight away. You don't need to do anything.\n\nChanged your mind? Leave the waitlist any time:\n{{leave_link}}",
      vars,
      accent: org.accent_color || "#007AFF",
      phone: org.phone,
    });
    await sendEmail({ to: w.email as string, businessName: org.name, subject: e.subject, html: e.html, text: e.text });
  } catch (e) {
    console.error("[waitlist] joined email failed", (e as Error).message);
  }
}

/** Tells the people who were waiting for a session that it has been cancelled. */
export async function sendWaitlistCancelled(orgId: string, people: { name: string; email: string }[], o: { serviceName: string; startsAt: string; reason?: string | null }): Promise<void> {
  if (!people.length || !env.supabaseServiceKey) return;
  try {
    const admin = createAdminClient();
    const { data: org } = await admin.from("organizations").select("name, slug, timezone, accent_color, phone").eq("id", orgId).single();
    if (!org) return;
    for (const p of people) {
      const e = renderEmail({
        subject: "Cancelled: {{service_name}}",
        body: "Hi {{customer_first_name}},\n\n{{service_name}} on {{date_time}} has been cancelled, so your place on its waitlist has been released.\n\n{{reason}}\n\nYou're welcome to book another session:\n{{booking_link}}",
        vars: {
          customer_first_name: p.name.split(" ")[0] || "there",
          business_name: org.name,
          service_name: o.serviceName,
          date_time: formatDateTime(o.startsAt, org.timezone),
          reason: o.reason ? `Reason: ${o.reason}` : "",
          booking_link: `${env.appUrl}/${org.slug}`,
        },
        accent: org.accent_color || "#007AFF",
        phone: org.phone,
      });
      await sendEmail({ to: p.email, businessName: org.name, subject: e.subject, html: e.html, text: e.text });
    }
  } catch (e) {
    console.error("[waitlist] cancelled email failed", (e as Error).message);
  }
}
