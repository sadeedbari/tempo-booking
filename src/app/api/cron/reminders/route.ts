import { createAdminClient } from "@/lib/supabase/admin";
import { notifyBooking } from "@/lib/notify";
import { env } from "@/lib/env";
import { refundDeposit } from "@/lib/bookings";

/**
 * Run every 15–60 minutes (see vercel.json). Sends reminders for upcoming
 * bookings, releases abandoned payment holds and marks past bookings complete.
 */
export async function GET(request: Request) {
  if (!env.cronSecret || request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const admin = createAdminClient();
  const now = new Date();

  // 1. Release unpaid holds older than 30 minutes.
  await admin
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: now.toISOString(), cancel_reason: "Payment not completed" })
    .eq("status", "pending_payment")
    .lt("created_at", new Date(now.getTime() - 30 * 60_000).toISOString());

  // 1b. Requests nobody approved before their start time lapse, with the deposit refunded.
  const { data: lapsed } = await admin.from("bookings").select("id").eq("status", "pending_approval").lt("starts_at", now.toISOString()).limit(200);
  for (const b of lapsed ?? []) {
    const refund = await refundDeposit(b.id);
    if (!refund.ok) continue; // retry next run
    await admin.from("bookings").update({ status: "cancelled", cancelled_at: now.toISOString(), cancel_reason: "Not confirmed in time" }).eq("id", b.id).eq("status", "pending_approval");
    await notifyBooking(b.id, "declined");
  }

  // 2. Reminders — look ahead up to the longest reminder window (48h).
  const { data: due } = await admin
    .from("bookings")
    .select("id, starts_at, org:organizations(reminder_hours_before)")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gt("starts_at", now.toISOString())
    .lt("starts_at", new Date(now.getTime() + 48 * 3600_000).toISOString())
    .limit(500);

  let sent = 0;
  for (const b of due ?? []) {
    const hours = (b.org as unknown as { reminder_hours_before: number })?.reminder_hours_before ?? 0;
    if (!hours) continue;
    if (new Date(b.starts_at).getTime() - now.getTime() > hours * 3600_000) continue;
    // Claim it first so parallel runs never double-send.
    const { data: claimed } = await admin
      .from("bookings")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", b.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (claimed?.length) {
      await notifyBooking(b.id, "reminder");
      sent++;
    }
  }

  // 3. Auto-complete bookings that ended more than 12 hours ago.
  await admin
    .from("bookings")
    .update({ status: "completed" })
    .eq("status", "confirmed")
    .lt("ends_at", new Date(now.getTime() - 12 * 3600_000).toISOString());

  return Response.json({ ok: true, reminders: sent });
}
