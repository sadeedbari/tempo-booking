"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { RESERVED_SLUGS, slugify } from "@/lib/utils";

export type OnboardingState = { error?: string } | undefined;

const STARTERS = {
  appointment: [
    { name: "Consultation", duration_minutes: 30, price_cents: 0, color: "#30B0C7", description: "A quick chat to plan your visit." },
    { name: "Standard appointment", duration_minutes: 60, price_cents: 8000, color: "#007AFF", description: "Our most popular service." },
    { name: "Extended session", duration_minutes: 90, price_cents: 12000, deposit_cents: 3000, color: "#AF52DE", description: "More time, more care." },
  ],
  meeting: [
    { name: "15 minute intro", duration_minutes: 15, price_cents: 0, color: "#34C759", description: "A short call to get acquainted.", location_type: "video" },
    { name: "30 minute meeting", duration_minutes: 30, price_cents: 0, color: "#007AFF", description: "Talk through anything.", location_type: "video" },
    { name: "Strategy session", duration_minutes: 60, price_cents: 15000, color: "#5856D6", description: "A deep-dive working session.", location_type: "video" },
  ],
} as const;

export async function createTeam(_: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const user = await requireUser("/onboarding");
  const name = String(formData.get("name") || "").trim();
  const slug = slugify(String(formData.get("slug") || name));
  const timezone = String(formData.get("timezone") || "America/Toronto");
  const kind = formData.get("kind") === "meeting" ? "meeting" : "appointment";
  const displayName = String(formData.get("display_name") || user.user_metadata?.full_name || "").trim();

  if (!name) return { error: "Give your team a name." };
  if (slug.length < 3) return { error: "Your link needs at least 3 letters or numbers." };
  if (RESERVED_SLUGS.has(slug)) return { error: "That link is reserved — try another." };

  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("create_organization", {
    p_name: name,
    p_slug: slug,
    p_timezone: timezone,
    p_display_name: displayName,
  });
  if (error) {
    if (error.code === "23505") return { error: "That link is already taken — try another." };
    return { error: error.message };
  }

  await supabase.from("services").insert(
    STARTERS[kind].map((s, i) => ({
      org_id: orgId,
      slug: slugify(s.name),
      kind,
      position: i,
      ...s,
    })),
  );

  redirect(`/o/${slug}/calendar?welcome=1`);
}
