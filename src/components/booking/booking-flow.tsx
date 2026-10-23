"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Calendar, Check, ChevronRight, Clock, Globe, MapPin, Phone, Repeat, Video, Users, X,
} from "lucide-react";
import { Avatar, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { LogoMark } from "@/components/app/logo";
import { cn } from "@/lib/utils";
import { formatDate, formatDuration, formatMoney, formatTime, timeZoneLabel } from "@/lib/format";
import { eligibleMembers, type Slot } from "@/lib/slots";
import type { PublicOrg, PublicService, PublicSession } from "@/lib/types";
import { book, getSessions, getWindow, joinWaitlist, previewSeries, type SeriesPreview } from "@/app/[slug]/actions";
import { TimePicker } from "./time-picker";
import { SessionPicker } from "./session-picker";
import { collectAnswers, IntakeFields } from "./intake-fields";
import { AddressInput } from "@/components/ui/address-input";
import { useSafeTransition } from "@/components/ui/use-server-action";
import { readableOn } from "@/lib/color";

type Step = "location" | "service" | "staff" | "time" | "details";
const LOC = { in_person: { icon: MapPin, label: "In person" }, video: { icon: Video, label: "Video call" }, phone: { icon: Phone, label: "Phone call" } };

export function BookingFlow({
  data,
  initialService,
  paymentCancelled,
  embed = false,
  fetchWindow = getWindow,
  fetchSessions = getSessions,
}: {
  data: PublicOrg;
  initialService?: string;
  paymentCancelled?: boolean;
  /** Rendered inside the website pop-up: compact, no page chrome. */
  embed?: boolean;
  /** Override for previews/tests. */
  fetchWindow?: typeof getWindow;
  fetchSessions?: typeof getSessions;
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
  // A class is booked by session, and the session decides who leads it, so it skips the "who" step too.
  const stepAfterService = (s: PublicService) => (!s.is_class && eligibleFor(s).length > 1 ? "staff" : "time");

  const preselected = services.find((s) => s.slug === initialService) ?? null;
  const [service, setService] = useState<PublicService | null>(preselected);
  const [memberId, setMemberId] = useState<string | null>(() => {
    const el = eligibleFor(preselected);
    return preselected && el.length === 1 ? el[0] : null;
  }); // null = any
  const [step, setStep] = useState<Step>(multiLocation ? "location" : preselected ? stepAfterService(preselected) : "service");
  const [reload, setReload] = useState(0);
  const [slot, setSlot] = useState<Slot | null>(null);
  // The chosen class session (a class is booked by session, not by free time).
  const [session, setSession] = useState<PublicSession | null>(null);
  // For a class: how many spots this booking takes (a friend, a partner).
  const [spots, setSpots] = useState(1);
  // The session was full and the customer is joining its waitlist instead of booking.
  const [waitlist, setWaitlist] = useState(false);
  const spotsLeft = session ? Math.max(0, session.capacity - session.booked) : 0;
  const maxSpots = session ? Math.min(6, waitlist ? session.capacity : spotsLeft) : 1;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useSafeTransition(setError, { requireSession: false }); // a failed request becomes an inline message, not the crash page
  // Repeating appointment: 0 = it doesn't repeat; otherwise every N weeks, this many times.
  const [repeatWeeks, setRepeatWeeks] = useState(0);
  const [repeatCount, setRepeatCount] = useState(4);
  const [preview, setPreview] = useState<SeriesPreview | "loading" | null>(null);
  const previewSeq = useRef(0);

  // Repeating is offered only for services that are confirmed automatically and have no online deposit.
  const canRepeat = !!service && !service.is_class && service.allow_series && service.auto_approve && !(service.deposit_cents > 0 && org.payments_enabled);
  const eligible = useMemo(() => eligibleFor(service), [service, allStaffIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const eligibleStaff = staff.filter((s) => eligible.includes(s.id));

  function chooseLocation(id: string) {
    const l = locations.find((x) => x.id === id)!;
    const staffHere = eligibleMembers(l.staff_ids, allStaffIds);
    const el = service ? eligibleMembers(service.staff_ids, staffHere) : staffHere;
    setLocationId(id);
    setSlot(null);
    setSession(null);
    setMemberId(service && el.length === 1 ? el[0] : null);
    setStep(service ? (!service.is_class && el.length > 1 ? "staff" : "time") : "service");
  }

  /** Changes how the appointment repeats and checks, with the real booking rules, which dates are free. */
  function chooseRepeat(weeks: number, count: number) {
    setRepeatWeeks(weeks);
    setRepeatCount(count);
    const seq = ++previewSeq.current;
    if (!weeks || !service || !slot) { setPreview(null); return; }
    setPreview("loading");
    previewSeries({
      orgId: org.id,
      serviceId: service.id,
      memberId: memberId ?? (slot.memberIds.length === 1 ? slot.memberIds[0] : null),
      locationId,
      startsAt: slot.start,
      series: { intervalWeeks: weeks, count },
    }).then((r) => { if (seq === previewSeq.current) setPreview(r); });
  }

  function chooseService(s: PublicService) {
    const el = eligibleFor(s);
    setService(s);
    setSlot(null);
    setSession(null);
    setWaitlist(false);
    setMemberId(el.length === 1 ? el[0] : null);
    setStep(stepAfterService(s));
  }

  const back = () => {
    setError(null);
    if (step === "details") setStep("time");
    else if (step === "time") setStep(!service?.is_class && eligibleStaff.length > 1 ? "staff" : "service");
    else if (step === "staff") setStep("service");
    else if (step === "service" && multiLocation) setStep("location");
  };
  const n = multiLocation ? 1 : 0; // step numbering offset

  function submit(fd: FormData) {
    if (!service || !slot) return;
    setError(null);
    if (waitlist && session) {
      start(async () => {
        const r = await joinWaitlist({
          orgId: org.id,
          slug: org.slug,
          sessionId: session.id,
          name: String(fd.get("name") || ""),
          email: String(fd.get("email") || ""),
          phone: String(fd.get("phone") || ""),
          spots,
          guests: spots > 1 ? String(fd.get("guests") || "") : undefined,
          notes: String(fd.get("notes") || ""),
          answers: collectAnswers(service.questions ?? [], fd),
        });
        if (!r.ok) {
          setError(r.error);
          if (/room in this session now/i.test(r.error)) {
            setSlot(null);
            setSession(null);
            setWaitlist(false);
            setStep("time");
            setReload((n) => n + 1);
          }
          return;
        }
        router.push(`/waitlist/${r.token}?new=1${embed ? "&embed=1" : ""}`);
      });
      return;
    }
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
        address: String(fd.get("address") || ""),
        unit: String(fd.get("unit") || ""),
        addressPlace: fd.get("address_place_id")
          ? { placeId: String(fd.get("address_place_id")), lat: fd.get("address_lat") ? Number(fd.get("address_lat")) : null, lng: fd.get("address_lng") ? Number(fd.get("address_lng")) : null }
          : undefined,
        smsConsent: fd.get("sms_consent") === "on",
        series: repeatWeeks ? { intervalWeeks: repeatWeeks, count: repeatCount } : undefined,
        sessionId: service.is_class ? session?.id : undefined,
        spots: service.is_class ? spots : undefined,
        guests: service.is_class && spots > 1 ? String(fd.get("guests") || "") : undefined,
        answers: collectAnswers(service.questions ?? [], fd),
        notes: String(fd.get("notes") || ""),
      });
      if (!r.ok) {
        setError(r.error);
        if (r.error.includes("taken") || (service.is_class && /full|no longer|started|cancelled/i.test(r.error))) {
          setSlot(null);
          setSession(null);
          setStep("time");
          setReload((n) => n + 1);
        }
        return;
      }
      if (embed) window.parent.postMessage({ type: "tempo:booked", token: r.token }, "*");
      if (r.checkoutUrl) {
        if (embed) window.parent.postMessage({ type: "tempo:redirect", url: r.checkoutUrl }, "*");
        else window.location.href = r.checkoutUrl;
      } else router.push(`/booking/${r.token}?new=1${r.series?.skipped.length ? `&skipped=${r.series.skipped.length}` : ""}${embed ? "&embed=1" : ""}`);
    });
  }

  const chosenStaff = memberId ? staff.find((s) => s.id === memberId) : null;
  const assignedStaff = slot && !memberId && slot.memberIds.length === 1 ? staff.find((s) => s.id === slot.memberIds[0]) : null;

  return (
    <div className={cn("relative", embed ? "h-dvh overflow-y-auto bg-surface" : "min-h-dvh")} style={{ ["--accent" as string]: accent, ["--accent-soft" as string]: `${accent}1a` }}>
      {!embed && (
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] opacity-60 blur-3xl"
          style={{ background: `radial-gradient(40% 60% at 20% 20%, ${accent}33, transparent), radial-gradient(35% 50% at 80% 10%, ${accent}22, transparent)` }} />
      )}

      <div className={cn("grid grid-cols-1", embed ? "min-h-full lg:grid-cols-[300px_1fr]" : "mx-auto max-w-5xl gap-6 px-4 py-8 sm:py-14 lg:grid-cols-[340px_1fr]")}>
        {/* Summary panel */}
        <aside className={cn(embed ? "border-b border-separator p-6 lg:border-b-0 lg:border-r" : "h-fit rounded-[24px] glass-strong hairline p-6 shadow-md lg:sticky lg:top-8")}>
          <div className="flex items-center gap-3">
            {org.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="size-14 rounded-[16px] object-cover" />
            ) : (
              <div className="grid size-14 place-items-center rounded-[16px] text-[24px] font-bold shadow-sm" style={{ background: `linear-gradient(180deg, ${accent}bb, ${accent})`, color: readableOn(accent) }}>
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
                  <div className="text-[13px] text-label-2">
                    {formatMoney(service.price_cents * (service.is_class ? spots : 1), org.currency)}{service.is_class && spots > 1 ? ` for ${spots} spots` : ""}
                    {service.deposit_cents > 0 && org.payments_enabled ? ` · ${formatMoney(service.deposit_cents * (service.is_class ? spots : 1), org.currency)} deposit` : ""}
                  </div>
                </div>
              </div>
              {service.description && <p className="line-clamp-4 whitespace-pre-line text-[14px] leading-relaxed text-label-2 lg:line-clamp-none">{service.description}</p>}
              <SummaryRow icon={Clock}>{formatDuration(service.duration_minutes)}</SummaryRow>
              {(() => { const L = LOC[service.location_type]; return <SummaryRow icon={L.icon}>{L.label}</SummaryRow>; })()}
              {(chosenStaff || assignedStaff) && <SummaryRow icon={Users}>{(chosenStaff || assignedStaff)!.display_name}</SummaryRow>}
              {!service.is_class && !chosenStaff && !assignedStaff && step !== "service" && eligibleStaff.length > 1 && <SummaryRow icon={Users}>Any available</SummaryRow>}
              {slot && (
                <SummaryRow icon={Calendar}>
                  <span className="font-medium text-label">{formatDate(slot.start, tz)}</span>
                  <br />
                  {formatTime(slot.start, tz)} – {formatTime(session ? session.ends_at : new Date(new Date(slot.start).getTime() + service.duration_minutes * 60000), tz)}
                </SummaryRow>
              )}
              <SummaryRow icon={Globe}>{tz.replace(/_/g, " ")} ({timeZoneLabel(tz)})</SummaryRow>
              </>)}
            </div>
          )}
        </aside>

        {/* Steps */}
        <main className={cn("min-w-0", embed ? "p-5 sm:p-7" : "rounded-[24px] bg-surface p-5 shadow-md hairline sm:p-7")}>
          {(step !== "service" || multiLocation) && step !== "location" && (
            <button onClick={back} className="mb-3 -ml-1 inline-flex min-h-10 items-center gap-1 text-[15px] font-medium text-accent-text">
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
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text"><MapPin className="size-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[16px] font-semibold">{l.name}</div>
                      {l.address && <div className="mt-0.5 text-[14px] text-label-2">{l.address}</div>}
                    </div>
                    <ChevronRight className="size-5 text-label-4 transition group-hover:translate-x-0.5 group-hover:text-label-2" />
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
                          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[13px] text-label-2">
                            <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{formatDuration(s.duration_minutes)}</span>
                            <span className="inline-flex items-center gap-1"><L.icon className="size-3.5" />{L.label}</span>
                            {s.is_class && <span className="inline-flex items-center gap-1"><Users className="size-3.5" />Group class</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[15px] font-semibold">{formatMoney(s.price_cents, org.currency)}</div>
                        </div>
                        <ChevronRight className="size-5 text-label-4 transition group-hover:translate-x-0.5 group-hover:text-label-2" />
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StaffCard name="Any available" subtitle="Earliest availability" onClick={() => { setMemberId(null); setStep("time"); }} any accent={accent} />
                {eligibleStaff.map((m) => (
                  <StaffCard key={m.id} name={m.display_name} subtitle={m.title ?? undefined} color={m.color} avatar={m.avatar_url} onClick={() => { setMemberId(m.id); setStep("time"); }} />
                ))}
              </div>
            </div>
          )}

          {step === "time" && service && (
            <div key="time" className="animate-rise">
              <StepTitle n={(!service.is_class && eligibleStaff.length > 1 ? 3 : 2) + n} title={service.is_class ? "Choose a session" : "Pick a time"} />
              {error && <div className="mb-4"><Notice>{error}</Notice></div>}
              {service.is_class ? (
                <SessionPicker
                  data={data}
                  service={service}
                  locationId={locationId}
                  fetchSessions={fetchSessions}
                  selectedId={session?.id}
                  reloadKey={reload}
                  onPick={(s, onWaitlist) => {
                    setSession(s);
                    setWaitlist(onWaitlist);
                    setSpots(1);
                    setSlot({ start: s.starts_at, memberIds: [s.member_id] });
                    setError(null);
                    setStep("details");
                  }}
                />
              ) : (
              <TimePicker
                org={org}
                availability={availability}
                service={service}
                memberIds={memberId ? [memberId] : eligible}
                locationId={locationId}
                fetchWindow={fetchWindow}
                selected={slot}
                reloadKey={reload}
                onPick={(s) => {
                  setSlot(s);
                  setError(null);
                  setRepeatWeeks(0);
                  setPreview(null);
                  previewSeq.current++;
                  setStep("details");
                }}
              />
              )}
            </div>
          )}

          {step === "details" && service && slot && (
            <div key="details" className="animate-rise">
              <StepTitle n={(!service.is_class && eligibleStaff.length > 1 ? 4 : 3) + n} title="Your details" />
              {/* A submit handler, not a form action: React empties a form after an action, and a customer who has to fix one answer must not lose everything else they typed. */}
              <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Full name" className="sm:col-span-2"><Input name="name" autoComplete="name" required autoFocus /></Field>
                  <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
                  <Field label="Phone" hint="Optional.">
                    <Input name="phone" type="tel" autoComplete="tel" />
                  </Field>
                  {/* Always shown and never ticked for the customer: text messages need their own, clearly worded yes. */}
                  <div className="sm:col-span-2" data-testid="sms-consent">
                    <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-label-2">
                      <input type="checkbox" name="sms_consent" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                      <span>
                        Text me about this booking. I agree to receive text messages from {org.name}: confirmations, reminders and changes. Message frequency varies.
                        Message and data rates may apply. Reply STOP to opt out or HELP for help. Agreeing is not required to book.
                      </span>
                    </label>
                    <p className="mt-1 pl-[26px] text-[12px] text-label-3">
                      <a href="/sms" target="_blank" rel="noopener noreferrer" className="text-accent-text underline">Text message terms</a>{" · "}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent-text underline">Privacy policy</a>
                    </p>
                  </div>
                  {service.address_mode !== "off" && (
                    <Field
                      label={service.address_mode === "required" ? "Address" : "Address (optional)"}
                      hint="Where should we come?"
                      className="sm:col-span-2"
                    >
                      <AddressInput name="address" currency={org.currency} required={service.address_mode === "required"} strict={service.address_mode === "required"} placeholder="Start typing your address" />
                    </Field>
                  )}
                  {service.address_mode !== "off" && (
                    <Field label="Unit, apartment or suite (optional)" className="sm:col-span-2">
                      <Input name="unit" autoComplete="address-line2" maxLength={30} placeholder="e.g. Apt 4B" />
                    </Field>
                  )}
                  {service.is_class && waitlist && (
                    <div className="sm:col-span-2" data-testid="waitlist-note">
                      <Notice tone="blue">This session is full. Join the waitlist and you&apos;ll be booked in automatically, with an email, if a spot opens up. It costs nothing to wait.</Notice>
                    </div>
                  )}
                  {service.is_class && session && maxSpots > 1 && (
                    <div className="space-y-3 rounded-[14px] bg-surface-2 p-4 sm:col-span-2" data-testid="spots-options">
                      <Field label="How many spots?" hint={waitlist ? "We'll book you in when there's room for everyone." : `${spotsLeft} left in this session.`}>
                        <Select aria-label="How many spots" value={spots} onChange={(e) => setSpots(Number(e.target.value))} className="bg-surface">
                          {Array.from({ length: maxSpots }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "Just me" : `${n} spots`}</option>)}
                        </Select>
                      </Field>
                      {spots > 1 && (
                        <Field label="Who's coming with you?" hint="Optional. Names help the team greet everyone.">
                          <Input name="guests" maxLength={300} placeholder="e.g. Sam and Alex" />
                        </Field>
                      )}
                    </div>
                  )}
                  {canRepeat && (
                    <div className="space-y-3 rounded-[14px] bg-surface-2 p-4 sm:col-span-2" data-testid="repeat-options">
                      <div className="flex items-center gap-2 text-[14px] font-medium"><Repeat className="size-4" /> Repeat this appointment</div>
                      <div className="grid grid-cols-2 gap-3">
                        <Select aria-label="How often" value={repeatWeeks} onChange={(e) => chooseRepeat(Number(e.target.value), repeatCount)} className="bg-surface">
                          <option value={0}>Doesn&apos;t repeat</option>
                          <option value={1}>Every week</option>
                          <option value={2}>Every 2 weeks</option>
                          <option value={3}>Every 3 weeks</option>
                          <option value={4}>Every 4 weeks</option>
                        </Select>
                        <Select aria-label="How many appointments" value={repeatCount} disabled={!repeatWeeks} onChange={(e) => chooseRepeat(repeatWeeks, Number(e.target.value))} className="bg-surface">
                          {Array.from({ length: 25 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} appointments</option>)}
                        </Select>
                      </div>
                      {repeatWeeks > 0 && preview === "loading" && <p className="text-[13px] text-label-2" role="status">Checking the dates…</p>}
                      {repeatWeeks > 0 && preview && preview !== "loading" && (
                        preview.ok ? (
                          <div className="space-y-2" role="status">
                            <ul className="space-y-1" aria-label="Dates">
                              {preview.dates.map((d) => (
                                <li key={d.startsAt} className={cn("flex items-start gap-2 text-[14px]", !d.available && "text-label-2")}>
                                  {d.available ? <Check className="mt-0.5 size-4 shrink-0 text-green" /> : <X className="mt-0.5 size-4 shrink-0 text-red" />}
                                  <span>
                                    {formatDate(d.startsAt, tz)} at {formatTime(d.startsAt, tz)}
                                    {!d.available && <span className="block text-[12px]">Not available, so it will be skipped.</span>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {preview.dates.some((d) => !d.available) && (
                              <p className="text-[12px] text-label-2">{preview.dates.filter((d) => d.available).length} of {preview.dates.length} dates are available. The others are skipped, and you can book those separately.</p>
                            )}
                          </div>
                        ) : (
                          <Notice>{preview.error}</Notice>
                        )
                      )}
                    </div>
                  )}
                  <IntakeFields questions={service.questions ?? []} />
                  <Field label="Anything we should know?" className="sm:col-span-2"><Textarea name="notes" className="min-h-20" /></Field>
                </div>
                {error && <Notice>{error}</Notice>}
                <Button type="submit" size="lg" pill className="w-full" loading={pending}>
                  {waitlist ? "Join the waitlist" : service.deposit_cents > 0 && org.payments_enabled
                    ? `Continue to pay ${formatMoney(service.deposit_cents * (service.is_class ? spots : 1), org.currency)} deposit`
                    : !service.auto_approve ? (service.is_class ? "Request a spot" : "Request booking") : service.is_class ? (spots > 1 ? `Reserve ${spots} spots` : "Reserve my spot") : repeatWeeks > 0 ? `Confirm ${preview && preview !== "loading" && preview.ok ? preview.dates.filter((d) => d.available).length : repeatCount} appointments` : "Confirm booking"}
                </Button>
                {!service.auto_approve && (
                  <p className="text-center text-[12px] text-label-2">
                    {org.name} confirms each booking personally. You&apos;ll get an email once it&apos;s approved
                    {service.deposit_cents > 0 && org.payments_enabled ? ", and your deposit is refunded if it isn't." : "."}
                  </p>
                )}
                <p className="text-center text-[12px] text-label-2">
                  {org.cancellation_window_hours > 0
                    ? `Free cancellation up to ${org.cancellation_window_hours} hours before.`
                    : "You can cancel any time before your appointment."}
                </p>
              </form>
            </div>
          )}
        </main>
      </div>

      <footer className={cn("text-center", embed ? "pb-4" : "pb-10")}>
        <Link href="/" className="inline-flex min-h-10 items-center gap-1.5 text-[12px] font-medium text-label-2 hover:text-label-2">
          <LogoMark className="size-4" /> Powered by Tempo
        </Link>
      </footer>
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-5">
      <div className="text-[13px] font-semibold text-accent-text">Step {n}</div>
      <h2 className="text-[24px] font-bold">{title}</h2>
    </div>
  );
}

function SummaryRow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-[14px] text-label-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-label-2" />
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
        <span className="grid size-12 place-items-center rounded-full" style={{ background: `linear-gradient(180deg, ${accent}bb, ${accent})`, color: readableOn(accent) }}>
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
