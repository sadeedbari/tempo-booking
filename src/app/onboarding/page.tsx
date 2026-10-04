import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { requireUser } from "@/lib/auth";
import { OnboardingForm } from "./form";

export const metadata: Metadata = { title: "Create your team" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  return (
    <div className="relative flex min-h-dvh flex-col items-center px-5 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-60 blur-3xl"
        style={{ background: "radial-gradient(35% 40% at 25% 25%, rgba(0,122,255,0.16), transparent), radial-gradient(30% 35% at 80% 60%, rgba(52,199,89,0.12), transparent)" }} />
      <Link href="/" className="mb-10"><Logo className="text-[20px]" /></Link>
      <div className="w-full max-w-[520px] animate-pop">
        <h1 className="text-center text-[32px] font-bold">Set up your team</h1>
        <p className="mt-2 mb-8 text-center text-[16px] text-label-2">You can change any of this later in Settings.</p>
        <OnboardingForm defaultName={String(user.user_metadata?.full_name ?? "")} />
      </div>
    </div>
  );
}
