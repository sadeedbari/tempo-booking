import { Check } from "lucide-react";
import { PrimaryCta, TRIAL_LINE } from "./cta";
import { PriceEstimator } from "./price-estimator";
import { BASE_CENTS, LOCATION_CENTS, PACK_CENTS, STAFF_PER_LOCATION, STAFF_PER_PACK, TRIAL_LIMITS, money } from "@/lib/billing";

export function Pricing({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="mx-auto max-w-6xl scroll-mt-4 md:scroll-mt-20 px-4 py-14 sm:px-5 sm:py-20">
      <h2 id="pricing-title" className="text-balance text-center text-[clamp(1.875rem,6vw,2.75rem)] font-bold leading-tight tracking-tight">Simple pricing in Canadian dollars.</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-lg text-label-2">
        Start with a 14-day free trial, then {money(BASE_CENTS)} CAD a month. Add only what you need.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="min-w-0 rounded-[22px] bg-surface p-5 shadow-sm hairline sm:p-8">
          <h3 className="text-xl font-bold tracking-tight">Tempo</h3>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-5xl font-bold tracking-tight">{money(BASE_CENTS)}</span>
            <span className="text-lg font-semibold text-label-2">CAD / month</span>
          </p>
          <ul className="mt-5 space-y-2 text-base">
            {["1 location", `${STAFF_PER_LOCATION} staff`, "Everything on this page"].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check className="size-5 shrink-0 text-green-text" strokeWidth={2.6} aria-hidden />{t}</li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col items-stretch sm:items-start">
            <PrimaryCta signedIn={signedIn} />
          </div>
          {!signedIn && <p className="mt-3 text-base text-label-2" data-testid="pricing-trial-line">{TRIAL_LINE}</p>}
          <p className="mt-1 text-base text-label-2">The trial includes {TRIAL_LIMITS.locations} location and {TRIAL_LIMITS.staff} staff. One trial per person.</p>

          <h4 className="mt-8 text-lg font-semibold">Add what you need</h4>
          <ul className="mt-2 space-y-3 text-base">
            <li><span className="font-semibold">Extra location: +{money(LOCATION_CENTS)}/month.</span> <span className="text-label-2">Includes {STAFF_PER_LOCATION} more staff.</span></li>
            <li><span className="font-semibold">Extra staff pack: +{money(PACK_CENTS)}/month.</span> <span className="text-label-2">Adds {STAFF_PER_PACK} more staff, shared across your whole business.</span></li>
          </ul>
        </div>

        <PriceEstimator />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="rounded-[22px] bg-surface p-5 shadow-sm hairline sm:p-6">
          <h3 className="text-lg font-semibold">After your trial</h3>
          <p className="mt-2 text-base leading-relaxed text-label-2">
            We email you 3 days before it ends. If you don&apos;t subscribe, your dashboard becomes view-only and your booking page pauses. Nothing is deleted. You can still view and export your data. Subscribe and everything comes back right away.
          </p>
        </div>
        <div className="rounded-[22px] bg-surface p-5 shadow-sm hairline sm:p-6">
          <h3 className="text-lg font-semibold">Cancel any time</h3>
          <p className="mt-2 text-base leading-relaxed text-label-2">You keep access until the end of the period you paid for.</p>
        </div>
      </div>
      <p className="mt-6 text-center text-base text-label-2">Prices in CAD, plus applicable taxes where required.</p>
    </section>
  );
}
