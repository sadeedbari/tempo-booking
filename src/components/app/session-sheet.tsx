"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, ClipboardList, Mail, MapPin, Phone, Search, StickyNote, UserPlus, UserX, Users, XCircle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Avatar, Badge, Notice, statusTone } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatDate, formatTime, STATUS_LABEL } from "@/lib/format";
import type { ClassSession, Customer, Location, Membership, Organization, Service } from "@/lib/types";
import {
  addSessionAttendee, approveBooking, cancelSession, declineBooking, getSessionRoster, setBookingStatus, updateSession,
  type SessionAttendee,
} from "@/app/o/[org]/actions";

interface Props {
  session: ClassSession | null;
  onClose: () => void;
  slug: string;
  org: Organization;
  service?: Service;
  member?: Membership;
  location?: Location;
  customers: Customer[];
}

export function SessionSheet(props: Props) {
  if (!props.session) return null;
  // Keyed so everything resets when a different session is opened.
  return <Inner key={props.session.id} {...props} session={props.session} />;
}

const ACTIVE = ["confirmed", "pending_payment", "pending_approval"];

function Inner({ session, onClose, slug, org, service, member, location, customers }: Props & { session: ClassSession }) {
  const tz = org.timezone;
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<SessionAttendee[] | null>(null);
  const [over] = useState(() => new Date(session.ends_at).getTime() < Date.now());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [capacity, setCapacity] = useState(String(session.capacity));
  const [notes, setNotes] = useState(session.notes ?? "");
  // What's saved: the sheet keeps showing the new numbers after a save, without waiting for the calendar to reload.
  const [saved, setSaved] = useState({ capacity: session.capacity, notes: session.notes ?? "" });
  const color = service?.color ?? member?.color ?? "#007AFF";

  const load = useCallback(() => getSessionRoster(slug, session.id).then((r) => setRoster(r?.attendees ?? [])), [slug, session.id]);
  useEffect(() => {
    let alive = true;
    getSessionRoster(slug, session.id).then((r) => { if (alive) setRoster(r?.attendees ?? []); });
    return () => { alive = false; };
  }, [slug, session.id]);

  const going = (roster ?? []).filter((a) => a.status !== "cancelled");
  const holding = going.filter((a) => ACTIVE.includes(a.status));
  const cancelled = (roster ?? []).filter((a) => a.status === "cancelled");
  const cap = Number(capacity) || saved.capacity;
  const full = holding.length >= saved.capacity;
  const cancelledSession = session.status === "cancelled";

  const run = (fn: () => Promise<{ error?: string }>, msg?: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        if (msg) toast(msg);
        await load();
      }
    });

  const setStatus = (a: SessionAttendee, status: "completed" | "no_show" | "cancelled" | "confirmed", msg: string) => run(() => setBookingStatus(slug, a.bookingId, status), msg);

  const save = () =>
    start(async () => {
      setError(null);
      const r = await updateSession(slug, session.id, { capacity: cap, notes });
      if (r.error) setError(r.error);
      else {
        setSaved({ capacity: cap, notes });
        toast("Session updated");
      }
    });

  const doCancel = (reason: string, notify: boolean) =>
    start(async () => {
      setError(null);
      const r = await cancelSession(slug, session.id, { reason, notify });
      if (r.error) setError(r.error);
      else {
        toast(r.booked ? `Session cancelled. ${r.booked} ${r.booked === 1 ? "person" : "people"} told.` : "Session cancelled");
        if (r.warning) toast(r.warning);
        onClose();
      }
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <span className="size-3 rounded-full" style={{ background: color }} />
          {service?.name ?? "Class"}
        </span>
      }
      subtitle={
        cancelledSession ? <Badge tone="red">Cancelled</Badge> : (
          <span data-testid="session-count"><Badge tone={full ? "orange" : "blue"}>{holding.length} of {saved.capacity} booked</Badge></span>
        )
      }
    >
      <div className="space-y-5" data-testid="session-sheet">
        <div className="overflow-hidden rounded-[14px] bg-surface hairline divide-y divide-separator">
          <Row icon={<CalendarClock />} label={formatDate(session.starts_at, tz)} sub={`${formatTime(session.starts_at, tz)} – ${formatTime(session.ends_at, tz)}${member ? ` · led by ${member.display_name}` : ""}`} />
          {location && <Row icon={<MapPin />} label={location.name} sub={location.address} />}
          {saved.notes && <Row icon={<StickyNote />} label={saved.notes} />}
        </div>

        <section aria-label="Roster" className="space-y-2.5">
          <div className="flex items-center gap-2 px-1 text-[13px] font-medium text-label-2"><Users className="size-4" /> Who&apos;s coming</div>
          {roster === null ? (
            <p className="px-1 text-[14px] text-label-3">Loading…</p>
          ) : going.length === 0 ? (
            <p className="rounded-[14px] bg-surface-2 px-4 py-4 text-[14px] text-label-2" data-testid="roster-empty">Nobody has booked yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="roster">
              {going.map((a) => (
                <li key={a.bookingId} className="rounded-[14px] bg-surface p-3.5 hairline" data-testid="attendee">
                  <div className="flex items-center gap-3">
                    <Avatar name={a.name} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{a.name}</div>
                      <div className="flex flex-wrap gap-x-3 text-[12px] text-label-2">
                        {a.email && <a className="inline-flex items-center gap-1 text-accent" href={`mailto:${a.email}`}><Mail className="size-3" />{a.email}</a>}
                        {a.phone && <a className="inline-flex items-center gap-1 text-accent" href={`tel:${a.phone}`}><Phone className="size-3" />{a.phone}</a>}
                      </div>
                    </div>
                    {a.status !== "confirmed" && <Badge tone={statusTone(a.status)}>{STATUS_LABEL[a.status]}</Badge>}
                  </div>
                  {a.notes && <p className="mt-2 text-[13px] text-label-2">{a.notes}</p>}
                  {a.answers.length > 0 && (
                    <details className="mt-2 text-[13px]">
                      <summary className="flex cursor-pointer items-center gap-1.5 text-label-2"><ClipboardList className="size-3.5" /> Answers</summary>
                      <dl className="mt-1.5 space-y-1.5">
                        {a.answers.map((q) => (
                          <div key={q.id}>
                            <dt className="text-label-3">{q.label}</dt>
                            <dd className="whitespace-pre-wrap break-words">{Array.isArray(q.value) ? q.value.join(", ") : q.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                  {a.status === "pending_approval" ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => declineBooking(slug, a.bookingId), "Request declined")}>Decline</Button>
                      <Button size="sm" disabled={pending} onClick={() => run(() => approveBooking(slug, a.bookingId), "Spot confirmed")}>Approve</Button>
                    </div>
                  ) : a.status === "pending_payment" ? (
                    <p className="mt-2 text-[12px] text-label-3">Holding a spot until the deposit is paid.</p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {a.status === "confirmed" ? (
                        <>
                          <Button size="sm" variant="gray" disabled={pending} onClick={() => setStatus(a, "completed", `${a.name} marked as attended`)}><CheckCircle2 className="size-4 text-green" /> Attended</Button>
                          <Button size="sm" variant="gray" disabled={pending} onClick={() => setStatus(a, "no_show", `${a.name} marked as a no-show`)}><UserX className="size-4 text-orange" /> No-show</Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending}
                            onClick={() => (confirmRemove === a.bookingId ? (setConfirmRemove(null), setStatus(a, "cancelled", `${a.name} removed`)) : setConfirmRemove(a.bookingId))}
                          >
                            <XCircle className="size-4" /> {confirmRemove === a.bookingId ? "Tap to confirm" : "Remove"}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="gray" disabled={pending} onClick={() => setStatus(a, "confirmed", `${a.name} restored`)}>Undo, mark as booked</Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {cancelled.length > 0 && (
            <details className="px-1 text-[13px] text-label-3">
              <summary className="cursor-pointer">Cancelled ({cancelled.length})</summary>
              <ul className="mt-1 space-y-0.5">{cancelled.map((a) => <li key={a.bookingId}>{a.name}</li>)}</ul>
            </details>
          )}
        </section>

        {!cancelledSession && !over && (
          <>
            {adding ? (
              <AddPerson
                customers={customers}
                full={full}
                pending={pending}
                onCancel={() => setAdding(false)}
                onAdd={(input) =>
                  start(async () => {
                    setError(null);
                    const r = await addSessionAttendee(slug, session.id, input);
                    if (r.error) setError(r.error);
                    else {
                      toast("Added to the session");
                      setAdding(false);
                      await load();
                    }
                  })
                }
              />
            ) : (
              <Button variant="tinted" className="w-full" onClick={() => setAdding(true)} disabled={pending}>
                <UserPlus className="size-4" /> Add someone{full ? " (full)" : ""}
              </Button>
            )}

            <div className="space-y-3 rounded-[14px] bg-surface-2 p-4">
              <div className="grid grid-cols-[110px_1fr] gap-3">
                <Field label="Spots"><Input type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} aria-label="Spots" /></Field>
                <Field label="Notes for customers"><Textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className="min-h-12" aria-label="Notes for customers" /></Field>
              </div>
              <Button variant="gray" className="w-full" onClick={save} disabled={pending || (cap === saved.capacity && notes === saved.notes)}>Save changes</Button>
            </div>

            {cancelling ? (
              <CancelPanel count={holding.length} pending={pending} onBack={() => setCancelling(false)} onConfirm={doCancel} />
            ) : (
              <Button variant="destructive" className="w-full" onClick={() => setCancelling(true)} disabled={pending}>
                <XCircle className="size-4" /> Cancel this session
              </Button>
            )}
          </>
        )}
        {error && <Notice>{error}</Notice>}
      </div>
    </Sheet>
  );
}

function AddPerson({
  customers, full, pending, onAdd, onCancel,
}: {
  customers: Customer[]; full: boolean; pending: boolean;
  onAdd: (i: { customerId?: string; name?: string; email?: string; phone?: string; notify: boolean }) => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(customers.length ? "existing" : "new");
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notify, setNotify] = useState(true);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q)).slice(0, 5);
  }, [customers, query]);

  return (
    <div className="space-y-3 rounded-[14px] bg-surface-2 p-4 animate-fade" data-testid="add-person">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium">Add someone</span>
        {customers.length > 0 && <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "existing", label: "Existing" }, { value: "new", label: "New" }]} />}
      </div>
      {full && <Notice tone="blue">This session is full. Raise the number of spots first.</Notice>}
      {mode === "existing" ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-label-3" />
            <Input className="pl-9" placeholder="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="overflow-hidden rounded-[12px] bg-surface hairline divide-y divide-separator">
            {filtered.map((c) => (
              <button type="button" key={c.id} onClick={() => setCustomerId(c.id)} className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition", customerId === c.id ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <Avatar name={c.name} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{c.name}</span>
                  <span className="block truncate text-[12px] text-label-2">{c.email}</span>
                </span>
                {customerId === c.id && <span className="text-[13px] font-semibold text-accent">Selected</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3.5 py-3 text-[14px] text-label-3">No matches.</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <Input type="tel" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px]">Email them a confirmation</span>
        <Switch checked={notify} onChange={setNotify} label="Email them a confirmation" />
      </div>
      <div className="flex gap-2">
        <Button variant="gray" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button
          className="flex-1"
          loading={pending}
          disabled={full || (mode === "existing" ? !customerId : !name.trim() || !email.trim())}
          onClick={() => onAdd(mode === "existing" ? { customerId, notify } : { name, email, phone, notify })}
        >
          Add to session
        </Button>
      </div>
    </div>
  );
}

function CancelPanel({ count, pending, onBack, onConfirm }: { count: number; pending: boolean; onBack: () => void; onConfirm: (reason: string, notify: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  return (
    <div className="space-y-3 rounded-[14px] bg-surface-2 p-4 animate-fade" data-testid="cancel-session">
      <div className="text-[15px] font-semibold">Cancel this session?</div>
      <p className="text-[13px] text-label-2">
        {count > 0 ? `${count} ${count === 1 ? "person's spot is" : "people's spots are"} cancelled and paid deposits are refunded.` : "Nobody has booked yet."} This can&apos;t be undone.
      </p>
      <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {count > 0 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px]">Tell everyone by email</span>
          <Switch checked={notify} onChange={setNotify} label="Tell everyone by email" />
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="gray" className="flex-1" onClick={onBack}>Keep it</Button>
        <Button variant="destructive" className="flex-1" loading={pending} onClick={() => onConfirm(reason, notify)}>Yes, cancel session</Button>
      </div>
    </div>
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
