import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { buttonClass } from "@/components/ui/button-class";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth";
import { AcceptInvite } from "./accept";

export const metadata: Metadata = { title: "Join team" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const supabase = await createClient();
  const { data: invite } = await supabase.rpc("get_invitation", { p_token: token });
  const user = await getUser();
  const inv = invite as { org_name: string; email: string; role: string; valid: boolean } | null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <Link href="/" className="mb-8"><Logo className="text-[20px]" /></Link>
      <div className="w-full max-w-[420px] rounded-[24px] glass-strong hairline p-8 text-center shadow-lg animate-pop">
        {!inv || !inv.valid ? (
          <>
            <h1 className="text-[24px] font-bold">Invitation expired</h1>
            <p className="mt-2 text-[15px] text-label-2">Ask your team admin to send a new invite.</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 grid size-16 place-items-center rounded-[18px] bg-gradient-to-b from-[#3D9BFF] to-[#0062E0] text-[26px] font-bold text-white">
              {inv.org_name[0]?.toUpperCase()}
            </div>
            <h1 className="text-[24px] font-bold">Join {inv.org_name}</h1>
            <p className="mt-2 text-[15px] text-label-2">
              You&apos;ve been invited as {inv.role === "admin" ? "an admin" : "a team member"}.
            </p>
            <div className="mt-6">
              {user ? (
                user.email?.toLowerCase() === inv.email.toLowerCase() ? (
                  <AcceptInvite token={token} defaultName={String(user.user_metadata?.full_name ?? "")} />
                ) : (
                  <p className="rounded-[12px] bg-red-soft px-4 py-3 text-[14px] text-red">
                    This invite is for {inv.email}. You&apos;re signed in as {user.email}.
                  </p>
                )
              ) : (
                <div className="space-y-2">
                  <Link href={`/signup?next=/invite/${token}`} className={buttonClass("filled", "lg", true, "w-full")}>
                    Create account
                  </Link>
                  <Link href={`/login?next=/invite/${token}`} className={buttonClass("plain", "lg", true, "w-full")}>
                    I already have an account
                  </Link>
                  <p className="pt-2 text-[13px] text-label-3">Use {inv.email} to join.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
