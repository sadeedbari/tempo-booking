"use client";
import { useEffect, useState } from "react";
import { Clock, MapPin, Users } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import type { PublicOrg, PublicService, PublicSession } from "@/lib/types";
import type { getSessions } from "@/app/[slug]/actions";

/** The upcoming sessions of a class, one card each, with the spots left. Full sessions are shown but can't be picked. */
export function SessionPicker({
  data, service, locationId, fetchSessions, selectedId, onPick, reloadKey = 0,
}: {
  data: PublicOrg;
  service: PublicService;
  locationId: string | null;
  fetchSessions: typeof getSessions;
  selectedId?: string | null;
  onPick: (s: PublicSession) => void;
  /** Bump to refetch (e.g. after "this class is full"). */
  reloadKey?: number;
}) {
  const { org, staff, locations } = data;
  const tz = org.timezone;
  const [state, setState] = useState<{ key: string; sessions: PublicSession[] } | null>(null);
  const key = `${service.id}:${reloadKey}`;

  useEffect(() => {
    let live = true;
    fetchSessions(org.id, service.id).then((sessions) => live && setState({ key, sessions }));
    return () => { live = false; };
  }, [org.id, service.id, key, fetchSessions]);

  if (!state || state.key !== key) return <div className="flex justify-center py-16 text-label-3"><Spinner className="size-6" /></div>;

  const sessions = state.sessions.filter((s) => !locationId || !s.location_id || s.location_id === locationId);
  if (sessions.length === 0) {
    return <p className="py-10 text-center text-[15px] text-label-2" data-testid="no-sessions">No upcoming sessions yet. Check back soon.</p>;
  }

  const byDay = new Map<string, PublicSession[]>();
  for (const s of sessions) {
    const label = formatDate(s.starts_at, tz);
    byDay.set(label, [...(byDay.get(label) ?? []), s]);
  }

  return (
    <div className="space-y-5" data-testid="session-list">
      {[...byDay.entries()].map(([day, list]) => (
        <section key={day}>
          <h3 className="mb-2 text-[14px] font-semibold text-label-2">{day}</h3>
          <ul className="space-y-2.5">
            {list.map((s) => {
              const left = Math.max(0, s.capacity - s.booked);
              const full = left === 0;
              const who = staff.find((m) => m.id === s.member_id)?.display_name;
              const where = locations.length > 1 ? locations.find((l) => l.id === s.location_id)?.name : null;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={full}
                    onClick={() => onPick(s)}
                    aria-label={`${formatTime(s.starts_at, tz)}, ${full ? "full" : `${left} ${left === 1 ? "spot" : "spots"} left`}`}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-[16px] p-4 text-left transition active:scale-[0.99]",
                      selectedId === s.id ? "bg-accent-soft ring-2 ring-accent" : "bg-surface-2/60 hover:bg-surface-2",
                      full && "cursor-not-allowed opacity-60 hover:bg-surface-2/60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[16px] font-semibold">
                        <Clock className="size-4 text-label-3" />
                        {formatTime(s.starts_at, tz)} – {formatTime(s.ends_at, tz)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-label-2">
                        {who && <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{who}</span>}
                        {where && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{where}</span>}
                      </div>
                      {s.notes && <p className="mt-1 line-clamp-2 text-[13px] text-label-3">{s.notes}</p>}
                    </div>
                    <span className={cn("shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold", full ? "bg-surface-3 text-label-3" : left <= 3 ? "bg-orange/15 text-orange" : "bg-accent-soft text-accent")}>
                      {full ? "Full" : `${left} ${left === 1 ? "spot" : "spots"} left`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
