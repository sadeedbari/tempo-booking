import { Check } from "lucide-react";
import { PrimaryCta, TrialNote } from "./cta";
import { buttonClass } from "@/components/ui/button-class";
import { TRIAL_DAYS } from "@/lib/billing";

const PREVIEW_ALT = "Illustration of the Tempo calendar showing one day with appointments for three team members.";

const COLUMNS = [
  { n: "Maya", c: "#007AFF", items: [["9:00", "Haircut & style", 2], ["11:30", "Colour consult", 1]] },
  { n: "Jordan", c: "#34C759", items: [["9:30", "Deep tissue massage", 2], ["1:00", "Facial", 1]] },
  { n: "Aisha", c: "#AF52DE", items: [["10:00", "Strategy call", 1], ["2:00", "Onboarding", 2]] },
] as const;

/** Stylised calendar (no real data, no images). On phones the sidebar and third column are dropped so it fits. */
function ProductPreview() {
  return (
    <figure className="animate-rise relative mx-auto mt-12 max-w-4xl sm:mt-16" style={{ animationDelay: "260ms" }}>
      <div role="img" aria-label={PREVIEW_ALT} className="rounded-[22px] glass-strong hairline p-1.5 shadow-lg sm:rounded-[26px] sm:p-2">
        <div aria-hidden className="grid grid-cols-1 overflow-hidden rounded-[18px] bg-surface text-left sm:grid-cols-[200px_1fr] sm:rounded-[20px] md:grid-cols-[220px_1fr]">
          <aside className="hidden border-r border-separator bg-surface-2/60 p-4 sm:block">
            <div className="mb-5 flex items-center gap-2 text-[14px] font-semibold"><span className="size-6 rounded-[7px] bg-gradient-to-b from-[#3D9BFF] to-[#0062E0]" /> Lumen Studio</div>
            {["Calendar", "Bookings", "Services", "Team", "Availability"].map((x, i) => (
              <div key={x} className={`mb-1 rounded-[9px] px-3 py-1.5 text-[13px] ${i === 0 ? "bg-accent-fill text-white" : "text-label-2"}`}>{x}</div>
            ))}
          </aside>
          <div className="min-w-0 p-3 sm:p-5">
            <div className="mb-3 flex items-center justify-between sm:mb-4">
              <div className="text-[18px] font-bold sm:text-[20px]">Tuesday, 14</div>
              <div className="rounded-[9px] bg-surface-2 p-[2px] text-[12px]"><span className="inline-block rounded-[7px] bg-surface px-3 py-1 shadow-sm">Day</span><span className="inline-block px-3 py-1 text-label-2">Week</span></div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {COLUMNS.map((col, i) => (
                <div key={col.n} className={`min-w-0 space-y-2 ${i === 2 ? "hidden sm:block" : ""}`}>
                  <div className="text-[12px] font-semibold text-label-2">{col.n}</div>
                  {col.items.map(([t, s, h]) => (
                    <div key={s} className="rounded-[10px] px-2.5 py-2 text-[12px]" style={{ background: `${col.c}1f`, borderLeft: `3px solid ${col.c}`, height: h * 44 }}>
                      <div className="font-semibold" style={{ color: `color-mix(in srgb, ${col.c} 50%, var(--label))` }}>{t}</div>
                      <div className="truncate text-label">{s}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-base text-label-2">Illustration. Names and bookings are examples.</figcaption>
    </figure>
  );
}

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="mx-auto max-w-6xl px-4 pt-10 pb-12 text-center sm:px-5 sm:pt-24 sm:pb-16">
      <p className="animate-rise text-base font-semibold text-accent-text">Online booking for service businesses</p>
      <h1 id="hero-title" className="animate-rise mx-auto mt-3 max-w-3xl text-balance [overflow-wrap:anywhere] text-[clamp(1.75rem,9.5vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.035em]" style={{ animationDelay: "60ms" }}>
        Booking, made <span className="bg-gradient-to-r from-[#007AFF] via-[#5856D6] to-[#AF52DE] bg-clip-text text-transparent">effortless.</span>
      </h1>
      <p className="animate-rise mx-auto mt-5 max-w-xl text-lg leading-relaxed text-label-2 sm:mt-6 sm:text-xl" style={{ animationDelay: "120ms" }}>
        Tempo is online booking software for salons, clinics, studios, classes and mobile services. Take appointments and classes, collect deposits and send reminders.
      </p>
      <div className="animate-rise mt-8 flex flex-col items-stretch gap-3 sm:mt-9 sm:flex-row sm:items-center sm:justify-center" style={{ animationDelay: "180ms" }}>
        <PrimaryCta signedIn={signedIn} />
        <a href="#features" className={buttonClass("glass", "lg", true)}>See what&apos;s inside</a>
      </div>
      {!signedIn && <TrialNote className="animate-rise mt-3 text-base text-label-2" />}

      {/* Proof strip (the trial items are for new visitors only, like the trial line above): only things that are true and checkable in the code. No customer numbers, logos or quotes. */}
      <ul aria-label="At a glance" className="animate-rise mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-base font-medium" style={{ animationDelay: "220ms" }}>
        {[...(signedIn ? [] : [`${TRIAL_DAYS}-day free trial`, "No credit card to start"]), "Prices in Canadian dollars", "Cancel any time"].map((t) => (
          <li key={t} className="inline-flex items-center gap-1.5"><Check className="size-4 text-green-text" strokeWidth={2.6} aria-hidden />{t}</li>
        ))}
      </ul>

      <ProductPreview />
    </section>
  );
}
