"use client";
import { useEffect, useState, useTransition } from "react";
import { CalendarClock, ClipboardList, Mail, MapPin, Phone, Repeat, StickyNote, User, Users, CreditCard, CheckCircle2, UserX, XCircle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice, statusTone } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatMoney, formatTime, STATUS_LABEL } from "@/lib/format";
import type { Booking, BookingStatus, Location, Membership, Organization, Service } from "@/lib/types";
import { approveBooking, cancelSeriesFollowing, declineBooking, editSeriesFollowing, getSeriesSummary, rescheduleBooking, setBookingStatus, type SeriesSummary } from "@/app/o/[org]/actions";
import { Segmented } from "@/components/ui/segmented";
import { joinInZone, splitInZone, TIME_OPTIONS } from "./datetime";

interface SheetProps {
  booking: Booking | null;
  onClose: () => void;
  slug: string;
  org: Organization;
  members: Membership[];
  service?: Service;
  member?: Membership;
  location?: Location;
}

export function BookingSheet(props: SheetProps) {
  if (!props.booking) return null;
  // Keyed so local state resets whenever a different booking is opened.
  return <BookingSheetInner key={props.booking.id} {...props} booking={props.booking} />;
}

function BookingSheetInner({ booking, onClose, slug, org, members, service, member, location }: SheetProps & { booking: Booking }) {
  const tz = org.timezone;
  const toast = useToast();
  const initial = splitInZone(booking.starts_at, tz);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [memberId, setMemberId] = useState(booking.member_id);
  const color = service?.color ?? member?.color ?? "#007AFF";
  const active = booking.status === "confirmed" || booking.status === "pending_payment";
  const awaiting = booking.status === "pending_approval";
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [seriesInfo, setSeriesInfo] = useState<SeriesSummary | null>(null);
  const [confirmSeries, setConfirmSeries] = useState(false);
  // Changing a repeating appointment: just this date, or this one and every later one.
  const [scope, setScope] = useState<"this" | "later">("this");
  const [changed, setChanged] = useState<{ moved: number; skipped: { startsAt: string; reason: string }[] } | null>(null);
  const series = seriesInfo?.bookingId === booking.id ? seriesInfo : null;

  // Where this booking sits in its repeating series (loaded when the sheet opens).
  useEffect(() => {
    let alive = true;
    if (booking.series_id) getSeriesSummary(slug, booking.id).then((r) => { if (alive) setSeriesInfo(r); });
    return () => { alive = false; };
  }, [slug, booking.id, booking.series_id]);

  const cancelFollowing = () =>
    start(async () => {
      if (!confirmSeries) return setConfirmSeries(true);
      const r = await cancelSeriesFollowing(slug, booking.id);
      if (r.error) setError(r.error);
      else {
        toast(`${r.booked ?? 0} appointments cancelled`);
        onClose();
      }
    });

  const act = (status: BookingStatus, msg: string) =>
    start(async () => {
      const r = await setBookingStatus(slug, booking.id, status);
      if (r.error) setError(r.error);
      else {
        toast(msg);
        onClose();
      }
    });

  const decide = (approve: boolean) =>
    start(async () => {
      if (!approve && !confirmDecline) return setConfirmDecline(true);
      const r = approve ? await approveBooking(slug, booking.id) : await declineBooking(slug, booking.id);
      if (r.error) setError(r.error);
      else {
        toast(approve ? "Booking confirmed — customer notified" : "Request declined — customer notified");
        onClose();
      }
    });

  const save = () =>
    start(async () => {
      if (scope === "later" && series && series.later > 1) {
        const r = await editSeriesFollowing(slug, booking.id, { startsAt: joinInZone(date, time, tz), memberId, notify: true });
        if (r.error) return setError(r.error);
        if (r.skipped?.length) return setChanged({ moved: r.booked ?? 0, skipped: r.skipped });
        toast(`${r.booked ?? 0} appointments updated`);
        return onClose();
      }
      const r = await rescheduleBooking(slug, booking.id, joinInZone(date, time, tz), memberId);
      if (r.error) setError(r.error);
      else {
        toast("Booking updated");
        onClose();
      }
    });

  if (changed) {
    return (
      <Sheet open onClose={onClose} title="Appointments updated" subtitle={booking.service_name}>
        <div className="space-y-4" data-testid="series-change-outcome">
          <Notice tone="green">{changed.moved} {changed.moved === 1 ? "appointment was" : "appointments were"} updated. The customer was told once.</Notice>
          <div className="space-y-2 rounded-[14px] bg-surface-2 p-4">
            <div className="text-[14px] font-medium">{changed.skipped.length === 1 ? "1 date was left as it was" : `${changed.skipped.length} dates were left as they were`}</div>
            <ul className="space-y-1.5 text-[14px]">
              {changed.skipped.map((s) => (
                <li key={s.startsAt}>
                  <span className="font-medium">{formatDate(s.startsAt, tz)} at {formatTime(s.startsAt, tz)}</span>
                  <span className="block text-[13px] text-label-2">{s.reason}</span>
                </li>
              ))}
            </ul>
          </div>
          <Button className="w-full" pill onClick={onClose}>Done</Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={!!booking}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <span className="size-3 rounded-full" style={{ background: color }} />
          {booking.service_name}
        </span>
      }
      subtitle={<Badge tone={statusTone(booking.status)}>{STATUS_LABEL[booking.status]}</Badge>}
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-[14px] bg-surface hairline divide-y divide-separator">
          <Row icon={<CalendarClock />} label={formatDate(booking.starts_at, tz)} sub={`${formatTime(booking.starts_at, tz)} – ${formatTime(booking.ends_at, tz)}${member ? ` · with ${member.display_name}` : ""}`} />
          {booking.session_id && <Row icon={<Users />} label="Group class" sub="One spot in a class session. Open it from the calendar to see everyone." />}
          {series && (
            <Row icon={<Repeat />} label="Repeating appointment" sub={`${series.index} of ${series.total} · ${series.intervalWeeks === 1 ? "every week" : `every ${series.intervalWeeks} weeks`}`} />
          )}
          {booking.customer_address && (
            <Row
              icon={<MapPin />}
              label={
                <a className="text-accent" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.customer_address)}${booking.customer_address_place_id ? `&query_place_id=${encodeURIComponent(booking.customer_address_place_id)}` : ""}`}>
                  {booking.customer_address}
                </a>
              }
              sub="Service address"
            />
          )}
          {location && <Row icon={<MapPin />} label={location.name} sub={location.address} />}
          <Row icon={<User />} label={booking.customer?.name ?? "Customer"} />
          {booking.customer?.email && <Row icon={<Mail />} label={<a className="text-accent" href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a>} />}
          {booking.customer?.phone && <Row icon={<Phone />} label={<a className="text-accent" href={`tel:${booking.customer.phone}`}>{booking.customer.phone}</a>} />}
          <Row
            icon={<CreditCard />}
            label={formatMoney(booking.price_cents, booking.currency)}
            sub={booking.deposit_cents ? `Deposit ${formatMoney(booking.deposit_cents, booking.currency)} · ${booking.payment_status === "paid" ? "paid" : "unpaid"}` : booking.source === "manual" ? "Added by team" : "Booked online"}
          />
          {booking.notes && <Row icon={<StickyNote />} label={booking.notes} />}
        </div>

        {booking.answers && booking.answers.length > 0 && (
          <div className="space-y-2.5 rounded-[14px] bg-surface-2 p-4" data-testid="booking-answers">
            <div className="flex items-center gap-2 text-[13px] font-medium text-label-2"><ClipboardList className="size-4" /> Customer&apos;s answers</div>
            <dl className="space-y-2.5">
              {booking.answers.map((a) => (
                <div key={a.id}>
                  <dt className="text-[13px] text-label-2">{a.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-[15px]">{Array.isArray(a.value) ? a.value.join(", ") : a.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {awaiting && (
          <div className="space-y-2 rounded-[14px] bg-surface-2 p-4 animate-fade">
            <p className="text-[14px] text-label-2">
              This online request is holding the time slot until you respond.
              {booking.payment_status === "paid" ? " The deposit is refunded automatically if you decline." : ""}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="destructive" onClick={() => decide(false)} disabled={pending}>
                <XCircle className="size-4" /> {confirmDecline ? "Tap to confirm" : "Decline"}
              </Button>
              <Button onClick={() => decide(true)} loading={pending}>
                <CheckCircle2 className="size-4" /> Approve
              </Button>
            </div>
          </div>
        )}

        {editing ? (
          <div className="space-y-3 rounded-[14px] bg-surface-2 p-4 animate-fade">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Time">
                <Select value={time} onChange={(e) => setTime(e.target.value)}>
                  {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="With">
              <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </Select>
            </Field>
            {series && series.later > 1 && (
              <div className="space-y-1.5">
                <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: "this", label: "Just this one" }, { value: "later", label: `This and ${series.later - 1} later` }]} />
                {scope === "later" && <p className="text-[12px] text-label-3">The later dates keep their days and take this time and person. A date that doesn&apos;t fit is skipped and listed.</p>}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="gray" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
              <Button className="flex-1" onClick={save} loading={pending}>Save</Button>
            </div>
          </div>
        ) : (
          active && (
            <div className="grid grid-cols-2 gap-2">
              {!booking.session_id && <Button variant="tinted" onClick={() => setEditing(true)} className="col-span-2">Reschedule</Button>}
              <Button variant="gray" onClick={() => act("completed", "Marked as completed")} disabled={pending}>
                <CheckCircle2 className="size-4 text-green" /> Completed
              </Button>
              <Button variant="gray" onClick={() => act("no_show", "Marked as no-show")} disabled={pending}>
                <UserX className="size-4 text-orange" /> No-show
              </Button>
              <Button variant="destructive" className="col-span-2" onClick={() => act("cancelled", "Booking cancelled")} disabled={pending}>
                <XCircle className="size-4" /> Cancel booking
              </Button>
              {series && series.later > 1 && (
                <Button variant="destructive" className="col-span-2" onClick={cancelFollowing} disabled={pending}>
                  <Repeat className="size-4" /> {confirmSeries ? `Tap to confirm: cancel ${series.later} appointments` : `Cancel this and later ones (${series.later})`}
                </Button>
              )}
            </div>
          )
        )}
        {!active && !awaiting && booking.status !== "cancelled" && (
          <Button variant="gray" className="w-full" onClick={() => act("confirmed", "Booking restored")} disabled={pending}>Undo — mark as confirmed</Button>
        )}
        {error && <Notice>{error}</Notice>}
      </div>
    </Sheet>
  );
}

function Row({ icon, label, sub }: { icon: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-label-3 [&>svg]:size-[18px]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[15px]">{label}</div>
        {sub && <div className="text-[13px] text-label-2">{sub}</div>}
      </div>
    </div>
  );
}
