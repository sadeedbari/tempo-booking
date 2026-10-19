import { PrimaryCta, TrialNote } from "./cta";

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="final-cta-title" className="mx-auto max-w-3xl px-4 pb-16 pt-6 text-center sm:px-5 sm:pb-24">
      <div className="rounded-[26px] bg-surface p-6 shadow-sm hairline sm:p-12">
        <h2 id="final-cta-title" className="text-balance text-[clamp(1.875rem,6vw,2.75rem)] font-bold leading-tight tracking-tight">Ready for calmer bookings?</h2>
        <p className="mx-auto mt-3 max-w-md text-lg text-label-2">Create your team and see how it feels. No credit card needed.</p>
        <div className="mt-7 flex flex-col items-stretch sm:items-center">
          <PrimaryCta signedIn={signedIn} />
        </div>
        {!signedIn && <TrialNote />}
      </div>
    </section>
  );
}
