"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Copy, Download, Plus, Trash2, Wand2 } from "lucide-react";
import { PageHeader, Avatar, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-class";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { weekdayOfKey } from "@/lib/format";
import { crossLocationOverlaps, shiftPeriod, type SchedulePeriod } from "@/lib/schedule";
import { TIME_OPTIONS } from "@/components/app/datetime";
import type { Location, Membership, Organization, Shift } from "@/lib/types";
import { copySchedule, fillFromWeeklyHours, saveDayShifts, setScheduleMode } from "../actions";
import { useSafeTransition } from "@/components/ui/use-server-action";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "09:00" → "9a", "13:30" → "1:30p" */
function short(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

interface Props {
  slug: string;
  org: Organization;
  period: SchedulePeriod;
  start: string;
  days: string[];
  today: string;
  members: Membership[];
  meId: string;
  isAdmin: boolean;
  shifts: Shift[];
  locations: Location[];
  locationStaff: Record<string, string[]>;
  /** "all", or the id of the location whose schedule is being shown. */
  locationId: string;
}

export function ScheduleView(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [scope, setScope] = useState<"me" | "all">(p.isAdmin ? "all" : "me");
  const [editing, setEditing] = useState<{ member: Membership; day: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const [useShifts, setUseShifts] = useState(p.org.schedule_mode === "shifts");
  const [error, setError] = useState<string | null>(null);
  // A lost request also puts the mode switch back to what the server last said.
  const [pending, start] = useSafeTransition((m) => { setError(m); setUseShifts(p.org.schedule_mode === "shifts"); });

  const inLocation = p.locationId !== "all";
  const locQuery = inLocation ? `&location=${p.locationId}` : "";
  const go = (date: string, view: SchedulePeriod = p.period, loc: string = p.locationId) =>
    router.push(`/o/${p.slug}/schedule?view=${view}&date=${date}${loc !== "all" ? `&location=${loc}` : ""}`);
  const locationName = useMemo(() => new Map(p.locations.map((l) => [l.id, l.name])), [p.locations]);
  const currentLocation = inLocation ? locationName.get(p.locationId) ?? "" : "";

  // In a location's schedule: shifts at that location, plus "any location" shifts (shown dashed).
  const visible = useMemo(() => (inLocation ? p.shifts.filter((s) => s.location_id === p.locationId || s.location_id === null) : p.shifts), [p.shifts, inLocation, p.locationId]);

  const byCell = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of visible) {
      const k = `${s.member_id}|${s.day}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [visible]);
  // Every shift of each person-day, for the "two places at once" warnings.
  const allByCell = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of p.shifts) {
      const k = `${s.member_id}|${s.day}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [p.shifts]);
  const conflictCells = useMemo(() => {
    const set = new Set<string>();
    for (const [k, list] of allByCell) {
      if (crossLocationOverlaps(list.map((s) => ({ start: s.start_time, end: s.end_time, location_id: s.location_id }))).length) set.add(k);
    }
    return set;
  }, [allByCell]);

  // Rows: in a location's schedule, the people who work there (everyone if nobody is assigned), plus anyone with a shift there.
  const assigned = inLocation ? p.locationStaff[p.locationId] ?? [] : [];
  const withShift = new Set(visible.map((s) => s.member_id));
  const pool = inLocation ? p.members.filter((m) => assigned.length === 0 || assigned.includes(m.id) || withShift.has(m.id)) : p.members;
  const rows = scope === "me" ? pool.filter((m) => m.id === p.meId) : pool;

  const hoursFor = (memberId: string) => {
    const mins = visible.filter((s) => s.member_id === memberId && (!inLocation || s.location_id === p.locationId)).reduce((n, s) => n + minutes(s.end_time) - minutes(s.start_time), 0);
    return mins ? `${Math.round((mins / 60) * 10) / 10} h` : "—";
  };

  const label =
    p.period === "week"
      ? `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${p.days[0]}T12:00:00Z`))} – ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${p.days[6]}T12:00:00Z`))}`
      : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p.start}T12:00:00Z`));

  const compact = p.period === "month";
  const cols = `${compact ? 130 : 170}px repeat(${p.days.length}, minmax(${compact ? 58 : 112}px, 1fr))`;

  const toggleMode = (on: boolean) => {
    setUseShifts(on);
    start(async () => {
      const r = await setScheduleMode(p.slug, on ? "shifts" : "availability");
      if (r.error) { setUseShifts(!on); setError(r.error); } else { setError(null); toast(on ? "Online booking now follows the schedule" : "Online booking follows weekly hours"); }
    });
  };

  const fill = () =>
    start(async () => {
      const r = await fillFromWeeklyHours(p.slug, p.period, p.start, inLocation ? p.locationId : undefined);
      if (r.error) setError(r.error);
      else { setError(null); toast(r.copied ? `Added ${r.copied} shifts from weekly hours` : "No empty days to fill"); }
    });

  return (
    <>
      <PageHeader
        title={p.isAdmin ? "Schedule" : "My schedule"}
        subtitle={
          inLocation
            ? `${currentLocation}: who works there and when. Online booking here only uses shifts at this location or marked "any location".`
            : p.isAdmin ? "Plan who works when. Online booking only allows times inside scheduled shifts." : "When you're scheduled to work."
        }
      />

      {p.isAdmin && (
        <div className="mb-5 flex items-center gap-4 rounded-[16px] bg-surface p-4 shadow-sm hairline">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><CalendarClock className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Use this schedule for online booking</div>
            <div className="text-[13px] text-label-2">
              {useShifts
                ? "Customers can only book people during their scheduled shifts."
                : "Off: online booking follows each person's recurring weekly hours. Turn on once your schedule is ready."}
            </div>
          </div>
          <Switch checked={useShifts} onChange={toggleMode} disabled={pending} label="Use this schedule for online booking" />
        </div>
      )}
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}

      {p.locations.length > 1 && (
        <div className="scrollbar-none -mx-1 mb-4 flex gap-2 overflow-x-auto px-1">
          {[{ id: "all", name: "All locations" }, ...p.locations].map((l) => (
            <button
              key={l.id}
              onClick={() => go(p.start, p.period, l.id)}
              className={cn(
                "flex h-10 shrink-0 items-center rounded-full px-4 text-[14px] font-medium transition sm:h-9",
                p.locationId === l.id ? "bg-accent text-white" : "bg-surface text-label-2 hairline hover:text-label",
              )}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {p.isAdmin && conflictCells.size > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[12px] bg-[color-mix(in_srgb,var(--orange)_15%,transparent)] px-3.5 py-2.5 text-[14px] font-medium text-orange">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {conflictCells.size} {conflictCells.size === 1 ? "day has" : "days have"} someone scheduled at two locations at the same time (marked with a warning sign). That is allowed, but they can only take one booking at a time.
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => go(shiftPeriod(p.period, p.start, -1))} className="grid size-10 place-items-center sm:size-8 rounded-[8px] text-label-2 hover:bg-surface-2" aria-label="Previous"><ChevronLeft className="size-5" /></button>
          <button onClick={() => go(p.today)} className="h-10 rounded-[8px] px-3 sm:h-8 text-[14px] font-medium hover:bg-surface-2">Today</button>
          <button onClick={() => go(shiftPeriod(p.period, p.start, 1))} className="grid size-10 place-items-center sm:size-8 rounded-[8px] text-label-2 hover:bg-surface-2" aria-label="Next"><ChevronRight className="size-5" /></button>
        </div>
        <h2 className="text-[17px] font-semibold">{label}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!p.isAdmin && (
            <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: "me", label: "Just me" }, { value: "all", label: "Everyone" }]} />
          )}
          <Segmented size="sm" value={p.period} onChange={(v) => go(p.start, v)} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
          <a
            href={`/api/export/schedule?org=${encodeURIComponent(p.slug)}&view=${p.period}&date=${p.start}${locQuery}`}
            className={buttonClass("gray", "sm")}
            title={`Download this ${p.period}'s schedule as an Excel file`}
          >
            <Download className="size-3.5" /> Export to Excel
          </a>
          {p.isAdmin && (
            <>
              <Button size="sm" variant="gray" onClick={() => setCopying(true)}><Copy className="size-3.5" /> Copy previous {p.period}</Button>
              <Button size="sm" variant="gray" onClick={fill} disabled={pending}><Wand2 className="size-3.5" /> Fill from weekly hours</Button>
            </>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <Notice tone="blue">No one on the team takes bookings yet.</Notice>
      ) : (
        <div className="overflow-x-auto rounded-[18px] bg-surface shadow-sm hairline">
          <div className="grid min-w-max" style={{ gridTemplateColumns: cols }}>
            <div className="sticky left-0 z-10 border-b border-separator bg-surface" />
            {p.days.map((d) => {
              const wd = weekdayOfKey(d);
              return (
                <div key={d} className={cn("border-b border-l border-separator px-1 py-2 text-center", d === p.today && "bg-accent-soft")}>
                  <div className={cn("text-[11px] font-semibold uppercase", d === p.today ? "text-accent" : "text-label-3")}>{WEEKDAY[wd]}</div>
                  <div className={cn("text-[15px] font-semibold", d === p.today && "text-accent")}>{Number(d.slice(8))}</div>
                </div>
              );
            })}

            {rows.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </div>
        </div>
      )}

      {p.isAdmin && <p className="mt-3 text-[13px] text-label-3">Tap a day to set a person&apos;s shifts{inLocation ? ` at ${currentLocation}` : ""}. Totals show hours scheduled in this {p.period}.</p>}

      {editing && (
        <DaySheet
          key={`${editing.member.id}-${editing.day}`}
          slug={p.slug}
          member={editing.member}
          day={editing.day}
          shifts={allByCell.get(`${editing.member.id}|${editing.day}`) ?? []}
          locations={p.locations}
          scopeLocation={inLocation ? p.locationId : null}
          onClose={() => setEditing(null)}
        />
      )}
      {copying && (
        <CopySheet slug={p.slug} period={p.period} start={p.start} label={label} locationId={inLocation ? p.locationId : undefined} locationName={currentLocation} onClose={() => setCopying(false)} />
      )}
    </>
  );

  function Row({ m }: { m: Membership }) {
    return (
      <>
        <div className="sticky left-0 z-10 flex items-center gap-2.5 border-b border-separator bg-surface px-3 py-2">
          <Avatar name={m.display_name} color={m.color} size={compact ? 26 : 32} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">{m.display_name}{m.id === p.meId && <span className="font-normal text-label-3"> (you)</span>}</div>
            <div className="text-[12px] text-label-3">{hoursFor(m.id)}</div>
          </div>
        </div>
        {p.days.map((d) => {
          const cell = byCell.get(`${m.id}|${d}`) ?? [];
          const inner = (
            <div className="flex flex-col gap-1">
              {cell.map((s) => (
                <div
                  key={s.id}
                  title={`${short(s.start_time)}–${short(s.end_time)}${s.location_id ? ` · ${locationName.get(s.location_id) ?? ""}` : " · any location"}`}
                  className={cn("truncate rounded-[7px] px-1.5 py-1 text-[12px] font-semibold leading-tight", inLocation && !s.location_id && "border border-dashed")}
                  style={{ background: `${m.color}24`, color: m.color, borderColor: inLocation && !s.location_id ? `${m.color}88` : undefined }}
                >
                  {short(s.start_time)}–{short(s.end_time)}
                  {!compact && s.location_id && !inLocation && <div className="truncate text-[11px] font-medium opacity-80">{locationName.get(s.location_id)}</div>}
                  {!compact && !s.location_id && inLocation && <div className="truncate text-[11px] font-medium opacity-80">Any location</div>}
                </div>
              ))}
              {cell.length === 0 && p.isAdmin && <Plus className="mx-auto size-4 text-label-4 opacity-0 transition group-hover:opacity-100" />}
            </div>
          );
          const conflict = conflictCells.has(`${m.id}|${d}`);
          const warn = <AlertTriangle className="absolute right-1 top-1 size-3.5 text-orange" aria-label="Scheduled at two locations at the same time" />;
          const base = cn("group relative min-h-14 border-b border-l border-separator p-1", d === p.today && "bg-accent-soft/40", [0, 6].includes(weekdayOfKey(d)) && "bg-surface-2/50");
          return p.isAdmin ? (
            <button key={d} onClick={() => setEditing({ member: m, day: d })} className={cn(base, "text-left transition hover:bg-surface-2")} aria-label={`${m.display_name}, ${d}`}>
              {inner}
              {conflict && warn}
            </button>
          ) : (
            <div key={d} className={base}>{inner}{conflict && warn}</div>
          );
        })}
      </>
    );
  }
}

