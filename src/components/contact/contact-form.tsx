"use client";
import { useEffect, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { sendInquiry } from "@/app/[slug]/contact/actions";
import type { PublicContact } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The "ask us a question" form: on the business's hosted contact page, and inside the pop-up / inline
 * frame on their own website (`embed`, see public/embed.js).
 */
export function ContactForm({ data, embed, initialService }: { data: PublicContact; embed?: boolean; initialService?: string }) {
  const { org, services } = data;
  const accent = /^#[0-9a-fA-F]{6}$/.test(org.accent_color) ? org.accent_color : "#007AFF";
  const [openedAt] = useState(() => Date.now());
  const [serviceId, setServiceId] = useState(services.find((s) => s.slug === initialService)?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  // Inside a frame on another website, tell the page how tall the form is so an inline form can grow to fit.
  useEffect(() => {
    if (!embed) return;
    const post = () => window.parent.postMessage({ type: "tempo:resize", height: Math.ceil(document.documentElement.scrollHeight) }, "*");
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [embed]);

  // Inside the website pop-up the keyboard focus is in this frame, so Escape has to ask the page to close it.
  useEffect(() => {
    if (!embed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") window.parent.postMessage({ type: "tempo:close" }, "*"); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [embed]);

  // A normal submit handler (not a form action): React clears a form after an action, and a visitor who
  // mistyped a phone number must not lose the message they wrote.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = await sendInquiry({
        slug: org.slug,
        serviceId: serviceId || null,
        name: String(fd.get("name") || ""),
        email: String(fd.get("email") || ""),
        phone: String(fd.get("phone") || ""),
        message: String(fd.get("message") || ""),
        website: String(fd.get("website") || ""),
        openedMs: Date.now() - openedAt,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSent(true);
      if (embed) window.parent.postMessage({ type: "tempo:inquiry" }, "*");
    });
  }

  return (
    <div
      className={cn("relative", embed ? "p-0" : "min-h-dvh px-4 py-8 sm:py-14")}
      style={{ ["--accent" as string]: accent, ["--accent-soft" as string]: `${accent}1a` }}
    >
      {!embed && (
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] opacity-60 blur-3xl"
          style={{ background: `radial-gradient(40% 60% at 20% 20%, ${accent}33, transparent), radial-gradient(35% 50% at 80% 10%, ${accent}22, transparent)` }} />
      )}
      <main className={cn("mx-auto w-full bg-surface p-5 sm:p-7", embed ? "max-w-none rounded-[20px]" : "max-w-xl rounded-[24px] shadow-md hairline")}>
        <div className="flex items-center gap-3">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt="" className="size-12 rounded-[14px] object-cover" />
          ) : (
            <div className="grid size-12 place-items-center rounded-[14px] text-[20px] font-bold text-white shadow-sm" style={{ background: `linear-gradient(180deg, ${accent}bb, ${accent})` }}>
              {org.name[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-bold leading-tight">{org.name}</h1>
            <p className="text-[13px] text-label-2">Send us a message</p>
          </div>
        </div>

        {!org.inquiries_enabled ? (
          <div className="mt-6">
            <Notice tone="blue">
              This business isn&apos;t taking messages through its website right now.{org.phone ? ` You can call ${org.phone}.` : ""}
            </Notice>
          </div>
        ) : sent ? (
          <div className="animate-rise py-10 text-center" role="status">
            <CheckCircle2 className="mx-auto size-12" style={{ color: accent }} strokeWidth={1.75} />
            <h2 className="mt-4 text-[22px] font-bold">Message sent</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-[15px] leading-relaxed text-label-2">
              Thank you. {org.name} will get back to you by email{org.phone ? ` or phone` : ""} as soon as they can.
            </p>
            <button type="button" onClick={() => setSent(false)} className="mt-5 text-[15px] font-medium text-accent">Send another message</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {org.description && <p className="text-[14px] leading-relaxed text-label-2 sm:col-span-2">{org.description}</p>}
            <Field label="Full name"><Input name="name" autoComplete="name" required maxLength={120} /></Field>
            <Field label="Email"><Input name="email" type="email" autoComplete="email" required maxLength={254} /></Field>
            <Field label="Phone (optional)"><Input name="phone" type="tel" autoComplete="tel" maxLength={40} /></Field>
            {services.length > 0 && (
              <Field label="Service you're interested in">
                <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  <option value="">Not sure yet</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Your message" className="sm:col-span-2">
              <Textarea name="message" required minLength={2} maxLength={2000} className="min-h-32" placeholder="How can we help?" />
            </Field>

            {/* Bots fill this in; people never see it. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>

            {error && <div className="sm:col-span-2"><Notice>{error}</Notice></div>}
            <div className="sm:col-span-2">
              <Button type="submit" pill size="lg" loading={pending} className="w-full sm:w-auto">Send message</Button>
              <p className="mt-3 text-[12px] leading-relaxed text-label-3">
                By sending this message you agree that {org.name} may contact you about it. We use your details only to answer you.{" "}
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>
              </p>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
