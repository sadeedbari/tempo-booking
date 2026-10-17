"use server";
import { friendlyDbError } from "@/lib/db-errors";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyBooking } from "@/lib/notify";
import { refreshExternalBusy, syncBookingCalendar } from "@/lib/calendar/sync";
import { refundDeposit } from "@/lib/bookings";

export async function rescheduleBooking(token: string, startsAt: string) {
  const t = new Date(startsAt).getTime();
  const supabase = await createClient();
  const { data: bk } = await supabase.rpc("get_booking_by_token", { p_token: token });
  const orgId = (bk as { org?: { id: string } } | null)?.org?.id;
  if (orgId) await refreshExternalBusy(orgId, new Date(t - 86_400_000).toISOString(), new Date(t + 2 * 86_400_000).toISOString());
  const { data, error } = await supabase.rpc("reschedule_booking_by_token", { p_token: token, p_starts_at: startsAt });
  if (error) return { error: friendlyDbError(error)! };
  await notifyBooking((data as { id: string }).id, "rescheduled");
  revalidatePath(`/booking/${token}`);
  return { ok: true as const };
}

/** Cancels this appointment and every later one in its repeating series. The customer and the team hear about it once. */
export async function cancelSeriesFollowing(token: string, reason: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_series_following_by_token", { p_token: token, p_reason: reason.slice(0, 500) });
  if (error) return { error: friendlyDbError(error)! };
  const r = data as { ids: string[]; first: string };
  for (const id of r.ids) if (id !== r.first) await syncBookingCalendar(id); // take the others off the calendars
  await notifyBooking(r.first, "cancellation");
  revalidatePath(`/booking/${token}`);
  return { ok: true };
}

export async function cancelBooking(token: string, reason: string) {
  const supabase = await createClient();
  const { data: before } = await supabase.rpc("get_booking_by_token", { p_token: token });
  const prior = before as { id: string; status: string } | null;
  const { error } = await supabase.rpc("cancel_booking_by_token", { p_token: token, p_reason: reason.slice(0, 500) });
  if (error) return { error: friendlyDbError(error)! };
  // A request the business never accepted gets its deposit back.
  if (prior?.status === "pending_approval") await refundDeposit(prior.id);
  const { data } = await supabase.rpc("get_booking_by_token", { p_token: token });
  if (data) await notifyBooking((data as { id: string }).id, "cancellation");
  revalidatePath(`/booking/${token}`);
  return { ok: true };
}
