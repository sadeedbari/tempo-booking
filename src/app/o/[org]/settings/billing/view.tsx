"use client";
import { useRef, useState, useTransition } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  BASE_CENTS, LOCATION_CENTS, formatDateLong, MAX_EXTRA_LOCATIONS, MAX_STAFF_PACKS, PACK_CENTS, TRIAL_LIMITS, graceEndsAt, money, monthlyCents, parsePlan,
  planFits, planLimits, type Plan, type SubscriptionStatus, type Usage,
} from "@/lib/billing";
import { cancelSubscription, changeSubscriptionPlan, openPortal, resumeSubscription, startCheckout } from "./actions";

export interface BillingSummary {
  status: SubscriptionStatus;
  entitled: boolean;
  trialEndsAt: string;
  trialDaysLeft: number;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  extraLocations: number;
  staffPacks: number;
  hasCustomer: boolean;
  /** A Stripe subscription exists that can be changed (paying, or in the payment grace period). */
  live: boolean;
}

const STATUS: Record<SubscriptionStatus, { label: string; tone: "green" | "blue" | "orange" | "red" | "gray" }> = {
  trial: { label: "Free trial", tone: "blue" },
  active: { label: "Active", tone: "green" },
  past_due: { label: "Payment failed", tone: "orange" },
  cancelled: { label: "Cancelled", tone: "red" },
  expired: { label: "Expired", tone: "red" },
};

