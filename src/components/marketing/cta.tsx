import Link from "next/link";
import { buttonClass } from "@/components/ui/button-class";
import { TRIAL_DAYS } from "@/lib/billing";

/** The exact trial wording used under every sign-up button and in the pricing section. */
export const TRIAL_LINE = `${TRIAL_DAYS}-day free trial. No credit card required.`;

/** Primary call to action. Signed-in visitors go to the app instead of the sign-up page. */
export function PrimaryCta({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <Link href={signedIn ? "/app" : "/signup"} className={buttonClass("filled", "lg", true, className)}>
      {signedIn ? "Go to your calendar" : "Get started free"}
    </Link>
  );
}

/** The trial terms, shown right under a sign-up button (not shown to people who already have a team). */
export function TrialNote({ className }: { className?: string }) {
  return <p className={className ?? "mt-3 text-base text-label-2"}>{TRIAL_LINE}</p>;
}
