import "server-only";
import webpush from "web-push";
import { env, features } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";

export type PushKind = "confirmation" | "request" | "rescheduled" | "cancellation";

const TITLE: Record<PushKind, string> = {
  confirmation: "New booking",
  request: "New booking request",
  rescheduled: "Booking rescheduled",
  cancellation: "Booking cancelled",
};

export interface PushBooking {
  id: string;
  member_id: string;
  starts_at: string;
  service_name: string;
  customer: { name: string } | null;
  org: { id: string; slug: string; timezone: string; notify_push: boolean };
}

/** The text shown on the phone. Kept short; the lock screen cuts off long lines. */
export function pushMessage(kind: PushKind, b: Pick<PushBooking, "starts_at" | "service_name" | "customer" | "org">) {
  const who = b.customer?.name ?? "A customer";
  return {
    title: TITLE[kind],
    body: `${who} · ${b.service_name} · ${formatDateTime(b.starts_at, b.org.timezone)}`,
  };
}

/**
 * Pushes a booking event to the owners/admins of the team and to the team member who was booked,
 * skipping the person who made the change themselves. Never throws: a failed push must not break a booking.
 */
export async function pushBookingEvent(b: PushBooking, kind: PushKind, actorUserId?: string) {
  try {
    if (!features.push || !b.org.notify_push) return;
    const admin = createAdminClient();

    const { data: members } = await admin.from("memberships").select("id, user_id, role").eq("org_id", b.org.id);
    const userIds = [
      ...new Set(
        (members ?? [])
          .filter((m) => m.role === "owner" || m.role === "admin" || m.id === b.member_id)
          .map((m) => m.user_id as string)
          .filter((id) => id && id !== actorUserId),
      ),
    ];
    if (!userIds.length) return;

    const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", userIds);
    if (!subs?.length) return;

    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey!, env.vapidPrivateKey!);
    const { title, body } = pushMessage(kind, b);
    const payload = JSON.stringify({
      title,
      body,
      url: `/o/${b.org.slug}/${kind === "request" ? "bookings" : "calendar"}`,
      tag: `booking-${b.id}`,
    });

    const dead: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.id); // the phone removed the subscription
          else console.error("[push]", code ?? e);
        }
      }),
    );
    if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
  } catch (e) {
    console.error("[push]", e);
  }
}
