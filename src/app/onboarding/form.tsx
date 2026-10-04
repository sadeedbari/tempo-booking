"use client";
import { useActionState, useState, useSyncExternalStore } from "react";
import { CalendarClock, Video } from "lucide-react";
import { Input, Field, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { slugify, cn } from "@/lib/utils";
import { allTimeZones } from "@/lib/timezones";
import { createTeam, type OnboardingState } from "./actions";

const noop = () => () => {};

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState<OnboardingState, FormData>(createTeam, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [kind, setKind] = useState<"appointment" | "meeting">("appointment");
  const detectedTz = useSyncExternalStore(noop, () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto", () => "America/Toronto");
  const origin = useSyncExternalStore(noop, () => window.location.host, () => "tempo.app");
  const [tzChoice, setTz] = useState<string | null>(null);
  const tz = tzChoice ?? detectedTz;

  return (
    <form action={action} className="space-y-6">
      <div className="space-y-4 rounded-[22px] bg-surface p-6 shadow-sm hairline">
        <Field label="Team or business name">
          <Input
            name="name"
            placeholder="Lumen Studio"
            required
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Booking link" hint="Customers will book you here.">
          <div className="flex h-11 items-center overflow-hidden rounded-[11px] bg-surface-2 focus-within:shadow-[var(--ring)]">
            <span className="pl-3.5 text-[15px] text-label-3">{origin}/</span>
            <input
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              className="h-full flex-1 bg-transparent pr-3.5 text-[15px] outline-none"
              placeholder="lumen-studio"
              required
            />
          </div>
        </Field>
        <Field label="Your name, as customers see it">
          <Input name="display_name" defaultValue={defaultName} placeholder="Jane Appleseed" />
        </Field>
        <Field label="Time zone">
          <Select name="timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
            {allTimeZones().map((z) => (
              <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-label-2">What will people book?</p>
        <input type="hidden" name="kind" value={kind} />
        <div className="grid grid-cols-2 gap-3">
          {([
            { v: "appointment", icon: CalendarClock, t: "Appointments", d: "Salons, clinics, studios — services with staff." },
            { v: "meeting", icon: Video, t: "Meetings", d: "Calls and consultations — share a link." },
          ] as const).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setKind(o.v)}
              className={cn(
                "rounded-[18px] bg-surface p-4 text-left shadow-sm transition-all duration-200",
                kind === o.v ? "ring-2 ring-accent" : "hairline hover:bg-surface-2",
              )}
            >
              <o.icon className={cn("size-6", kind === o.v ? "text-accent" : "text-label-3")} />
              <div className="mt-3 text-[15px] font-semibold">{o.t}</div>
              <div className="mt-0.5 text-[13px] leading-snug text-label-2">{o.d}</div>
            </button>
          ))}
        </div>
        <p className="px-1 text-[13px] text-label-3">We&apos;ll add a few starter services you can edit.</p>
      </div>

      {state?.error && <Notice>{state.error}</Notice>}
      <SubmitButton size="lg" pill className="w-full">Create team</SubmitButton>
    </form>
  );
}
