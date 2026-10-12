"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Plane, X } from "lucide-react";
import { PageHeader, Avatar, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatDate, formatTime, timeZoneLabel } from "@/lib/format";
import type { AvailabilityRule, Membership, Organization, TimeOff } from "@/lib/types";
import { joinInZone, TIME_OPTIONS } from "@/components/app/datetime";
import { addTimeOff, deleteTimeOff, saveAvailability } from "../actions";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WD = [1, 2, 3, 4, 5, 6, 0];
type Block = { start: string; end: string };

export function AvailabilityView({
  slug, org, members, memberId, rules, timeOff,
}: {
  slug: string; org: Organization; members: Membership[]; memberId: string; rules: AvailabilityRule[]; timeOff: TimeOff[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [offOpen, setOffOpen] = useState(false);
  const [week, setWeek] = useState<Record<number, Block[]>>(() => {
    const w: Record<number, Block[]> = {};
    WD.forEach((d) => (w[d] = []));
    rules.forEach((r) => w[r.weekday].push({ start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) }));
    return w;
  });
  const [dirty, setDirty] = useState(false);

  const update = (d: number, blocks: Block[]) => { setWeek((w) => ({ ...w, [d]: blocks })); setDirty(true); };

  const save = () =>
    start(async () => {
      const list = WD.flatMap((d) => week[d].map((b) => ({ weekday: d, start_time: b.start, end_time: b.end })));
      const r = await saveAvailability(slug, memberId, list);
      if (r.error) setError(r.error);
      else { setError(null); setDirty(false); toast("Hours saved"); }
    });

  const copyMondayToWeekdays = () => {
    setWeek((w) => ({ ...w, 2: [...w[1]], 3: [...w[1]], 4: [...w[1]], 5: [...w[1]] }));
    setDirty(true);
  };

  return (
    <>
      <PageHeader
        title="Availability"
        subtitle={`Weekly hours in ${org.timezone.replace(/_/g, " ")} (${timeZoneLabel(org.timezone)}).`}
        actions={<Button pill onClick={save} loading={pending} disabled={!dirty}>Save changes</Button>}
      />

      {org.schedule_mode === "shifts" && (
        <div className="mb-6">
          <Notice tone="blue">
            Online booking currently follows the schedule your admin builds, not these weekly hours. Time off below still blocks bookings.
          </Notice>
        </div>
      )}

      {members.length > 1 && (
        <div className="scrollbar-none -mx-1 mb-6 flex gap-2 overflow-x-auto px-1">
          {members.map((m) => (
            <button key={m.id} onClick={() => router.push(`/o/${slug}/availability?member=${m.id}`)}
              className={cn("flex h-10 shrink-0 items-center gap-2 rounded-full pl-1 pr-3.5 text-[14px] font-medium transition", m.id === memberId ? "bg-label text-canvas" : "bg-surface hairline text-label-2")}>
              <Avatar name={m.display_name} color={m.color} size={28} /> {m.display_name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-2">
          <div className="overflow-hidden rounded-[18px] bg-surface shadow-sm hairline divide-y divide-separator">
            {WD.map((d, i) => {
              const blocks = week[d];
              const on = blocks.length > 0;
              return (
                <div key={d} className="flex flex-wrap items-start gap-4 px-5 py-4">
                  <div className="flex w-40 items-center gap-3 pt-1">
                    <Switch label={DAYS[i]} checked={on} onChange={(v) => update(d, v ? [{ start: "09:00", end: "17:00" }] : [])} />
                    <span className={cn("py-2 text-[15px] font-medium", !on && "text-label-3")}>{DAYS[i]}</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    {!on && <div className="pt-2 text-[14px] text-label-3">Unavailable</div>}
                    {blocks.map((b, bi) => (
                      <div key={bi} className="flex items-center gap-2 animate-fade">
                        <Select className="h-10 w-32" value={b.start} onChange={(e) => update(d, blocks.map((x, xi) => (xi === bi ? { ...x, start: e.target.value } : x)))}>
                          {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                        <span className="text-label-3">–</span>
                        <Select className="h-10 w-32" value={b.end} onChange={(e) => update(d, blocks.map((x, xi) => (xi === bi ? { ...x, end: e.target.value } : x)))}>
                          {[...TIME_OPTIONS.slice(1), { value: "23:59", label: "Midnight" }].map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                        <button onClick={() => update(d, blocks.filter((_, xi) => xi !== bi))} className="grid size-10 place-items-center sm:size-8 rounded-full text-label-3 hover:bg-surface-2 hover:text-red" aria-label="Remove">
                          <X className="size-4" />
                        </button>
                        {bi === blocks.length - 1 && (
                          <button onClick={() => update(d, [...blocks, { start: "13:00", end: "17:00" }])} className="grid size-10 place-items-center sm:size-8 rounded-full text-accent hover:bg-accent-soft" aria-label="Add hours">
                            <Plus className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between px-2">
            <button onClick={copyMondayToWeekdays} className="inline-flex min-h-10 items-center text-[14px] font-medium text-accent">Copy Monday to all weekdays</button>
            {dirty && <span className="text-[13px] text-orange">Unsaved changes</span>}
          </div>
          {error && <Notice>{error}</Notice>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[20px] font-semibold">Time off</h2>
            <Button size="sm" variant="tinted" onClick={() => setOffOpen(true)}><Plus className="size-3.5" /> Add</Button>
          </div>
          {timeOff.length === 0 ? (
            <div className="rounded-[18px] bg-surface px-5 py-8 text-center shadow-sm hairline">
              <Plane className="mx-auto size-8 text-label-4" />
              <p className="mt-2 text-[14px] text-label-2">No upcoming time off.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[18px] bg-surface shadow-sm hairline divide-y divide-separator">
              {timeOff.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{t.reason || "Time off"}</div>
                    <div className="text-[13px] text-label-2">
                      {formatDate(t.starts_at, org.timezone, { weekday: "short", month: "short" })} {formatTime(t.starts_at, org.timezone)} → {formatDate(t.ends_at, org.timezone, { weekday: "short", month: "short" })} {formatTime(t.ends_at, org.timezone)}
                    </div>
                  </div>
                  <button className="grid size-10 place-items-center sm:size-8 rounded-full text-label-3 hover:bg-red-soft hover:text-red" aria-label="Delete"
                    onClick={() => start(async () => { const r = await deleteTimeOff(slug, t.id); toast(r.error ?? "Removed", r.error ? "error" : "success"); })}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <TimeOffSheet open={offOpen} onClose={() => setOffOpen(false)} slug={slug} memberId={memberId} tz={org.timezone} />
    </>
  );
}

function TimeOffSheet({ open, onClose, slug, memberId, tz }: { open: boolean; onClose: () => void; slug: string; memberId: string; tz: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [allDay, setAllDay] = useState(true);
  const toast = useToast();
  return (
    <Sheet open={open} onClose={onClose} title="Add time off" subtitle="Customers won't be able to book during this time.">
      <form
        className="space-y-4"
        action={(fd) => {
          const sd = String(fd.get("start_date")), ed = String(fd.get("end_date") || sd);
          const st = allDay ? "00:00" : String(fd.get("start_time")), et = allDay ? "23:59" : String(fd.get("end_time"));
          fd.set("starts_at", joinInZone(sd, st, tz));
          fd.set("ends_at", joinInZone(ed, et, tz));
          fd.set("member_id", memberId);
          start(async () => {
            const r = await addTimeOff(slug, fd);
            if (r.error) setError(r.error); else { toast("Time off added"); onClose(); }
          });
        }}
      >
        <Field label="Reason (optional)"><Input name="reason" placeholder="Vacation, appointment…" /></Field>
        <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-4 py-3">
          <span className="text-[15px] font-medium">All day</span>
          <Switch checked={allDay} onChange={setAllDay} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><Input type="date" name="start_date" required /></Field>
          <Field label="To"><Input type="date" name="end_date" /></Field>
          {!allDay && (
            <>
              <Select name="start_time" defaultValue="12:00">{TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
              <Select name="end_time" defaultValue="13:00">{TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
            </>
          )}
        </div>
        {error && <Notice>{error}</Notice>}
        <Button type="submit" size="lg" pill className="w-full" loading={pending}>Add time off</Button>
      </form>
    </Sheet>
  );
}
