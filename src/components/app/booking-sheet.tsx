"use client";
import { useState, useTransition } from "react";
import { CalendarClock, Mail, MapPin, Phone, StickyNote, User, CreditCard, CheckCircle2, UserX, XCircle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice, statusTone } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatMoney, formatTime, STATUS_LABEL } from "@/lib/format";
import type { Booking, BookingStatus, Location, Membership, Organization, Service } from "@/lib/types";
import { rescheduleBooking, setBookingStatus } from "@/app/o/[org]/actions";
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

  const act = (status: BookingStatus, msg: string) =>
    start(async () => {
      const r = await setBookingStatus(slug, booking.id, status);
      if (r.error) setError(r.error);
      else {
        toast(msg);
        onClose();
      }
    });

  const save = () =>
    start(async () => {
      const r = await rescheduleBooking(slug, booking.id, joinInZone(date, time, tz), memberId);
      if (r.error) setError(r.error);
      else {
        toast("Booking updated");
        onClose();
      }
    });

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
            <div className="flex gap-2">
              <Button variant="gray" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
              <Button className="flex-1" onClick={save} loading={pending}>Save</Button>
            </div>
          </div>
        ) : (
          active && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="tinted" onClick={() => setEditing(true)} className="col-span-2">Reschedule</Button>
              <Button variant="gray" onClick={() => act("completed", "Marked as completed")} disabled={pending}>
                <CheckCircle2 className="size-4 text-green" /> Completed
              </Button>
              <Button variant="gray" onClick={() => act("no_show", "Marked as no-show")} disabled={pending}>
                <UserX className="size-4 text-orange" /> No-show
              </Button>
              <Button variant="destructive" className="col-span-2" onClick={() => act("cancelled", "Booking cancelled")} disabled={pending}>
                <XCircle className="size-4" /> Cancel booking
              </Button>
            </div>
          )
        )}
        {!active && booking.status !== "cancelled" && (
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
