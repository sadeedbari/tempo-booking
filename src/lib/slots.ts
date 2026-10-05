import type { AvailabilityRule, BusyInterval, PublicShift } from "@/lib/types";
import { addDaysToKey, startOfDayInZone, todayKey, weekdayOfKey } from "@/lib/format";

export interface SlotOptions {
  timeZone: string;
  durationMinutes: number;
  bufferAfterMinutes: number;
  intervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  memberIds: string[];
  rules: AvailabilityRule[];
  /** When set, the dated schedule replaces the recurring weekly rules. */
  shifts?: PublicShift[];
  /** Chosen location; shifts tied to a different location don't count. */
  locationId?: string | null;
  busy: BusyInterval[];
  now?: Date;
}

export interface Slot {
  start: string; // ISO
  memberIds: string[];
}

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Computes bookable start times for a day ("YYYY-MM-DD" in the team's time zone).
 * A slot is offered if at least one eligible staff member is working for the
 * full duration and is free for duration + buffer.
 */
export function slotsForDay(day: string, o: SlotOptions): Slot[] {
  const now = o.now ?? new Date();
  const earliest = now.getTime() + o.minNoticeMinutes * 60_000;
  const lastDay = addDaysToKey(todayKey(o.timeZone), o.maxAdvanceDays);
  if (day > lastDay) return [];

  const weekday = weekdayOfKey(day);
  const byStart = new Map<number, string[]>();

  for (const memberId of o.memberIds) {
    const rules: Pick<AvailabilityRule, "start_time" | "end_time">[] = o.shifts
      ? o.shifts.filter(
          (s) =>
            s.member_id === memberId &&
            s.day === day &&
            (!o.locationId || !s.location_id || s.location_id === o.locationId),
        )
      : o.rules.filter((r) => r.member_id === memberId && r.weekday === weekday);
    const busy = o.busy
      .filter((b) => b.member_id === memberId)
      .map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()] as const);

    for (const rule of rules) {
      const from = toMinutes(rule.start_time);
      const to = toMinutes(rule.end_time);
      for (let m = from; m + o.durationMinutes <= to; m += o.intervalMinutes) {
        // Build the instant via TZDate so DST transitions are respected.
        const local = startOfDayInZone(day, o.timeZone);
        local.setHours(Math.floor(m / 60), m % 60, 0, 0);
        const s = local.getTime();
        if (s < earliest) continue;
        const blockEnd = s + (o.durationMinutes + o.bufferAfterMinutes) * 60_000;
        const clash = busy.some(([bs, be]) => s < be && blockEnd > bs);
        if (clash) continue;
        const list = byStart.get(s) ?? [];
        if (!list.includes(memberId)) list.push(memberId);
        byStart.set(s, list);
      }
    }
  }

  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, memberIds]) => ({ start: new Date(s).toISOString(), memberIds }));
}

/** Which members can perform a service (empty staff list = everyone bookable). */
export function eligibleMembers(staffIds: string[], allStaffIds: string[]) {
  return staffIds.length ? allStaffIds.filter((id) => staffIds.includes(id)) : allStaffIds;
}
