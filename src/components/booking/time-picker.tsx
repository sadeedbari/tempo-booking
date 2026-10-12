"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { addDaysToKey, formatTime, startOfDayInZone, timeZoneLabel, todayKey, weekdayOfKey } from "@/lib/format";
import { addMonthsToKey, monthStartKey, periodDays } from "@/lib/schedule";
import { slotsForDay, type Slot } from "@/lib/slots";
import type { AvailabilityRule, BusyInterval, PublicOrg, PublicService } from "@/lib/types";
import type { AvailabilityWindow, getWindow } from "@/app/[slug]/actions";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * Month calendar with the open times for the chosen day beside it (below on
 * phones). Shared by the booking flow and the customer reschedule page.
 */
export function TimePicker({
  org, availability, service, memberIds, locationId, fetchWindow, filterBusy, selected, onPick, reloadKey = 0,
}: {
  org: PublicOrg["org"];
  availability: AvailabilityRule[];
  service: PublicService;
  memberIds: string[];
  locationId: string | null;
  fetchWindow: typeof getWindow;
  /** Drop busy intervals that shouldn't count (e.g. the booking being rescheduled). */
  filterBusy?: (b: BusyInterval) => boolean;
  selected?: Slot | null;
  onPick: (slot: Slot) => void;
  /** Bump to refetch (e.g. after "that time was just taken"). */
  reloadKey?: number;
}) {
  const tz = org.timezone;
  const today = todayKey(tz);
  const [month, setMonth] = useState(monthStartKey(today));
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [hour12, setHour12] = useState(true);
  const [cache, setCache] = useState<Record<string, AvailabilityWindow>>({});

  const key = `${month}:${reloadKey}`;
  const win = cache[key] ?? null;

  useEffect(() => {
    if (cache[key]) return;
    let live = true;
    const next = addMonthsToKey(month, 1);
    fetchWindow(org.id, startOfDayInZone(month, tz).toISOString(), startOfDayInZone(next, tz).toISOString(), month, addDaysToKey(next, -1)).then(
      (w) => live && setCache((c) => ({ ...c, [key]: w })),
    );
    return () => {
      live = false;
    };
  }, [key, month, org.id, tz, cache, fetchWindow]);

  const opts = useMemo(
    () =>
      win && {
        timeZone: tz,
        durationMinutes: service.duration_minutes,
        bufferAfterMinutes: service.buffer_after_minutes,
        intervalMinutes: org.slot_interval_minutes,
        minNoticeMinutes: org.min_notice_minutes,
        maxAdvanceDays: org.max_advance_days,
        memberIds,
        rules: availability,
        shifts: org.schedule_mode === "shifts" ? win.shifts : undefined,
        locationId,
        busy: filterBusy ? win.busy.filter(filterBusy) : win.busy,
      },
    [win, tz, service, org, memberIds, availability, locationId, filterBusy],
  );

  const days = useMemo(() => periodDays("month", month), [month]);
  const open = useMemo(() => {
    const m: Record<string, boolean> = {};
    if (opts) days.forEach((d) => (m[d] = d >= today && slotsForDay(d, opts).length > 0));
    return m;
  }, [days, opts, today]);

  const day = pickedDay && days.includes(pickedDay) && open[pickedDay] ? pickedDay : days.find((d) => open[d]) ?? null;
  const slots = useMemo(() => (opts && day ? slotsForDay(day, opts) : []), [opts, day]);

  const lastBookable = addDaysToKey(today, org.max_advance_days);
  const canGoBack = month > monthStartKey(today);
  const canGoForward = addMonthsToKey(month, 1) <= lastBookable;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T12:00:00Z`));
  const dayLabel = day
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))
    : null;
  const anyOpen = Object.values(open).some(Boolean);

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[17px] font-semibold">
            {monthLabel.split(" ")[0]} <span className="font-normal text-label-2">{monthLabel.split(" ")[1]}</span>
          </h3>
          <div className="flex gap-1">
            <button disabled={!canGoBack} onClick={() => { setMonth(addMonthsToKey(month, -1)); setPickedDay(null); }} className="grid size-10 place-items-center rounded-full text-accent transition hover:bg-accent-soft disabled:text-label-4 disabled:hover:bg-transparent" aria-label="Previous month">
              <ChevronLeft className="size-5" />
            </button>
            <button disabled={!canGoForward} onClick={() => { setMonth(addMonthsToKey(month, 1)); setPickedDay(null); }} className="grid size-10 place-items-center rounded-full text-accent transition hover:bg-accent-soft disabled:text-label-4 disabled:hover:bg-transparent" aria-label="Next month">
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-[11px] font-semibold tracking-wide text-label-3">{w}</div>
          ))}
          {Array.from({ length: weekdayOfKey(month) }, (_, i) => <div key={`pad${i}`} />)}
          {days.map((d) => {
            const isOpen = open[d];
            const sel = d === day;
            return (
              <button
                key={d}
                type="button"
                disabled={!win || !isOpen}
                onClick={() => setPickedDay(d)}
                aria-label={d}
                className={cn(
                  "relative grid aspect-square place-items-center rounded-[12px] text-[15px] font-semibold transition",
                  sel ? "bg-accent text-white shadow-md" : isOpen ? "bg-surface-2 hover:bg-accent-soft hover:text-accent" : "text-label-3",
                )}
              >
                {Number(d.slice(8))}
                {d === today && <span className={cn("absolute bottom-1.5 size-1 rounded-full", sel ? "bg-white" : "bg-accent")} />}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-label-3">Times shown in {tz.replace(/_/g, " ")} ({timeZoneLabel(tz)}).</p>
      </div>

      <div className="min-h-40">
        {!win ? (
          <div className="flex justify-center py-16 text-label-3"><Spinner className="size-6" /></div>
        ) : !anyOpen ? (
          <div className="py-8 text-center">
            <p className="text-[14px] text-label-2">No times available in {monthLabel.split(" ")[0]}.</p>
            {canGoForward && (
              <Button variant="tinted" pill className="mt-3" onClick={() => { setMonth(addMonthsToKey(month, 1)); setPickedDay(null); }}>
                Check next month
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[16px] font-semibold">{dayLabel}</div>
              <div className="inline-flex rounded-[9px] bg-surface-2 p-0.5 text-[12px] font-semibold">
                {[true, false].map((h) => (
                  <button key={String(h)} type="button" onClick={() => setHour12(h)} className={cn("h-9 rounded-[7px] px-3 sm:h-7 sm:px-2.5 transition", hour12 === h ? "bg-surface shadow-sm" : "text-label-3")}>
                    {h ? "12h" : "24h"}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 md:max-h-[420px] md:grid-cols-1 md:overflow-y-auto md:pr-1">
              {slots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => onPick(s)}
                  className={cn(
                    "h-11 rounded-[12px] text-[15px] font-semibold transition active:scale-95",
                    selected?.start === s.start ? "bg-accent text-white" : "bg-accent-soft text-accent hover:bg-accent hover:text-white",
                  )}
                >
                  {formatTime(s.start, tz, hour12)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
