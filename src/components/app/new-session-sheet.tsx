"use client";
import { useState, useTransition } from "react";
import { Repeat } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar, Notice } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatDate, formatDuration, formatTime, todayKey } from "@/lib/format";
import type { Location, Membership, Organization, Service } from "@/lib/types";
import { createSessions } from "@/app/o/[org]/actions";
import { joinInZone, splitInZone, TIME_OPTIONS } from "./datetime";

interface Props {
  open: boolean;
  onClose: () => void;
  slug: string;
  org: Organization;
  members: Membership[];
  locations: Location[];
  /** The services that are group classes. */
  classes: Service[];
  defaultStart?: string;
  defaultMemberId?: string;
  defaultServiceId?: string;
  defaultLocationId?: string;
}

export function NewSessionSheet(props: Props) {
  if (!props.open) return null;
  // Keyed so the form starts fresh each time it opens.
  return <Inner key={`${props.defaultStart}-${props.defaultServiceId}-${props.defaultMemberId}`} {...props} />;
}

function Inner({ open, onClose, slug, org, members, locations, classes, defaultStart, defaultMemberId, defaultServiceId, defaultLocationId }: Props) {
  const tz = org.timezone;
  const toast = useToast();
  const initial = defaultStart ? splitInZone(defaultStart, tz) : { date: todayKey(tz), time: "18:00" };
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState(classes.find((s) => s.id === defaultServiceId)?.id ?? classes[0]?.id ?? "");
  const service = classes.find((s) => s.id === serviceId) ?? null;
  const [capacity, setCapacity] = useState(String(service?.class_capacity ?? 10));
  const [memberId, setMemberId] = useState(defaultMemberId && members.some((m) => m.id === defaultMemberId) ? defaultMemberId : members[0]?.id ?? "");
  const [locationId, setLocationId] = useState(defaultLocationId ?? locations[0]?.id ?? "");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [notes, setNotes] = useState("");
  const [repeatWeeks, setRepeatWeeks] = useState(0);
  const [repeatCount, setRepeatCount] = useState(8);
  const [outcome, setOutcome] = useState<{ booked: number; skipped: { startsAt: string; reason: string }[] } | null>(null);

  function pickService(id: string) {
    setServiceId(id);
    const s = classes.find((x) => x.id === id);
    if (s) setCapacity(String(s.class_capacity));
  }

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("service_id", serviceId);
    fd.set("member_id", memberId);
    fd.set("location_id", locationId);
    fd.set("starts_at", joinInZone(date, time, tz));
    fd.set("capacity", capacity);
    fd.set("notes", notes);
    if (repeatWeeks) {
      fd.set("repeat_weeks", String(repeatWeeks));
      fd.set("repeat_count", String(repeatCount));
    }
    start(async () => {
      const r = await createSessions(slug, fd);
      if (r.error) setError(r.error);
      else if (repeatWeeks) {
        setOutcome({ booked: r.booked ?? 1, skipped: r.skipped ?? [] });
        toast(`${r.booked ?? 1} sessions added`);
      } else {
        toast("Session added");
        onClose();
      }
    });
  }

  if (outcome) {
    return (
      <Sheet open={open} onClose={onClose} title="Sessions added" subtitle="A repeating class.">
        <div className="space-y-4" data-testid="session-outcome">
          <Notice tone="green">{outcome.booked} {outcome.booked === 1 ? "session was" : "sessions were"} added to the calendar.</Notice>
          {outcome.skipped.length > 0 && (
            <div className="space-y-2 rounded-[14px] bg-surface-2 p-4">
              <div className="text-[14px] font-medium">{outcome.skipped.length === 1 ? "1 date was skipped" : `${outcome.skipped.length} dates were skipped`}</div>
              <ul className="space-y-1.5 text-[14px]">
                {outcome.skipped.map((s) => (
                  <li key={s.startsAt}>
                    <span className="font-medium">{formatDate(s.startsAt, tz)} at {formatTime(s.startsAt, tz)}</span>
                    <span className="block text-[13px] text-label-2">{s.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-label-2">Add those separately if you still want them.</p>
            </div>
          )}
          <Button className="w-full" pill onClick={onClose}>Done</Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="New class session" subtitle="Put a session of a class on the calendar.">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-5">
        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Class</span>
          <div className="grid gap-2 p-0.5">
            {classes.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => pickService(s.id)}
                className={cn("flex items-center gap-3 rounded-[12px] bg-surface px-3.5 py-2.5 text-left transition", serviceId === s.id ? "ring-2 ring-accent" : "hairline hover:bg-surface-2")}
              >
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-[15px] font-medium">{s.name}</span>
                <span className="text-[13px] text-label-2">{formatDuration(s.duration_minutes)} · {s.class_capacity} spots</span>
              </button>
            ))}
            {classes.length === 0 && <Notice tone="blue">Turn on &ldquo;This is a group class&rdquo; for a service first.</Notice>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Time">
            <Select value={time} onChange={(e) => setTime(e.target.value)}>
              {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Spots" hint="How many people can join.">
            <Input type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
          </Field>
          {locations.length > 1 && (
            <Field label="Location">
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Led by</span>
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {members.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setMemberId(m.id)}
                className={cn("flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-[14px] font-medium transition", memberId === m.id ? "bg-accent text-white" : "bg-surface-2 text-label")}
              >
                <Avatar name={m.display_name} color={m.color} size={26} />
                {m.display_name}
              </button>
            ))}
          </div>
        </div>

        <Field label="Notes for customers" hint="Shown on the booking page, like “Bring a mat”. Optional.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="min-h-16" />
        </Field>

        <div className="space-y-2 rounded-[14px] bg-surface-2 p-3.5" data-testid="repeat-options">
          <div className="flex items-center gap-2 text-[13px] font-medium text-label-2"><Repeat className="size-4" /> Repeat</div>
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label="How often" value={repeatWeeks} onChange={(e) => setRepeatWeeks(Number(e.target.value))} className="bg-surface">
              <option value={0}>Doesn&apos;t repeat</option>
              <option value={1}>Every week</option>
              <option value={2}>Every 2 weeks</option>
              <option value={3}>Every 3 weeks</option>
              <option value={4}>Every 4 weeks</option>
            </Select>
            <Select aria-label="How many sessions" value={repeatCount} disabled={!repeatWeeks} onChange={(e) => setRepeatCount(Number(e.target.value))} className="bg-surface">
              {Array.from({ length: 51 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} sessions</option>)}
            </Select>
          </div>
          {repeatWeeks > 0 && <p className="text-[12px] text-label-3">The same time each date. A date that clashes with another booking or class is skipped, and you&apos;ll see which.</p>}
        </div>

        {error && <Notice>{error}</Notice>}
        <Button type="submit" className="w-full" pill loading={pending} disabled={!service}>
          {repeatWeeks ? `Add ${repeatCount} sessions` : "Add session"}
        </Button>
      </form>
    </Sheet>
  );
}