export function BillingView({
  slug, configured, sub, usage, pendingInvites, initialPlan, banner, timeZone,
}: {
  slug: string; timeZone?: string; configured: boolean; sub: BillingSummary; usage: Usage; pendingInvites: number; initialPlan: Plan; banner?: "success" | "processing" | "cancelled" | "no-trial";
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The last refusal told the owner to settle an unpaid invoice in the Stripe Customer Portal: show the button right there.
  const [portalHint, setPortalHint] = useState(false);
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const armedAt = useRef(0);
  // Dates are pinned to the business time zone so the server and the browser print the same day (no hydration mismatch).
  const date = (d: string | Date) => formatDateLong(d, timeZone);
  // Two-step cancel: the first press arms it, a second press at least 0.8 s later (so a double-click can't confirm it) confirms.
  // It disarms itself after 6 seconds.
  const pressCancel = (e: React.MouseEvent) => {
    if (!confirmCancel) {
      armedAt.current = e.timeStamp;
      setConfirmCancel(true);
      setTimeout(() => setConfirmCancel(false), 6000);
      return;
    }
    if (e.timeStamp - armedAt.current < 800) return;
    setConfirmCancel(false);
    go(() => cancelSubscription(slug), "Subscription will end at the period end");
  };

  const current: Plan = { extraLocations: sub.extraLocations, staffPacks: sub.staffPacks };
  const paying = sub.status === "active" || sub.status === "past_due";
  const limits = sub.status === "trial" ? TRIAL_LIMITS : planLimits(current);
  const price = monthlyCents(plan);
  const fit = planFits(plan, usage);
  const unchanged = plan.extraLocations === current.extraLocations && plan.staffPacks === current.staffPacks;
  const newLimits = planLimits(plan);

  // Display only: the server recomputes the price and checks everything again.
  const setNum = (key: keyof Plan, raw: string, max: number) => {
    const n = Math.min(max, Math.max(0, Math.floor(Number(raw) || 0)));
    setPlan((p) => ({ ...p, [key]: n }));
  };
  const go = (fn: () => Promise<{ error?: string; url?: string; ok?: boolean; portal?: boolean }>, done?: string) =>
    start(async () => {
      const r = await fn();
      setPortalHint(Boolean(r.portal));
      if (r.error) return setError(r.error);
      setError(null);
      if (r.url) { window.location.href = r.url; return; }
      if (done) toast(done);
    });

  return (
    <>
      <PageHeader title="Billing" subtitle="Your plan, what you use, and your invoices." />
      <div className="max-w-3xl space-y-6">
        {banner === "success" && <Notice tone="green">Thanks! Your subscription is active.</Notice>}
        {banner === "processing" && <Notice tone="blue">Payment received. Your plan will show here in a moment; refresh this page if it doesn&apos;t.</Notice>}
        {banner === "no-trial" && <Notice tone="blue">Your free trial was already used on another team, so this team starts without one. Choose a plan below to switch it on.</Notice>}
        {banner === "cancelled" && <Notice tone="blue">Checkout was cancelled. Nothing was charged.</Notice>}
        {!configured && <Notice>Billing isn&apos;t set up on this server yet, so plans can&apos;t be changed.</Notice>}

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-11 place-items-center rounded-[12px] bg-accent-soft text-accent"><CreditCard className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[17px] font-semibold">
                {sub.status === "trial" ? "Free trial" : `${limits.locations} location${limits.locations === 1 ? "" : "s"}, ${limits.staff} staff`}
                <Badge tone={STATUS[sub.status].tone}>{STATUS[sub.status].label}</Badge>
                {sub.cancelAtPeriodEnd && paying && <Badge tone="orange">Ends {sub.periodEnd ? date(sub.periodEnd) : "soon"}</Badge>}
              </div>
              <div className="text-[14px] text-label-2">
                {paying && `${money(monthlyCents(current))}/month`}
                {sub.status === "trial" && (sub.entitled ? `${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? "" : "s"} left. Your trial ends ${date(sub.trialEndsAt)}. No card needed until you subscribe.` : "Your trial has ended.")}
                {(sub.status === "expired" || sub.status === "cancelled") && "No active plan."}
              </div>
            </div>
          </div>

          {paying && sub.periodEnd && !sub.cancelAtPeriodEnd && (
            <p className="mt-4 text-[14px] text-label-2">Next invoice: <strong className="text-label">{money(monthlyCents(current))}</strong> on {date(sub.periodEnd)} (before any tax).</p>
          )}
          {paying && sub.cancelAtPeriodEnd && sub.periodEnd && (
            <div className="mt-4 space-y-2">
              <Notice tone="blue">Your plan is cancelled. Everything keeps working until {date(sub.periodEnd)}, then your booking page pauses and the dashboard becomes read-only. Nothing is deleted.</Notice>
              <Button pill loading={pending} disabled={!configured} onClick={() => go(() => resumeSubscription(slug), "Subscription resumed")}>Keep my subscription</Button>
            </div>
          )}
          {sub.status === "past_due" && (
            <div className="mt-4"><Notice>
              Your last payment didn&apos;t go through. Please update your card{sub.pastDueSince ? ` before ${date(graceEndsAt(sub.pastDueSince))}` : ""} to avoid your booking page pausing.
            </Notice></div>
          )}
          {!sub.entitled && (
            <div className="mt-4"><Notice>
              Your booking page is paused and the dashboard is read-only. You can still view and export everything, and nothing has been deleted. Subscribe below to switch it all back on.
            </Notice></div>
          )}
        </Card>

        <Card>
          <h2 className="text-[17px] font-semibold">What you use</h2>
          <div className="mt-3 space-y-4">
            <Meter label="Locations" used={usage.locations} max={limits.locations} />
            <Meter label="Team members" used={usage.staff + (usage.invites ?? 0)} max={limits.staff} note={pendingInvites > 0 ? `includes ${pendingInvites} invitation${pendingInvites === 1 ? "" : "s"} waiting` : undefined} />
          </div>
          <p className="mt-3 text-[13px] text-label-3">Every team member counts, including people without a login, and each invitation waiting to be accepted holds a seat. Hidden locations don&apos;t count.</p>
        </Card>

        <Card>
          <h2 className="text-[17px] font-semibold">{sub.live ? "Change your plan" : "Choose a plan"}</h2>
          <p className="mt-1 text-[14px] text-label-2">
            {money(BASE_CENTS)}/month includes 1 location and 5 staff. Each extra location is +{money(LOCATION_CENTS)}/month and includes 5 more staff. Each staff pack is +{money(PACK_CENTS)}/month for 5 more staff, shared across your business. Prices are in CAD.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Extra locations" hint={`Up to ${MAX_EXTRA_LOCATIONS}`}>
              <Input type="number" inputMode="numeric" min={0} max={MAX_EXTRA_LOCATIONS} step={1} value={plan.extraLocations} onChange={(e) => setNum("extraLocations", e.target.value, MAX_EXTRA_LOCATIONS)} />
            </Field>
            <Field label="Staff packs (5 staff each)" hint={`Up to ${MAX_STAFF_PACKS}`}>
              <Input type="number" inputMode="numeric" min={0} max={MAX_STAFF_PACKS} step={1} value={plan.staffPacks} onChange={(e) => setNum("staffPacks", e.target.value, MAX_STAFF_PACKS)} />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-[12px] bg-surface-2 px-4 py-3" aria-live="polite">
            <div className="text-[14px] text-label-2">{newLimits.locations} location{newLimits.locations === 1 ? "" : "s"}, {newLimits.staff} staff</div>
            <div className="text-[20px] font-bold">{money(price)}<span className="text-[14px] font-medium text-label-2">/month</span></div>
          </div>
          {!fit.ok && <div className="mt-3"><Notice>{fit.reason}</Notice></div>}
          {error && <div className="mt-3"><Notice>{error}</Notice></div>}
          {portalHint && (
            <div className="mt-3">
              <Button pill variant="gray" loading={pending} disabled={!configured} onClick={() => go(() => openPortal(slug))}>Open Manage billing <ExternalLink className="size-4" aria-hidden /></Button>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {sub.live ? (
              <Button pill loading={pending} disabled={!configured || !fit.ok || unchanged || !parsePlan(plan)} onClick={() => go(() => changeSubscriptionPlan(slug, plan), "Plan updated")}>
                Update plan
              </Button>
            ) : (
              <Button pill loading={pending} disabled={!configured || !fit.ok || !parsePlan(plan)} onClick={() => go(() => startCheckout(slug, plan))}>
                Subscribe for {money(price)}/month
              </Button>
            )}
          </div>
          {sub.live && <p className="mt-3 text-[13px] text-label-3">Upgrades are charged now for the rest of this billing period. Downgrades are credited on your next invoice, and can&apos;t go below what you use today.</p>}
        </Card>

        {(sub.hasCustomer || sub.live) && (
          <Card>
            <h2 className="text-[17px] font-semibold">Card and invoices</h2>
            <p className="mt-1 text-[14px] text-label-2">Update your card, see past invoices and download receipts on Stripe&apos;s secure page. Tempo never sees your card details.</p>
            <div className="mt-4">
              <Button pill variant="gray" loading={pending} disabled={!configured} onClick={() => go(() => openPortal(slug))}>Manage billing <ExternalLink className="size-4" aria-hidden /></Button>
            </div>
          </Card>
        )}

        {sub.live && !sub.cancelAtPeriodEnd && (
          <Card>
            <h2 className="text-[17px] font-semibold">Cancel subscription</h2>
            <p className="mt-1 text-[14px] text-label-2">You keep full access until the end of the period you&apos;ve paid for{sub.periodEnd ? ` (${date(sub.periodEnd)})` : ""}. After that your booking page pauses and the dashboard becomes read-only. Nothing is deleted, and you can subscribe again any time.</p>
            <div className="mt-4">
              <Button
                variant="destructive"
                pill
                loading={pending}
                disabled={!configured}
                onClick={pressCancel}
              >
                {confirmCancel ? "Tap again to confirm" : "Cancel at period end"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Meter({ label, used, max, note }: { label: string; used: number; max: number; note?: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  const over = used > max;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="font-medium">{label}</span>
        <span className={over ? "font-semibold text-red" : "text-label-2"}>{used} of {max}{note ? ` · ${note}` : ""}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(used, max)}>
        <div className={over || pct >= 100 ? "h-full bg-orange" : "h-full bg-accent"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
