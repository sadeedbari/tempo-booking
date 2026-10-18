"use server";
import { friendlyDbError } from "@/lib/db-errors";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvite(_: { error?: string } | undefined, formData: FormData) {
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", {
    p_token: String(formData.get("token")),
    p_display_name: String(formData.get("display_name") || ""),
  });
  if (error) {
    // The team is full or its plan isn't active: the person accepting can't fix that and can't open Billing, so tell them
    // who can (the database words these for the owner).
    if ((error as { hint?: string }).hint === "billing") return { error: "This team can't add people right now. Please ask the account owner to check the plan." };
    return { error: friendlyDbError(error)! };
  }
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", orgId).single();
  redirect(`/o/${org?.slug}/dashboard`);
}
