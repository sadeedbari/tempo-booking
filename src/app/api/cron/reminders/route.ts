import { createAdminClient } from "@/lib/supabase/admin";
import { notifyBooking } from "@/lib/notify";
import { runTimedWorkflows } from "@/lib/messaging";
import { env } from "@/lib/env";
import { refundDeposit } from "@/lib/bookings";

/**
 * Run every 15–60 minutes (see vercel.json and the hourly GitHub workflow). Releases abandoned payment holds,
 * closes requests nobody approved in time, sends the timed workflow messages (reminders etc.) and marks past
 * bookings complete. Each step is isolated: if one fails the others still run and the failure is reported.
 */
export async function GET(request: Request) {
  if (!env.cronSecret || request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const admin = createAdminClient();
  const now = new Date();
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[cron] ${name} failed:`, e);
      errors.push(`${name}: ${(e as Error).message}`);
    }
  };

  // Local end-to-end runs only touch the tagged test teams, never real ones.
  let only: string[] | undefined;
  if (process.env.TEMPO_E2E === "1") {
    const { data } = await admin.from("organizations").select("id").like("slug", "e2e%");
    only = (data ?? []).map((o) => o.id as string);
  }
  const scoped = <T extends { in: (c: string, v: string[]) => T }>(q: T) => (only ? q.in("org_id", only) : q);

  let sent = 0;

  // 1. Release unpaid holds older than 30 minutes.
  await step("release unpaid holds", async () => {
    const { error } = await scoped(
      admin
        .from("bookings")
        .update({ status: "cancelled", cancelled_at: now.toISOString(), cancel_reason: "Payment not completed" })
        .eq("status", "pending_payment")
        .lt("created_at", new Date(now.getTime() - 30 * 60_000).toISOString()),
    );
    if (error) throw new Error(error.message);
  });

  // 1b. Requests nobody approved before their start time lapse, with the deposit refunded.
  await step("close lapsed requests", async () => {
    const { data: lapsed, error } = await scoped(admin.from("bookings").select("id").eq("status", "pending_approval").lt("starts_at", now.toISOString()).limit(200));
    if (error) throw new Error(error.message);
    for (const b of lapsed ?? []) {
      const refund = await refundDeposit(b.id);
      if (!refund.ok) continue; // retry next run
      await admin.from("bookings").update({ status: "cancelled", cancelled_at: now.toISOString(), cancel_reason: "Not confirmed in time" }).eq("id", b.id).eq("status", "pending_approval");
      await notifyBooking(b.id, "declined");
    }
  });

  // 2. Timed messages: reminders and "after the appointment" messages from each business's workflows.
  await step("timed messages", async () => {
    sent = await runTimedWorkflows(now, only);
  });

  // 3. Auto-complete bookings that ended more than 12 hours ago.
  await step("complete finished bookings", async () => {
    const { error } = await scoped(admin.from("bookings").update({ status: "completed" }).eq("status", "confirmed").lt("ends_at", new Date(now.getTime() - 12 * 3600_000).toISOString()));
    if (error) throw new Error(error.message);
  });

  return Response.json({ ok: errors.length === 0, messages: sent, ...(errors.length ? { errors } : {}) });
}
