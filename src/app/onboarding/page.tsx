import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { requireUser } from "@/lib/auth";
import { OnboardingForm } from "./form";
import { Notice } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/server";
import { MAX_OWNED_ORGS } from "@/lib/billing";

export const metadata: Metadata = { title: "Create your team" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const supabase = await createClient();
  const { count: owned } = await supabase.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("role", "owner");
  const atLimit = (owned ?? 0) >= MAX_OWNED_ORGS;
  // Where "back to my dashboard" goes: the first team this person belongs to (owned teams first).
  let backHref = "/";
  if (atLimit) {
    const { data: mine } = await supabase.from("memberships").select("role, organizations(slug)").eq("user_id", user.id).order("created_at");
    const first = (mine ?? []).find((m) => m.role === "owner") ?? (mine ?? [])[0];
    const slug = (first?.organizations as unknown as { slug?: string } | null)?.slug;
    if (slug) backHref = `/o/${slug}/dashboard`;
  }
  return (
    <div className="relative flex min-h-dvh flex-col items-center px-5 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-60 blur-3xl"
        style={{ background: "radial-gradient(35% 40% at 25% 25%, rgba(0,122,255,0.16), transparent), radial-gradient(30% 35% at 80% 60%, rgba(52,199,89,0.12), transparent)" }} />
      <Link href="/" className="mb-10"><Logo className="text-[20px]" /></Link>
      <div className="w-full max-w-[520px] animate-pop">
        {atLimit ? (
          <>
            <h1 className="text-center text-[32px] font-bold">You have {MAX_OWNED_ORGS} teams</h1>
            <p className="mt-2 mb-8 text-center text-[16px] text-label-2">That is the most one person can own.</p>
            <Notice tone="blue">To create another team, delete one you no longer need from its Settings page first.</Notice>
            <div className="mt-6 text-center">
              <Link href={backHref} className="inline-flex h-11 items-center rounded-full bg-accent px-6 text-[15px] font-semibold text-white">Back to my dashboard</Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-center text-[32px] font-bold">Set up your team</h1>
            <p className="mt-2 mb-8 text-center text-[16px] text-label-2">You can change any of this later in Settings.</p>
            <OnboardingForm defaultName={String(user.user_metadata?.full_name ?? "")} />
          </>
        )}
      </div>
    </div>
  );
}
