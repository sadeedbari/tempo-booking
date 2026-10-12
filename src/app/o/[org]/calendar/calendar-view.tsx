"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TZDate } from "@date-fns/tz";
import { ChevronLeft, ChevronRight, Plus, PartyPopper } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Avatar } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { addDaysToKey, dayKey, formatTime, startOfDayInZone, todayKey, weekdayOfKey } from "@/lib/format";
import type { AvailabilityRule, Booking, Customer, Location, Membership, Shift, Organization, Service, TimeOff } from "@/lib/types";
import { NewBookingSheet } from "@/components/app/new-booking-sheet";
import { BookingSheet } from "@/components/app/booking-sheet";

const HOUR = 64; // px per hour

interface Props {
  slug: string;
  org: Organization;
  view: "day" | "week";
  date: string;
  rangeStart: string;
  members: Membership[];
  meId: string;
  bookings: Booking[];
  services: Service[];
  rules: AvailabilityRule[];
  timeOff: TimeOff[];
  customers: Customer[];
  locations: Location[];
  /** Scheduled shifts for the visible range; only loaded when the business schedules by shifts. */
  shifts: Shift[];
  welcome?: boolean;
}

function minutesInDay(iso: string, tz: string) {
  const d = new TZDate(new Date(iso).getTime(), tz);
  return d.getHours() * 60 + d.getMinutes();
}
function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Assigns side-by-side lanes to overlapping events. */
function layout<T extends { start: number; end: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: (T & { lane: number; lanes: number })[] = [];
  let cluster: (T & { lane: number; lanes: number })[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => (c.lanes = lanes));
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

export function CalendarView(props: Props) {
  const router = useRouter();
  const [locationFilter, setLocationFilter] = useState<string>("all");
  // With a location chosen, only that location's bookings are shown.
  const p = useMemo(
    () => (locationFilter === "all" ? props : { ...props, bookings: props.bookings.filter((b) => b.location_id === locationFilter) }),
    [props, locationFilter],
  );
  const tz = p.org.timezone;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [newAt, setNewAt] = useState<{ start: string; memberId: string } | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const serviceById = useMemo(() => new Map(p.services.map((s) => [s.id, s])), [p.services]);
  const memberById = useMemo(() => new Map(p.members.map((m) => [m.id, m])), [p.members]);
  const bookable = p.members.filter((m) => m.bookable);
  const visibleMembers = p.view === "day" ? (staffFilter === "all" ? bookable : bookable.filter((m) => m.id === staffFilter)) : bookable;

  // Hours to show: from earliest availability to latest, padded, min 8am–6pm.
  const [startHour, endHour] = useMemo(() => {
    let lo = 8 * 60, hi = 18 * 60;
    const hoursSource = p.org.schedule_mode === "shifts" ? p.shifts : p.rules;
    hoursSource.forEach((r) => { lo = Math.min(lo, toMin(r.start_time)); hi = Math.max(hi, toMin(r.end_time)); });
    p.bookings.forEach((b) => {
      lo = Math.min(lo, minutesInDay(b.starts_at, tz));
      hi = Math.max(hi, minutesInDay(b.ends_at, tz) || 24 * 60);
    });
    return [Math.max(0, Math.floor(lo / 60) - 1), Math.min(24, Math.ceil(hi / 60) + 1)];
  }, [p.rules, p.shifts, p.org.schedule_mode, p.bookings, tz]);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  // Columns: in day view, one per staff member; in week view, one per day.
  const columns =
    p.view === "day"
      ? visibleMembers.map((m) => ({ key: m.id, day: p.date, memberIds: [m.id], label: m.display_name, member: m }))
      : Array.from({ length: 7 }, (_, i) => {
          const day = addDaysToKey(p.rangeStart, i);
          return {
            key: day,
            day,
            memberIds: staffFilter === "all" ? bookable.map((m) => m.id) : [staffFilter],
            label: day,
            member: null as Membership | null,
          };
        });

  const go = (date: string, view = p.view) => router.push(`/o/${p.slug}/calendar?date=${date}&view=${view}`);
  const step = p.view === "week" ? 7 : 1;

  useEffect(() => {
    // Scroll to ~1 hour before the current time, or the start of the work day.
    const el = scrollRef.current;
    if (!el) return;
    const n = minutesInDay(new Date().toISOString(), tz);
    const target = p.date === todayKey(tz) ? n / 60 - 1.5 : startHour + 1;
    el.scrollTop = Math.max(0, (target - startHour) * HOUR);
  }, [p.date, p.view, startHour, tz]);

  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${p.date}T12:00:00Z`),
  );
  const dayTitle = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${p.date}T12:00:00Z`),
  );

  function onGridClick(e: React.MouseEvent<HTMLDivElement>, day: string, memberId: string) {
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const mins = Math.round(((y / HOUR) * 60) / 15) * 15 + startHour * 60;
    const d = startOfDayInZone(day, tz);
    d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    setNewAt({ start: new Date(d.getTime()).toISOString(), memberId });
  }

  const today = todayKey(tz);
  const nowMin = now ? minutesInDay(now.toISOString(), tz) : -1;

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col lg:h-[calc(100dvh-5rem)]">
      {p.welcome && <Welcome slug={p.slug} />}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 pb-5">
        <div className="mr-auto">
          <h1 className="text-[28px] font-bold leading-tight sm:text-[34px]">{p.view === "day" ? dayTitle : title}</h1>
          <p className="text-[14px] text-label-2">{p.bookings.length} booking{p.bookings.length === 1 ? "" : "s"} {p.view === "day" ? "today" : "this week"}</p>
        </div>
        <div className="flex items-center gap-1 rounded-[11px] bg-surface p-1 shadow-sm hairline">
          <button onClick={() => go(addDaysToKey(p.date, -step))} className="grid size-10 place-items-center sm:size-8 rounded-[8px] text-label-2 hover:bg-surface-2" aria-label="Previous">
            <ChevronLeft className="size-5" />
          </button>
          <button onClick={() => go(today)} className="h-10 rounded-[8px] px-3 sm:h-8 text-[14px] font-medium hover:bg-surface-2">Today</button>
          <button onClick={() => go(addDaysToKey(p.date, step))} className="grid size-10 place-items-center sm:size-8 rounded-[8px] text-label-2 hover:bg-surface-2" aria-label="Next">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <Segmented
          value={p.view}
          onChange={(v) => go(p.date, v)}
          options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }]}
        />
        <Button onClick={() => setNewAt({ start: "", memberId: p.meId })} pill>
          <Plus className="size-4" strokeWidth={2.5} /> New
        </Button>
      </div>

      {/* Location filter */}
      {p.locations.length > 1 && (
        <div className="scrollbar-none -mx-1 mb-3 flex gap-2 overflow-x-auto px-1">
          {[{ id: "all", name: "All locations" }, ...p.locations].map((l) => (
            <button
              key={l.id}
              onClick={() => setLocationFilter(l.id)}
              className={cn(
                "flex h-10 shrink-0 items-center sm:h-8 rounded-full px-3.5 text-[13px] font-medium transition",
                locationFilter === l.id ? "bg-accent text-white" : "bg-surface text-label-2 hairline hover:text-label",
              )}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {/* Staff filter */}
      {bookable.length > 1 && (
        <div className="scrollbar-none -mx-1 mb-4 flex gap-2 overflow-x-auto px-1">
          {[{ id: "all", display_name: "Everyone", color: "#8E8E93" }, ...bookable].map((m) => (
            <button
              key={m.id}
              onClick={() => setStaffFilter(m.id)}
              className={cn(
                "flex h-10 shrink-0 items-center sm:h-8 gap-2 rounded-full pr-3 text-[13px] font-medium transition",
                m.id === "all" ? "pl-3" : "pl-1",
                staffFilter === m.id ? "bg-label text-canvas" : "bg-surface text-label-2 hairline hover:text-label",
              )}
            >
              {m.id === "all" ? null : <Avatar name={m.display_name} color={m.color} size={24} />}
              {m.display_name}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-surface shadow-sm hairline">
        {/* One scroll area for headers and body, so they never drift apart on narrow screens */}
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="min-w-fit">
        {/* Column headers */}
        <div className="sticky top-0 z-30 flex border-b border-separator bg-surface">
          <div className="sticky left-0 z-10 w-14 shrink-0 bg-surface sm:w-16" />
          {columns.map((c) => {
            const isToday = c.day === today;
            return (
              <div key={c.key} className="min-w-[88px] flex-1 border-l border-separator px-1 py-2.5 sm:min-w-[120px] sm:px-2 text-center">
                {c.member ? (
                  <div className="flex items-center justify-center gap-2">
                    <Avatar name={c.member.display_name} color={c.member.color} size={26} />
                    <span className="truncate text-[14px] font-semibold">{c.member.display_name}</span>
                  </div>
                ) : (
                  <button onClick={() => go(c.day, "day")} className="inline-flex flex-col items-center">
                    <span className={cn("text-[11px] font-semibold uppercase tracking-wide", isToday ? "text-red" : "text-label-3")}>
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOfKey(c.day)]}
                    </span>
                    <span className={cn("mt-0.5 grid size-8 place-items-center rounded-full text-[18px] font-semibold", isToday ? "bg-red text-white" : "hover:bg-surface-2")}>
                      {Number(c.day.slice(8))}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="relative">
          <div className="flex" style={{ height: hours.length * HOUR }}>
            {/* Time gutter */}
            <div className="sticky left-0 z-10 w-14 shrink-0 bg-surface sm:w-16">
              {hours.map((h, i) => (
                <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] font-medium text-label-3" style={{ top: i * HOUR }}>
                  {i === 0 ? "" : new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, h)))}
                </div>
              ))}
            </div>

            {columns.map((c) => {
              const wd = weekdayOfKey(c.day);
              // Working hours shading (union over members in this column)
              const working =
                p.org.schedule_mode === "shifts"
                  ? p.shifts.filter((s) => c.memberIds.includes(s.member_id) && s.day === c.day)
                  : p.rules.filter((r) => c.memberIds.includes(r.member_id) && r.weekday === wd);
              const colBookings = p.bookings.filter((b) => c.memberIds.includes(b.member_id) && dayKey(b.starts_at, tz) === c.day);
              const colOff = p.timeOff.filter((t) => c.memberIds.includes(t.member_id));
              const events = layout(
                colBookings.map((b) => ({
                  b,
                  start: minutesInDay(b.starts_at, tz),
                  end: minutesInDay(b.ends_at, tz) || 24 * 60,
                })),
              );
              const clickMember = c.member?.id ?? (staffFilter !== "all" ? staffFilter : p.meId);

              return (
                <div
                  key={c.key}
                  className="relative min-w-[88px] flex-1 cursor-cell sm:min-w-[120px] border-l border-separator bg-surface-2"
                  onClick={(e) => onGridClick(e, c.day, clickMember)}
                >
                  {/* Working hours */}
                  {working.map((r, i) => (
                    <div
                      key={i}
                      className="absolute inset-x-0 bg-surface"
                      style={{ top: ((toMin(r.start_time) - startHour * 60) / 60) * HOUR, height: ((toMin(r.end_time) - toMin(r.start_time)) / 60) * HOUR }}
                    />
                  ))}
                  {/* Hour lines */}
                  {hours.map((h, i) => (
                    <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-separator" style={{ top: i * HOUR }} />
                  ))}
                  {/* Time off */}
                  {colOff.map((t) => {
                    const s = dayKey(t.starts_at, tz) < c.day ? 0 : minutesInDay(t.starts_at, tz);
                    const e = dayKey(t.ends_at, tz) > c.day ? 24 * 60 : minutesInDay(t.ends_at, tz);
                    if (dayKey(t.starts_at, tz) > c.day || dayKey(t.ends_at, tz) < c.day || e <= s) return null;
                    return (
                      <div
                        key={t.id}
                        className="pointer-events-none absolute inset-x-1 rounded-[8px] bg-[repeating-linear-gradient(135deg,var(--surface-3)_0,var(--surface-3)_6px,transparent_6px,transparent_12px)] px-2 py-1 text-[11px] font-medium text-label-3"
                        style={{ top: ((s - startHour * 60) / 60) * HOUR, height: ((e - s) / 60) * HOUR }}
                      >
                        {t.reason || "Time off"}
                      </div>
                    );
                  })}
                  {/* Now line */}
                  {c.day === today && nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
                    <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: ((nowMin - startHour * 60) / 60) * HOUR }}>
                      <span className="-ml-1 size-2.5 rounded-full bg-red" />
                      <span className="h-[2px] flex-1 bg-red" />
                    </div>
                  )}
                  {/* Events */}
                  {events.map(({ b, start, end, lane, lanes }) => {
                    const svc = b.service_id ? serviceById.get(b.service_id) : undefined;
                    const color = svc?.color ?? memberById.get(b.member_id)?.color ?? "#007AFF";
                    const height = Math.max(22, ((end - start) / 60) * HOUR - 2);
                    const pending = b.status === "pending_payment" || b.status === "pending_approval";
                    return (
                      <button
                        key={b.id}
                        data-event
                        onClick={() => setSelected(b)}
                        className={cn(
                          "absolute z-10 overflow-hidden rounded-[8px] px-2 py-1 text-left transition-[transform,box-shadow] duration-150 hover:z-20 hover:shadow-md active:scale-[0.98]",
                          (b.status === "completed" || b.status === "no_show") && "opacity-60",
                        )}
                        style={{
                          top: ((start - startHour * 60) / 60) * HOUR + 1,
                          height,
                          left: `calc(${(lane / lanes) * 100}% + 3px)`,
                          width: `calc(${100 / lanes}% - 6px)`,
                          background: `color-mix(in srgb, ${color} 16%, var(--surface))`,
                          borderLeft: `3px ${pending ? "dashed" : "solid"} ${color}`,
                        }}
                      >
                        <div className="truncate text-[12px] font-semibold" style={{ color: `color-mix(in srgb, ${color} 75%, var(--label))` }}>
                          {formatTime(b.starts_at, tz)} {height > 40 ? "" : `· ${b.customer?.name ?? b.service_name}`}
                        </div>
                        {height > 40 && <div className="truncate text-[12px] font-medium text-label">{b.customer?.name ?? "Customer"}</div>}
                        {height > 58 && <div className="truncate text-[11px] text-label-2">{b.service_name}{p.view === "week" && memberById.get(b.member_id) ? ` · ${memberById.get(b.member_id)!.display_name}` : ""}</div>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        </div>
        </div>
      </div>

      <NewBookingSheet
        open={!!newAt}
        onClose={() => setNewAt(null)}
        slug={p.slug}
        org={p.org}
        defaultStart={newAt?.start}
        defaultMemberId={newAt?.memberId}
        locations={p.locations}
        defaultLocationId={locationFilter === "all" ? undefined : locationFilter}
        members={bookable}
        services={p.services.filter((s) => s.active)}
        customers={p.customers}
      />
      <BookingSheet
        booking={selected}
        onClose={() => setSelected(null)}
        slug={p.slug}
        org={p.org}
        members={bookable}
        service={selected?.service_id ? serviceById.get(selected.service_id) : undefined}
        member={selected ? memberById.get(selected.member_id) : undefined}
        location={selected?.location_id ? p.locations.find((l) => l.id === selected.location_id) : undefined}
      />
    </div>
  );
}

function Welcome({ slug }: { slug: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-[18px] bg-gradient-to-r from-[#007AFF] to-[#5856D6] p-5 text-white shadow-md animate-rise">
      <div className="grid size-11 place-items-center rounded-[12px] bg-white/20"><PartyPopper className="size-6" /></div>
      <div className="flex-1">
        <div className="text-[17px] font-semibold">Your team is ready.</div>
        <div className="text-[14px] text-white/80">We added starter services and Mon–Fri, 9–5 hours. Tweak them, then share your booking page.</div>
      </div>
      <a href={`/${slug}`} target="_blank" className={buttonClass("gray", "sm", true, "bg-white text-[#007AFF] hover:bg-white/90")}>View booking page</a>
      <button onClick={() => setOpen(false)} className="h-10 text-[14px] font-medium text-white/80 hover:text-white">Dismiss</button>
    </div>
  );
}
