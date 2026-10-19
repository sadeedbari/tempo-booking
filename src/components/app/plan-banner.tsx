import Link from "next/link";
import { AlertTriangle, Ban, Info } from "lucide-react";
import { GRACE_DAYS, formatDateLong, graceEndsAt, trialDaysLeft } from "@/lib/billing";
import type { BillingStatus } from "@/lib/billing-server";


/**
 * The strip at the top of the dashboard about the plan: trial days left, a failed payment, a cancellation that is
 * coming, or the read-only notice. Shows nothing for a healthy paid plan. Only the owner gets the link to billing.
 */
export function PlanBanner({ slug, status, isOwner, timeZone }: { slug: string; status: BillingStatus | null; isOwner: boolean; timeZone?: string }) {
  if (!status) return null;
  // Dates are pinned to the business time zone so the server and the browser print the same day.
  const date = (d: string | Date) => formatDateLong(d, timeZone);
  let text: string | null = null;
  let tone: "blue" | "orange" | "red" = "blue";
  if (!status.entitled) {
    text = isOwner
      ? "Your plan isn't active. The dashboard is read-only and your booking page is paused. You can still view and export your data."
      : "This business's plan isn't active, so the dashboard is read-only and the booking page is paused. Ask the account owner to subscribe.";
    tone = "red";
  } else if (!isOwner) {
    text = null; // owners only: trial countdown, payment problems and plan end dates
  } else if (status.status === "trial" && status.trial_ends_at) {
    const d = trialDaysLeft(status.trial_ends_at);
    text = `Free trial: ${d} day${d === 1 ? "" : "s"} left.`;
    if (d <= 3) tone = "orange";
  } else if (status.status === "past_due") {
    const until = status.past_due_since ? date(graceEndsAt(status.past_due_since)) : `${GRACE_DAYS} days from now`;
    text = `Your last payment failed. Update your card before ${until} to keep your booking page on.`;
    tone = "orange";
  } else if (status.cancel_at_period_end && status.current_period_end) {
    text = `Your plan ends on ${date(status.current_period_end)}.`;
  }
  if (!text) return null;
  // AA-contrast text colours (globals.css). The icon differs per state too, so the state never rests on colour alone.
  const cls = { blue: "bg-accent-soft text-accent-text", orange: "bg-[color-mix(in_srgb,var(--orange)_15%,transparent)] text-orange-text", red: "bg-red-soft text-red-text" }[tone];
  const Icon = { blue: Info, orange: AlertTriangle, red: Ban }[tone];
  return (
    <div role="status" className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] px-4 py-2.5 text-[14px] font-medium ${cls}`}>
      <span className="flex items-center gap-2"><Icon className="size-4 shrink-0" aria-hidden />{text}</span>
      {isOwner ? (
        <Link href={`/o/${slug}/settings/billing`} className="font-semibold underline underline-offset-2">Open billing</Link>
      ) : (
        <span className="text-[13px]">Ask the account owner to manage billing.</span>
      )}
    </div>
  );
}