function DaySheet({
  slug, member, day, shifts, locations, scopeLocation, onClose,
}: {
  slug: string; member: Membership; day: string; shifts: Shift[]; locations: Location[]; scopeLocation: string | null; onClose: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useSafeTransition(setError); // a failed request becomes an inline message, not the crash page
  type Item = { start: string; end: string; location_id: string | null };
  const toItem = (s: Shift): Item => ({ start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), location_id: s.location_id });

  // Opened from a location's schedule: only that location's shifts are edited; the person's other shifts are kept as they are.
  const inScope = (s: Shift) => scopeLocation === null || s.location_id === scopeLocation;
  const fixed = shifts.filter((s) => !inScope(s)).map(toItem);
  const [list, setList] = useState<Item[]>(shifts.filter(inScope).map(toItem));
  const locName = (id: string | null) => (id ? locations.find((l) => l.id === id)?.name ?? "another location" : "any location");

  const effective = list.map((x) => (scopeLocation ? { ...x, location_id: scopeLocation } : x));
  const conflicts = crossLocationOverlaps([...fixed, ...effective]);

  const add = () =>
    setList((l) => {
      const startAt = l.length ? l[l.length - 1].end : "09:00";
      const endAt = Math.min(minutes(startAt) + 8 * 60, 23 * 60 + 45);
      const hh = String(Math.floor(endAt / 60)).padStart(2, "0");
      const mm = String(endAt % 60).padStart(2, "0");
      return [...l, { start: startAt, end: `${hh}:${mm}`, location_id: scopeLocation ?? l[l.length - 1]?.location_id ?? null }];
    });
  const patch = (i: number, v: Partial<Item>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...v } : x)));

  const save = (items: Item[]) =>
    start(async () => {
      const combined = [...fixed, ...items.map((x) => (scopeLocation ? { ...x, location_id: scopeLocation } : x))];
      const r = await saveDayShifts(slug, member.id, day, combined);
      if (r.error) setError(r.error);
      else { toast(items.length ? "Schedule saved" : scopeLocation ? "Cleared for this location" : "Marked as day off"); onClose(); }
    });

  const title = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const first = member.display_name.split(" ")[0];

  return (
    <Sheet open onClose={onClose} title={member.display_name} subtitle={scopeLocation ? `${title} at ${locName(scopeLocation)}` : title}>
      <div className="space-y-4">
        {list.length === 0 && <p className="rounded-[12px] bg-surface-2 px-4 py-3 text-[14px] text-label-2">{scopeLocation ? `Not working at ${locName(scopeLocation)} this day.` : "Day off."} Add a shift to schedule {first}.</p>}
        {fixed.length > 0 && (
          <div className="rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-label-2">
            <div className="mb-1 font-medium text-label">Also scheduled this day</div>
            {fixed.map((x, i) => <div key={i}>{short(x.start)}–{short(x.end)} · {locName(x.location_id)}</div>)}
          </div>
        )}
        {list.map((s, i) => (
          <div key={i} className="space-y-2 rounded-[14px] bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <Select value={s.start} onChange={(e) => patch(i, { start: e.target.value })} aria-label="Start">
                {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <span className="text-label-3">to</span>
              <Select value={s.end} onChange={(e) => patch(i, { end: e.target.value })} aria-label="End">
                {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center rounded-full text-red hover:bg-red-soft" aria-label="Remove shift">
                <Trash2 className="size-4" />
              </button>
            </div>
            {locations.length > 0 && !scopeLocation && (
              <Select value={s.location_id ?? ""} onChange={(e) => patch(i, { location_id: e.target.value || null })} aria-label="Location">
                <option value="">Any location</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </div>
        ))}
        <Button type="button" variant="tinted" className="w-full" onClick={add} disabled={list.length + fixed.length >= 12}><Plus className="size-4" /> Add shift</Button>

        {conflicts.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-[12px] bg-[color-mix(in_srgb,var(--orange)_15%,transparent)] px-3.5 py-2.5 text-[13px] text-orange">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">{first} would be at two locations at the same time</div>
              {conflicts.map(([a, b], i) => (
                <div key={i}>{locName(a.location_id)} {short(a.start)}–{short(a.end)} and {locName(b.location_id)} {short(b.start)}–{short(b.end)}</div>
              ))}
              <div className="text-orange/90">You can still save this. Customers can book {first} at either place, but only one at a time.</div>
            </div>
          </div>
        )}

        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          <Button type="button" variant="gray" disabled={pending} onClick={() => save([])}>{scopeLocation ? "Clear here" : "Day off"}</Button>
          <Button type="button" className="flex-1" pill loading={pending} onClick={() => save(list)}>Save</Button>
        </div>
      </div>
    </Sheet>
  );
}

function CopySheet({
  slug, period, start: periodStartKey, label, locationId, locationName, onClose,
}: {
  slug: string; period: SchedulePeriod; start: string; label: string; locationId?: string; locationName: string; onClose: () => void;
}) {
  const toast = useToast();
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useSafeTransition(setError); // a failed request becomes an inline message, not the crash page

  const submit = () =>
    run(async () => {
      const r = await copySchedule(slug, period, periodStartKey, replace, locationId);
      if (r.error) setError(r.error);
      else {
        toast(r.copied ? `Copied ${r.copied} shifts` : "Nothing to copy");
        onClose();
      }
    });

  return (
    <Sheet open onClose={onClose} title={`Copy previous ${period}`} subtitle={`Into ${label}`}>
      <div className="space-y-4">
        {locationId && <p className="rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-[13px] font-medium text-accent">Only {locationName} shifts are copied and replaced. Other locations are not touched.</p>}
        <p className="text-[14px] text-label-2">
          {period === "week"
            ? "Each day gets the shifts from the same weekday last week."
            : "Each day gets the shifts from the same weekday and position last month (1st Monday ← 1st Monday), so weekly patterns carry over."}
        </p>
        <div className="space-y-2">
          {[
            { v: false, title: "Fill empty days only", body: "Keeps anything you've already scheduled this " + period + "." },
            { v: true, title: `Replace this ${period}`, body: "Clears every shift in this period first, then copies." },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setReplace(o.v)}
              className={cn("w-full rounded-[14px] p-4 text-left transition", replace === o.v ? "bg-accent-soft ring-2 ring-accent" : "bg-surface-2 hover:bg-surface-3")}
            >
              <div className="text-[15px] font-semibold">{o.title}</div>
              <div className="text-[13px] text-label-2">{o.body}</div>
            </button>
          ))}
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          <Button type="button" variant="gray" onClick={onClose}>Cancel</Button>
          <Button type="button" className="flex-1" pill loading={pending} onClick={submit}>Copy</Button>
        </div>
      </div>
    </Sheet>
  );
}
