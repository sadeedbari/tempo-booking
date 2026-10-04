"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyBooking } from "@/lib/notify";

export async function cancelBooking(token: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking_by_token", { p_token: token, p_reason: reason.slice(0, 500) });
  if (error) return { error: error.message };
  const { data } = await supabase.rpc("get_booking_by_token", { p_token: token });
  if (data) await notifyBooking((data as { id: string }).id, "cancellation");
  revalidatePath(`/booking/${token}`);
  return { ok: true };
}
