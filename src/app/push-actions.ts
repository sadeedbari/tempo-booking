"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const sub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

/** Remembers this phone/browser for the signed-in person. If someone else used this device before, it moves to the new person. */
export async function savePushSubscription(input: unknown, userAgent: string): Promise<{ ok?: true; error?: string }> {
  const parsed = sub.safeParse(input);
  if (!parsed.success) return { error: "That device can't receive notifications." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Please sign in again." };
  const { error } = await createAdminClient().from("push_subscriptions").upsert(
    { user_id: data.user.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, user_agent: userAgent.slice(0, 300) },
    { onConflict: "endpoint" },
  );
  return error ? { error: "Couldn't save this device. Please try again." } : { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: true }> {
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}
