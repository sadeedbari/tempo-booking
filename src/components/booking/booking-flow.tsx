"use client";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Calendar, ChevronLeft, ChevronRight, Clock, Globe, MapPin, Phone, Video, Users,
} from "lucide-react";
import { Avatar, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { LogoMark } from "@/components/app/logo";
import { cn } from "@/lib/utils";
import {
  addDaysToKey, formatDate, formatDuration, formatMoney, formatTime, startOfDayInZone, timeZoneLabel, todayKey, weekdayOfKey,
} from "@/lib/format";
import { eligibleMembers, slotsForDay, type Slot } from "@/lib/slots";
import type { PublicOrg, PublicService } from "@/lib/types";
import { book, getWindow, type AvailabilityWindow } from "@/app/[slug]/actions";

type Step = "location" | "service" | "staff" | "time" | "details";
const LOC = { in_person: { icon: MapPin, label: "In person" }, video: { icon: Video, label: "Video call" }, phone: { icon: Phone, label: "Phone call" } };
const WINDOW = 14; // days of availability fetched at a time
const noop = () => () => {};

export function BookingFlow({
  data,
  initialService,
  paymentCancelled,
  fetchWindow = getWindow,
}: {
  data: PublicOrg;
  initialService?: string;
  paymentCancelled?: boolean;
  /** Override for previews/tests. */
  fetchWindow?: typeof getWindow;
}) {
  const router = useRouter();
  const { org, services, staff, availability, locations } = data;
  const multiLocation = locations.length > 1;
  const tz = org.timezone;
  const accent = org.accent_color || "#007AFF";
  const allStaffIds = staff.map((s) => s.id);

  const [locationId, setLocationId] = useState<string | null>(locations.length === 1 ? locations[0].id : null);
  const location = locations.find((l) => l.id === locationId) ?? null;
  const locationStaff = location ? eligibleMembers(location.staff_ids, allStaffIds) : allStaffIds;
  const eligibleFor = (s: PublicService | null) => (s ? eligibleMembers(s.staff_ids, locationStaff) : locationStaff);
  // When only one person can perform a service, skip the "who" step.
  const stepAfterService = (s: PublicService) => (eligibleFor(s).length > 1 ? "staff" : "time");

  const preselected = services.find((s) => s.slug === initialService) ?? null;
  const [service, setService] = useState<PublicService | null>(preselected);
  const [memberId, setMemberId] = useState<string | null>(() => {
    const el = eligibleFor(preselected);
    return preselected && el.length === 1 ? el[0] : null;
  }); // null = any
  const [step, setStep] = useState<Step>(multiLocation ? "location" : preselected ? stepAfterService(preselected) : "service");
  const [pickedDay, setDay] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<string>(todayKey(tz));
  const [reload, setReload] = useState(0);
  const [busyCache, setBusyCache] = useState<Record<string, AvailabilityWindow>>({});
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const viewerTz = useSyncExternalStore(noop, () => Intl.DateTimeFormat().resolvedOptions().timeZone || tz, () => tz);

  const eligible = useMemo(() => eligibleFor(service), [service, allStaffIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const eligibleStaff = staff.filter((s) => eligible.includes(s.id));

  function chooseLocation(id: string) {
    const l = locations.find((x) => x.id === id)!;
    const staffHere = eligibleMembers(l.staff_ids, allStaffIds);
    const el = service ? eligibleMembers(service.staff_ids, staffHere) : staffHere;
    setLocationId(id);
    setSlot(null);
    setDay(null);
    setBusyCache({});
    setMemberId(service && el.length === 1 ? el[0] : null);
    setStep(service ? (el.length > 1 ? "staff" : "time") : "service");
  }

  function chooseService(s: PublicService) {
    const el = eligibleFor(s);
    setService(s);
    setSlot(null);
    setDay(null);
    setMemberId(el.length === 1 ? el[0] : null);
    setStep(stepAfterService(s));
  }

  // Busy times are fetched per two-week window and cached.
  const cacheKey = `${windowStart}:${reload}`;
  const win = busyCache[cacheKey] ?? null;
  const busy = win?.busy ?? null;
  useEffect(() => {
    if (step !== "time" || busyCache[cacheKey]) return;
    let live = true;
    fetchWindow(
      org.id,
      startOfDayInZone(windowStart, tz).toISOString(),
      startOfDayInZone(addDaysToKey(windowStart, WINDOW + 1), tz).toISOString(),
      windowStart,
      addDaysToKey(windowStart, WINDOW),
    ).then((w) => live && setBusyCache((c) => ({ ...c, [cacheKey]: w })));
    return () => {
      live = false;
    };
  }, [step, cacheKey, windowStart, org.id, tz, busyCache, fetchWindow]);

  const slotOpts = useMemo(
    () =>
      service && busy
        ? {
            timeZone: tz,
            durationMinutes: service.duration_minutes,
            bufferAfterMinutes: service.buffer_after_minutes,
            intervalMinutes: org.slot_interval_minutes,
            minNoticeMinutes: org.min_notice_minutes,
            maxAdvanceDays: org.max_advance_days,
            memberIds: memberId ? [memberId] : eligible,
            rules: availability,
            shifts: org.schedule_mode === "shifts" ? win?.shifts : undefined,
            locationId,
            busy,
          }
        : null,
    [service, busy, win, tz, org, memberId, eligible, availability, locationId],
  );

  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDaysToKey(windowStart, i)), [windowStart]);
  const dayHasSlots = useMemo(() => {
    const m: Record<string, boolean> = {};
    if (slotOpts) days.forEach((d) => (m[d] = slotsForDay(d, slotOpts).length > 0));
    return m;
  }, [days, slotOpts]);
  // The chosen day, or the first day in view with availability.
  const day =
    pickedDay && days.includes(pickedDay) && dayHasSlots[pickedDay]
      ? pickedDay
      : days.find((d) => dayHasSlots[d]) ?? days[0];
  const slots = useMemo(() => (slotOpts ? slotsForDay(day, slotOpts) : []), [day, slotOpts]);

  const groups = useMemo(() => {
    const g: Record<"Morning" | "Afternoon" | "Evening", Slot[]> = { Morning: [], Afternoon: [], Evening: [] };
    slots.forEach((s) => {
      const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date(s.start)));
      (h < 12 ? g.Morning : h < 17 ? g.Afternoon : g.Evening).push(s);
    });
    return Object.entries(g).filter(([, v]) => v.length) as [string, Slot[]][];
  }, [slots, tz]);

  const back = () => {
    setError(null);
    if (step === "details") setStep("time");
    else if (step === "time") setStep(eligibleStaff.length > 1 ? "staff" : "service");
    else if (step === "staff") setStep("service");
    else if (step === "service" && multiLocation) setStep("location");
  };
  const n = multiLocation ? 1 : 0; // step numbering offset

  function submit(fd: FormData) {
    if (!service || !slot) return;
    setError(null);
    start(async () => {
      const r = await book({
        orgId: org.id,
        slug: org.slug,
        serviceId: service.id,
        memberId: memberId ?? (slot.memberIds.length === 1 ? slot.memberIds[0] : null),
        locationId,
        startsAt: slot.start,
        name: String(fd.get("name") || ""),
        email: String(fd.get("email") || ""),
        phone: String(fd.get("phone") || ""),
        notes: String(fd.get("notes") || ""),
      });
      if (!r.ok) {
        setError(r.error);
        if (r.error.includes("taken")) {
          setSlot(null);
          setStep("time");
          setReload((n) => n + 1);
        }
        return;
      }
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else router.push(`/booking/${r.token}?new=1`);
    });
  }

  const chosenStaff = memberId ? staff.find((s) => s.id === memberId) : null;
  const assignedStaff = slot && !memberId && slot.memberIds.length === 1 ? staff.find((s) => s.id === slot.memberIds[0]) : null;
  const showTzNote = viewerTz !== tz;

  return (
    <div className="relative min-h-dvh" style={{ ["--accent" as string]: accent, ["--accent-soft" as string]: `${accent}1a` }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] opacity-60 blur-3xl"
        style={{ background: `radial-gradient(40% 60% at 20% 20%, ${accent}33, transparent), radial-gradient(35% 50% at 80% 10%, ${accent}22, transparent)` }} />

      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:py-14 lg:grid-cols-[340px_1fr]">
        {/* Summary panel */}
        <aside className="h-fit rounded-[24px] glass-strong hairline p-6 shadow-md lg:sticky lg:top-8">
          <div className="flex items-center gap-3">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="size-14 rounded-[16px] object-cover" />
            ) : (
              <div className="grid size-14 place-items-center rounded-[16px] text-[24px] font-bold text-white shadow-sm" style={{ background: `linear-gradient(180deg, ${accent}bb, ${accent})` }}>
                {org.name[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-bold leading-tight">{org.name}</h1>
              {org.address && <p className="truncate text-[13px] text-label-2">{org.address}</p>}
            </div>
          </div>
          {org.description && <p className="mt-4 text-[14px] leading-relaxed text-label-2">{org.description}</p>}

          {(service || location) && (
            <div className="mt-6 space-y-3 border-t border-separator pt-5 animate-fade">
              {location && multiLocation && (
                <SummaryRow icon={MapPin}>
                  <span className="font-medium text-label">{location.name}</span>
                  {location.address && <><br />{location.address}</>}
                </SummaryRow>
              )}
              {service && (<>
              <div className="flex items-start gap-3">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: service.color }} />
                <div>
                  <div className="text-[16px] font-semibold">{service.name}</div>
                  <div className="text-[13px] text-label-2">{formatMoney(service.price_cents, org.currency)}{service.deposit_cents > 0 && org.payments_enabled ? ` · ${formatMoney(service.deposit_cents, org.currency)} deposit` : ""}</div>
                </div>
              </div>
              <SummaryRow icon={Clock}>{formatDuration(service.duration_minutes)}</SummaryRow>
              {(() => { const L = LOC[service.location_type]; return <SummaryRow icon={L.icon}>{L.label}</SummaryRow>; })()}
              {(chosenStaff || assignedStaff) && <SummaryRow icon={Users}>{(chosenStaff || assignedStaff)!.display_name}</SummaryRow>}
              {!chosenStaff && !assignedStaff && step !== "service" && eligibleStaff.length > 1 && <SummaryRow icon={Users}>Any available</SummaryRow>}
              {slot && (
                <SummaryRow icon={Calendar}>
                  <span className="font-medium text-label">{formatDate(slot.start, tz)}</span>
                  <br />
                  {formatTime(slot.start, tz)} – {formatTime(new Date(new Date(slot.start).getTime() + service.duration_minutes * 60000), tz)}
                </SummaryRow>
              )}
              <SummaryRow icon={Globe}>{tz.replace(/_/g, " ")} ({timeZoneLabel(tz)})</SummaryRow>
              </>)}
            </div>
          )}
        </aside>

        {/* Steps */}
        <main className="min-w-0 rounded-[24px] bg-surface p-5 shadow-md hairline sm:p-7">
          {(step !== "service" || multiLocation) && step !== "location" && (
            <button onClick={back} className="mb-4 -ml-1 inline-flex items-center gap-1 text-[15px] font-medium text-accent">
              <ArrowLeft className="size-4" /> Back
            </button>
          )}
          {paymentCancelled && step === "service" && <div className="mb-4"><Notice tone="blue">Payment was cancelled, so your booking wasn&apos;t completed. Pick a time to try again.</Notice></div>}

          {step === "location" && (
            <div key="location" className="animate-rise">
              <StepTitle n={1} title="Choose a location" />
              <div className="space-y-2.5">
                {locations.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => chooseLocation(l.id)}
                    className="group flex w-full items-center gap-4 rounded-[16px] bg-surface-2/60 p-4 text-left transition hover:bg-surface-2 active:scale-[0.99]"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><MapPin className="size-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16px] font-semibold">{l.name}</div>
                      {l.address && <div className="mt-0.5 text-[14px] text-label-2">{l.address}</div>}
                    </div>
                    <ChevronRight className="size-5 text-label-4 transition group-hover:translate-x-0.5 group-hover:text-label-3" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "service" && (
            <div key="service" className="animate-rise">
              <StepTitle n={1 + n} title="Choose a service" />
              {services.length === 0 ? (
                <p className="py-10 text-center text-label-2">No services are available to book right now.</p>
              ) : (
                <div className="space-y-2.5">
                  {services.map((s) => {
                    const L = LOC[s.location_type];
                    return (
                      <button
                        key={s.id}
                        onClick={() => chooseService(s)}
                        className="group flex w-full items-center gap-4 rounded-[16px] bg-surface-2/60 p-4 text-left transition hover:bg-surface-2 active:scale-[0.99]"
                      >
                        <span className="h-11 w-1 shrink-0 rounded-full" style={{ background: s.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[16px] font-semibold">{s.name}</div>
                          {s.description && <div className="mt-0.5 line-clamp-2 text-[14px] text-label-2">{s.description}</div>}
                          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[13px] text-label-3">
                            <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{formatDuration(s.duration_minutes)}</span>
                            <span className="inline-flex items-center gap-1"><L.icon className="size-3.5" />{L.label}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[15px] font-semibold">{formatMoney(s.price_cents, org.currency)}</div>
                        </div>
                        <ChevronRight className="size-5 text-label-4 transition group-hover:translate-x-0.5 group-hover:text-label-3" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === "staff" && eligibleStaff.length > 1 && (
            <div key="staff" className="animate-rise">
              <StepTitle n={2 + n} title="Who would you like?" />
              <div className="grid gap-3 sm:grid-cols-2">
                <StaffCard name="Any available" subtitle="Earliest availability" onClick={() => { setMemberId(null); setStep("time"); }} any accent={accent} />
                {eligibleStaff.map((m) => (
                  <StaffCard key={m.id} name={m.display_name} subtitle={m.title ?? undefined} color={m.color} avatar={m.avatar_url} onClick={() => { setMemberId(m.id); setStep("time"); }} />
                ))}
              </div>
            </div>
          )}

          {step === "time" && (
            <div key="time" className="animate-rise">
              <StepTitle n={(eligibleStaff.length > 1 ? 3 : 2) + n} title="Pick a time" />
              <div className="mb-4 flex items-center justify-between">
                <div className="text-[17px] font-semibold">
                  {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}
                </div>
                <div className="flex gap-1">
                  <button disabled={windowStart <= todayKey(tz)} onClick={() => setWindowStart(addDaysToKey(windowStart, -WINDOW))} className="grid size-9 place-items-center rounded-full text-accent transition hover:bg-accent-soft disabled:text-label-4 disabled:hover:bg-transparent" aria-label="Earlier">
                    <ChevronLeft className="size-5" />
                  </button>
                  <button onClick={() => setWindowStart(addDaysToKey(windowStart, WINDOW))} className="grid size-9 place-items-center rounded-full text-accent transition hover:bg-accent-soft" aria-label="Later">
                    <ChevronRight className="size-5" />
                  </button>
                </div>
              </div>

              <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
                {days.map((d) => {
                  const has = dayHasSlots[d];
                  const sel = d === day;
                  return (
                    <button
                      key={d}
                      disabled={!busy || !has}
                      onClick={() => { setDay(d); setSlot(null); }}
                      className={cn(
                        "flex w-[52px] shrink-0 flex-col items-center rounded-[14px] py-2.5 transition",
                        sel ? "bg-accent text-white shadow-md" : has ? "hover:bg-surface-2" : "opacity-35",
                      )}
                    >
                      <span className={cn("text-[11px] font-semibold uppercase", sel ? "text-white/80" : "text-label-3")}>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOfKey(d)]}
                      </span>
                      <span className="mt-0.5 text-[19px] font-semibold">{Number(d.slice(8))}</span>
                      <span className={cn("mt-1 size-1 rounded-full", has ? (sel ? "bg-white" : "bg-accent") : "bg-transparent")} />
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 min-h-48">
                {!busy ? (
                  <div className="flex justify-center py-16 text-label-3"><Spinner className="size-6" /></div>
                ) : slots.length === 0 ? (
                  <div className="py-14 text-center">
                    <p className="text-[15px] text-label-2">No times available in these two weeks.</p>
                    <Button variant="tinted" pill className="mt-4" onClick={() => setWindowStart(addDaysToKey(windowStart, WINDOW))}>Check later dates</Button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {groups.map(([label, list]) => (
                      <div key={label}>
                        <div className="mb-2 text-[13px] font-medium text-label-3">{label}</div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {list.map((s) => (
                            <button
                              key={s.start}
                              onClick={() => { setSlot(s); setStep("details"); }}
                              className={cn(
                                "h-11 rounded-[12px] text-[15px] font-semibold transition active:scale-95",
                                slot?.start === s.start ? "bg-accent text-white" : "bg-accent-soft text-accent hover:bg-accent hover:text-white",
                              )}
                            >
                              {formatTime(s.start, tz)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {showTzNote && busy && slots.length > 0 && (
                  <p className="mt-5 text-[12px] text-label-3">Times shown in {org.name}&apos;s time zone ({timeZoneLabel(tz)}).</p>
                )}
              </div>
            </div>
          )}

          {step === "details" && service && slot && (
            <div key="details" className="animate-rise">
              <StepTitle n={(eligibleStaff.length > 1 ? 4 : 3) + n} title="Your details" />
              <form action={submit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name" className="sm:col-span-2"><Input name="name" autoComplete="name" required autoFocus /></Field>
                  <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
                  <Field label="Phone" hint="For reminders by text."><Input name="phone" type="tel" autoComplete="tel" /></Field>
                  <Field label="Anything we should know?" className="sm:col-span-2"><Textarea name="notes" className="min-h-20" /></Field>
                </div>
                {error && <Notice>{error}</Notice>}
                <Button type="submit" size="lg" pill className="w-full" loading={pending}>
                  {service.deposit_cents > 0 && org.payments_enabled
                    ? `Continue to pay ${formatMoney(service.deposit_cents, org.currency)} deposit`
                    : "Confirm booking"}
                </Button>
                <p className="text-center text-[12px] text-label-3">
                  {org.cancellation_window_hours > 0
                    ? `Free cancellation up to ${org.cancellation_window_hours} hours before.`
                    : "You can cancel any time before your appointment."}
                </p>
              </form>
            </div>
          )}
        </main>
      </div>

      <footer className="pb-10 text-center">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-label-3 hover:text-label-2">
          <LogoMark className="size-4" /> Powered by Tempo
        </Link>
      </footer>
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-5">
      <div className="text-[13px] font-semibold text-accent">Step {n}</div>
      <h2 className="text-[24px] font-bold">{title}</h2>
    </div>
  );
}

function SummaryRow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-[14px] text-label-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-label-3" />
      <div>{children}</div>
    </div>
  );
}

function StaffCard({
  name, subtitle, color, avatar, onClick, any, accent,
}: {
  name: string; subtitle?: string; color?: string; avatar?: string | null; onClick: () => void; any?: boolean; accent?: string;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-3.5 rounded-[16px] bg-surface-2/60 p-4 text-left transition hover:bg-surface-2 active:scale-[0.98]">
      {any ? (
        <span className="grid size-12 place-items-center rounded-full text-white" style={{ background: `linear-gradient(180deg, ${accent}bb, ${accent})` }}>
          <Users className="size-5" />
        </span>
      ) : (
        <Avatar name={name} color={color} src={avatar} size={48} />
      )}
      <div className="min-w-0">
        <div className="truncate text-[16px] font-semibold">{name}</div>
        {subtitle && <div className="truncate text-[13px] text-label-2">{subtitle}</div>}
      </div>
    </button>
  );
}
