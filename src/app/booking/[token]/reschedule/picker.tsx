"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { addDaysToKey, formatDate, formatTime, startOfDayInZone, timeZoneLabel, todayKey, weekdayOfKey } from "@/lib/format";
import { eligibleMembers, slotsForDay, type Slot } from "@/lib/slots";
import type { PublicOrg, PublicService } from "@/lib/types";
import { getWindow, type AvailabilityWindow } from "@/app/[slug]/actions";
import { rescheduleBooking } from "../actions";

const WINDOW = 14;

export function ReschedulePicker({
  token, data, service, currentStart, currentMemberId, locationId,
}: {
  token: string; data: PublicOrg; service: PublicService; currentStart: string; currentMemberId: string | null; locationId: string | null;
}) {
  const router = useRouter();
  const { org, staff, availability } = data;
  const tz = org.timezone;
  const accent = org.accent_color || "#007AFF";
  const eligible = useMemo(() => {
    const all = staff.map((s) => s.id);
    const loc = data.locations.find((l) => l.id === locationId);
    return eligibleMembers(service.staff_ids, loc ? eligibleMembers(loc.staff_ids, all) : all);
  }, [service, staff, data.locations, locationId]);

  const [windowStart, setWindowStart] = useState(todayKey(tz));
  const [reload, setReload] = useState(0);
  const [cache, setCache] = useState<Record<string, AvailabilityWindow>>({});
  const [pickedDay, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const key = `${windowStart}:${reload}`;
  const raw = cache[key] ?? null;
  useEffect(() => {
    if (cache[key]) return;
    let live = true;
    getWindow(
      org.id,
      startOfDayInZone(windowStart, tz).toISOString(),
      startOfDayInZone(addDaysToKey(windowStart, WINDOW + 1), tz).toISOString(),
      windowStart,
      addDaysToKey(windowStart, WINDOW),
    ).then((w) => live && setCache((c) => ({ ...c, [key]: w })));
    return () => { live = false; };
  }, [key, windowStart, org.id, tz, cache]);

  // This booking's own block must not make its neighbouring times look taken.
  const busy = useMemo(
    () => raw?.busy.filter((b) => !(b.member_id === currentMemberId && new Date(b.starts_at).getTime() === new Date(currentStart).getTime())) ?? null,
    [raw, currentMemberId, currentStart],
  );

  const opts = useMemo(
    () => busy && {
      timeZone: tz, durationMinutes: service.duration_minutes, bufferAfterMinutes: service.buffer_after_minutes,
      intervalMinutes: org.slot_interval_minutes, minNoticeMinutes: org.min_notice_minutes, maxAdvanceDays: org.max_advance_days,
      memberIds: eligible, rules: availability, busy,
      shifts: org.schedule_mode === "shifts" ? raw?.shifts : undefined,
      locationId,
    },
    [busy, raw, tz, service, org, eligible, availability, locationId],
  );
  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDaysToKey(windowStart, i)), [windowStart]);
  const hasSlots = useMemo(() => {
    const m: Record<string, boolean> = {};
    if (opts) days.forEach((d) => (m[d] = slotsForDay(d, opts).length > 0));
    return m;
  }, [days, opts]);
  const day = pickedDay && days.includes(pickedDay) && hasSlots[pickedDay] ? pickedDay : days.find((d) => hasSlots[d]) ?? days[0];
  const slots = useMemo(() => (opts ? slotsForDay(day, opts) : []), [day, opts]);

  function confirm() {
    if (!slot) return;
    setError(null);
    start(async () => {
      const r = await rescheduleBooking(token, slot.start);
      if (r.error) {
        setError(r.error);
        if (r.error.includes("taken")) { setSlot(null); setReload((n) => n + 1); }
        return;
      }
      router.push(`/booking/${token}?moved=1`);
    });
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-12" style={{ ["--accent" as string]: accent, ["--accent-soft" as string]: `${accent}1a` }}>
      <div className="w-full max-w-md animate-pop">
        <Link href={`/booking/${token}`} className="mb-4 inline-flex items-center gap-1 text-[15px] font-medium text-accent"><ArrowLeft className="size-4" /> Back</Link>
        <h1 className="text-[28px] font-bold">Pick a new time</h1>
        <p className="mt-1 text-[15px] text-label-2">
          {service.name} · currently {formatDate(currentStart, tz)}, {formatTime(currentStart, tz)} {timeZoneLabel(tz)}
        </p>

        <div className="mt-6 rounded-[22px] bg-surface p-5 shadow-md hairline">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[17px] font-semibold">
              {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}
            </div>
            <div className="flex gap-1">
              <button disabled={windowStart <= todayKey(tz)} onClick={() => setWindowStart(addDaysToKey(windowStart, -WINDOW))} className="grid size-9 place-items-center rounded-full text-accent transition hover:bg-accent-soft disabled:text-label-4 disabled:hover:bg-transparent" aria-label="Earlier"><ChevronLeft className="size-5" /></button>
              <button onClick={() => setWindowStart(addDaysToKey(windowStart, WINDOW))} className="grid size-9 place-items-center rounded-full text-accent transition hover:bg-accent-soft" aria-label="Later"><ChevronRight className="size-5" /></button>
            </div>
          </div>
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
            {days.map((d) => {
              const has = hasSlots[d];
              const sel = d === day;
              return (
                <button key={d} disabled={!busy || !has} onClick={() => { setDay(d); setSlot(null); }}
                  className={cn("flex w-[52px] shrink-0 flex-col items-center rounded-[14px] py-2.5 transition", sel ? "bg-accent text-white shadow-md" : has ? "hover:bg-surface-2" : "opacity-35")}>
                  <span className={cn("text-[11px] font-semibold uppercase", sel ? "text-white/80" : "text-label-3")}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOfKey(d)]}</span>
                  <span className="mt-0.5 text-[19px] font-semibold">{Number(d.slice(8))}</span>
                  <span className={cn("mt-1 size-1 rounded-full", has ? (sel ? "bg-white" : "bg-accent") : "bg-transparent")} />
                </button>
              );
            })}
          </div>
          <div className="mt-4 min-h-40">
            {!busy ? (
              <div className="flex justify-center py-12 text-label-3"><Spinner className="size-6" /></div>
            ) : slots.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[15px] text-label-2">No times available in these two weeks.</p>
                <Button variant="tinted" pill className="mt-4" onClick={() => setWindowStart(addDaysToKey(windowStart, WINDOW))}>Check later dates</Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => (
                  <button key={s.start} onClick={() => setSlot(s)}
                    className={cn("h-11 rounded-[12px] text-[15px] font-semibold transition active:scale-95", slot?.start === s.start ? "bg-accent text-white" : "bg-accent-soft text-accent hover:bg-accent hover:text-white")}>
                    {formatTime(s.start, tz)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <div className="mt-4"><Notice>{error}</Notice></div>}
        <Button size="lg" pill className="mt-5 w-full" disabled={!slot} loading={pending} onClick={confirm}>
          {slot ? `Move to ${formatDate(slot.start, tz)} at ${formatTime(slot.start, tz)}` : "Choose a time"}
        </Button>
      </div>
    </div>
  );
}
