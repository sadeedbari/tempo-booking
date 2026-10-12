import Link from "next/link";
import { CalendarDays, CreditCard, BellRing, Users, Link2, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { buttonClass } from "@/components/ui/button-class";
import { createClient } from "@/lib/supabase/server";

const features = [
  { icon: CalendarDays, color: "#007AFF", title: "A calendar you'll enjoy", body: "Day and week views, per-staff columns, and drag-free quick booking." },
  { icon: Link2, color: "#34C759", title: "Your booking page", body: "A beautiful public page for appointments and meetings — share one link." },
  { icon: Users, color: "#AF52DE", title: "Built for teams", body: "Invite staff, assign services, and control access with roles." },
  { icon: CreditCard, color: "#FF9500", title: "Deposits & payments", body: "Collect deposits at booking with Stripe. No-shows, handled." },
  { icon: BellRing, color: "#FF2D55", title: "Automatic reminders", body: "Confirmations and reminders by email and SMS, on your schedule." },
  { icon: ShieldCheck, color: "#30B0C7", title: "Private by design", body: "Row-level security keeps each team's data strictly its own." },
];

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  return (
    <div className="relative overflow-hidden">
      {/* Ambient colour */}
      <div className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[640px] opacity-70 blur-3xl"
        style={{ background: "radial-gradient(40% 50% at 30% 40%, rgba(0,122,255,0.20), transparent), radial-gradient(35% 45% at 70% 30%, rgba(175,82,222,0.16), transparent), radial-gradient(30% 40% at 55% 70%, rgba(52,199,89,0.12), transparent)" }} />

      <header className="sticky top-0 z-40 glass border-b border-separator">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Logo />
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Link href="/app" className={buttonClass("filled", "sm", true)}>Open Tempo</Link>
            ) : (
              <>
                <Link href="/login" className={buttonClass("plain", "sm", true)}>Sign in</Link>
                <Link href="/signup" className={buttonClass("filled", "sm", true)}>Get started</Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pt-20 pb-16 text-center sm:pt-28">
          <p className="animate-rise text-[15px] font-semibold text-accent">Scheduling for teams</p>
          <h1 className="animate-rise mx-auto mt-3 max-w-3xl text-[44px] font-bold leading-[1.04] tracking-[-0.035em] sm:text-[72px]" style={{ animationDelay: "60ms" }}>
            Booking, made <span className="bg-gradient-to-r from-[#007AFF] via-[#5856D6] to-[#AF52DE] bg-clip-text text-transparent">effortless.</span>
          </h1>
          <p className="animate-rise mx-auto mt-6 max-w-xl text-[19px] leading-relaxed text-label-2" style={{ animationDelay: "120ms" }}>
            Tempo gives your team a calm, beautiful place to take appointments and meetings — with payments and reminders built in.
          </p>
          <div className="animate-rise mt-9 flex flex-wrap justify-center gap-3" style={{ animationDelay: "180ms" }}>
            <Link href={signedIn ? "/app" : "/signup"} className={buttonClass("filled", "lg", true)}>
              {signedIn ? "Go to your calendar" : "Create your team — free"}
            </Link>
            <a href="#features" className={buttonClass("glass", "lg", true)}>See what&apos;s inside</a>
          </div>

          {/* Product preview */}
          <div className="animate-rise relative mx-auto mt-16 max-w-4xl" style={{ animationDelay: "260ms" }}>
            <div className="rounded-[26px] glass-strong hairline p-2 shadow-lg">
              <div className="grid grid-cols-1 overflow-hidden rounded-[20px] bg-surface text-left sm:grid-cols-[220px_1fr]">
                <aside className="hidden border-r border-separator bg-surface-2/60 p-4 sm:block">
                  <div className="mb-5 flex items-center gap-2 text-[14px] font-semibold"><span className="size-6 rounded-[7px] bg-gradient-to-b from-[#3D9BFF] to-[#0062E0]" /> Lumen Studio</div>
                  {["Calendar", "Bookings", "Services", "Team", "Availability"].map((x, i) => (
                    <div key={x} className={`mb-1 rounded-[9px] px-3 py-1.5 text-[13px] ${i === 0 ? "bg-accent text-white" : "text-label-2"}`}>{x}</div>
                  ))}
                </aside>
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="text-[20px] font-bold">Tuesday, 14</div>
                    <div className="rounded-[9px] bg-surface-2 p-[2px] text-[12px]"><span className="inline-block rounded-[7px] bg-surface px-3 py-1 shadow-sm">Day</span><span className="inline-block px-3 py-1 text-label-2">Week</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { n: "Maya", c: "#007AFF", items: [["9:00", "Haircut & style", 2], ["11:30", "Colour consult", 1]] },
                      { n: "Jordan", c: "#34C759", items: [["9:30", "Deep tissue massage", 2], ["1:00", "Facial", 1]] },
                      { n: "Aisha", c: "#AF52DE", items: [["10:00", "Strategy call", 1], ["2:00", "Onboarding", 2]] },
                    ].map((col) => (
                      <div key={col.n} className="space-y-2">
                        <div className="text-[12px] font-semibold text-label-2">{col.n}</div>
                        {col.items.map(([t, s, h]) => (
                          <div key={s as string} className="rounded-[10px] px-2.5 py-2 text-[12px]" style={{ background: `${col.c}1f`, borderLeft: `3px solid ${col.c}`, height: (h as number) * 44 }}>
                            <div className="font-semibold" style={{ color: col.c }}>{t}</div>
                            <div className="truncate text-label">{s}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-center text-[34px] font-bold tracking-tight sm:text-[44px]">Everything in its right place.</h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-[17px] text-label-2">Thoughtful defaults, no clutter. Just the tools you reach for every day.</p>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-[22px] bg-surface p-6 shadow-sm hairline transition-transform duration-300 hover:-translate-y-0.5">
                <div className="grid size-11 place-items-center rounded-[12px] text-white" style={{ background: `linear-gradient(180deg, ${f.color}cc, ${f.color})` }}>
                  <f.icon className="size-5" strokeWidth={2.2} />
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-label-2">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-separator py-8 text-center text-[13px] text-label-3">
        <div className="mb-2 flex justify-center gap-2 font-medium">
          <Link href="/privacy" className="inline-block px-3 py-3 hover:text-label-2">Privacy Policy</Link>
          <Link href="/terms" className="inline-block px-3 py-3 hover:text-label-2">Terms of Service</Link>
        </div>
        © {new Date().getFullYear()} Tempo. Made with care.
      </footer>
    </div>
  );
}
