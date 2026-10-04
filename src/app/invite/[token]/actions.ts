"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvite(_: { error?: string } | undefined, formData: FormData) {
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", {
    p_token: String(formData.get("token")),
    p_display_name: String(formData.get("display_name") || ""),
  });
  if (error) return { error: error.message };
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", orgId).single();
  redirect(`/o/${org?.slug}/calendar`);
}
