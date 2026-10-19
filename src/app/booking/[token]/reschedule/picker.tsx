"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime, timeZoneLabel } from "@/lib/format";
import { eligibleMembers, type Slot } from "@/lib/slots";
import type { BusyInterval, PublicOrg, PublicService } from "@/lib/types";
import { getWindow } from "@/app/[slug]/actions";
import { TimePicker } from "@/components/booking/time-picker";
import { rescheduleBooking } from "../actions";
import { useSafeTransition } from "@/components/ui/use-server-action";

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

  const [reload, setReload] = useState(0);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useSafeTransition(setError, { requireSession: false }); // a failed request becomes an inline message, not the crash page

  // This booking's own block must not make its neighbouring times look taken.
  const filterBusy = useCallback(
    (b: BusyInterval) => !(b.member_id === currentMemberId && new Date(b.starts_at).getTime() === new Date(currentStart).getTime()),
    [currentMemberId, currentStart],
  );

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
      <div className="w-full max-w-2xl animate-pop">
        <Link href={`/booking/${token}`} className="mb-4 inline-flex items-center gap-1 text-[15px] font-medium text-accent"><ArrowLeft className="size-4" /> Back</Link>
        <h1 className="text-[28px] font-bold">Pick a new time</h1>
        <p className="mt-1 text-[15px] text-label-2">
          {service.name} · currently {formatDate(currentStart, tz)}, {formatTime(currentStart, tz)} {timeZoneLabel(tz)}
        </p>

        <div className="mt-6 rounded-[22px] bg-surface p-5 shadow-md hairline">
          <TimePicker
            org={org}
            availability={availability}
            service={service}
            memberIds={eligible}
            locationId={locationId}
            fetchWindow={getWindow}
            filterBusy={filterBusy}
            selected={slot}
            reloadKey={reload}
            onPick={setSlot}
          />
        </div>

        {error && <div className="mt-4"><Notice>{error}</Notice></div>}
        <Button size="lg" pill className="mt-5 w-full" disabled={!slot} loading={pending} onClick={confirm}>
          {slot ? `Move to ${formatDate(slot.start, tz)} at ${formatTime(slot.start, tz)}` : "Choose a time"}
        </Button>
      </div>
    </div>
  );
}
