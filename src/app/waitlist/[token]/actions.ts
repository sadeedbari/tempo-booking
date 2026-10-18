"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/db-errors";

export async function leaveWaitlist(token: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_class_waitlist", { p_token: token });
  if (error) return { error: friendlyDbError(error) ?? "Something went wrong. Please try again." };
  revalidatePath(`/waitlist/${token}`);
  return { ok: true };
}
