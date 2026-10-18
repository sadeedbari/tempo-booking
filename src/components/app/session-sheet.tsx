"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRightLeft, CalendarClock, Hourglass, CheckCircle2, ClipboardList, Mail, MapPin, Phone, Repeat, Search, StickyNote, UserPlus, UserX, Users, XCircle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Avatar, Badge, Notice, statusTone } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatDate, formatTime, STATUS_LABEL } from "@/lib/format";
import type { ClassSession, Customer, Location, Membership, Organization, Service } from "@/lib/types";
import {
  addSessionAttendee, approveBooking, cancelSession, declineBooking, getMoveTargets, getSessionRoster, getSessionSeries, getSessionWaitlist, moveAttendee, moveSession,
  removeWaitlistEntry, setBookingStatus, updateSession, type MoveTarget, type SessionAttendee, type WaitlistEntry,
} from "@/app/o/[org]/actions";
import { joinInZone, splitInZone, TIME_OPTIONS } from "./datetime";

interface Props {
  session: ClassSession | null;
  onClose: () => void;
  slug: string;
  org: Organization;
  service?: Service;
  member?: Membership;
  location?: Location;
  customers: Customer[];
  /** Who can lead a session (for moving it to someone else). */
  members: Membership[];
}

export function SessionSheet(props: Props) {
  if (!props.session) return null;
  // Keyed so everything resets when a different session is opened.
  return <Inner key={props.session.id} {...props} session={props.session} />;
}

const ACTIVE = ["confirmed", "pending_payment", "pending_approval"];

type Outcome = { title: string; lines: string[]; skipped: { startsAt: string; reason: string }[] };

function Inner({ session, onClose, slug, org, service, member, location, customers, members }: Props & { session: ClassSession }) {
  const tz = org.timezone;
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<SessionAttendee[] | null>(null);
  const [waiting, setWaiting] = useState<WaitlistEntry[]>([]);
  const [series, setSeries] = useState<{ index: number; total: number; later: number } | null>(null);
  const [over] = useState(() => new Date(session.ends_at).getTime() < Date.now());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [targets, setTargets] = useState<MoveTarget[] | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [capacity, setCapacity] = useState(String(session.capacity));
  const [notes, setNotes] = useState(session.notes ?? "");
  const [alsoLater, setAlsoLater] = useState(false);
  // What's saved: the sheet keeps showing the new numbers after a save, without waiting for the calendar to reload.
  const [saved, setSaved] = useState({ capacity: session.capacity, notes: session.notes ?? "" });
  const color = service?.color ?? member?.color ?? "#007AFF";
  const laterCount = series?.later ?? 0;

  const load = useCallback(
    () => Promise.all([getSessionRoster(slug, session.id).then((r) => setRoster(r?.attendees ?? [])), getSessionWaitlist(slug, session.id).then(setWaiting)]),
    [slug, session.id],
  );
  useEffect(() => {
    let alive = true;
    getSessionRoster(slug, session.id).then((r) => { if (alive) setRoster(r?.attendees ?? []); });
    getSessionWaitlist(slug, session.id).then((r) => { if (alive) setWaiting(r); });
    getSessionSeries(slug, session.id).then((r) => { if (alive) setSeries(r); });
    return () => { alive = false; };
  }, [slug, session.id]);

  const going = (roster ?? []).filter((a) => a.status !== "cancelled");
  const holdingPeople = going.filter((a) => ACTIVE.includes(a.status));
  // Capacity counts spots: a booking of three takes three.
  const holding = { length: holdingPeople.reduce((n, a) => n + a.spots, 0), people: holdingPeople.length };
  const spotsLeft = Math.max(0, saved.capacity - holding.length);
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
      const r = await updateSession(slug, session.id, { capacity: cap, notes, applyToLater: alsoLater && laterCount > 0 });
      if (r.error) setError(r.error);
      else {
        setSaved({ capacity: cap, notes });
        await load(); // more spots may have booked people in off the waitlist
        if (r.skipped?.length) setOutcome({ title: "Saved", lines: [`${r.booked} ${r.booked === 1 ? "session was" : "sessions were"} updated.`], skipped: r.skipped });
        else toast(alsoLater && laterCount > 0 ? `${r.booked} sessions updated` : "Session updated");
      }
    });

  const openMove = (a: SessionAttendee) => {
    setMovingId(a.bookingId);
    setError(null);
    if (!targets) getMoveTargets(slug, session.id).then(setTargets);
  };

  const doCancel = (reason: string, notify: boolean, later: boolean) =>
    start(async () => {
      setError(null);
      const r = await cancelSession(slug, session.id, { reason, notify, applyToLater: later });
      if (r.error) setError(r.error);
      else {
        toast(
          later && (r.sessions ?? 1) > 1
            ? `${r.sessions} sessions cancelled${r.booked ? `. ${r.booked} ${r.booked === 1 ? "person" : "people"} told.` : "."}`
            : r.booked ? `Session cancelled. ${r.booked} ${r.booked === 1 ? "person" : "people"} told.` : "Session cancelled",
        );
        if (r.warning) toast(r.warning);
        onClose();
      }
    });

  const doReschedule = (v: { date: string; time: string; memberId: string; later: boolean; notify: boolean }) =>
    start(async () => {
      setError(null);
      const r = await moveSession(slug, session.id, { startsAt: joinInZone(v.date, v.time, tz), memberId: v.memberId, applyToLater: v.later, notify: v.notify });
      if (r.error) setError(r.error);
      else {
        const lines = [
          `${r.booked ?? 0} ${r.booked === 1 ? "session was" : "sessions were"} moved.`,
          r.people ? `${r.people} ${r.people === 1 ? "person was" : "people were"} ${v.notify ? "told" : "moved (not emailed)"}.` : "",
        ].filter(Boolean);
        setOutcome({ title: "Session moved", lines, skipped: r.skipped ?? [] });
      }
    });

  if (outcome) {
    return (
      <Sheet open onClose={onClose} title={outcome.title} subtitle={service?.name}>
        <div className="space-y-4" data-testid="session-change-outcome">
          <Notice tone="green">{outcome.lines.join(" ")}</Notice>
          {outcome.skipped.length > 0 && (
            <div className="space-y-2 rounded-[14px] bg-surface-2 p-4">
              <div className="text-[14px] font-medium">{outcome.skipped.length === 1 ? "1 session was left as it was" : `${outcome.skipped.length} sessions were left as they were`}</div>
              <ul className="space-y-1.5 text-[14px]">
                {outcome.skipped.map((s) => (
                  <li key={s.startsAt}>
                    <span className="font-medium">{formatDate(s.startsAt, tz)} at {formatTime(s.startsAt, tz)}</span>
                    <span className="block text-[13px] text-label-2">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button className="w-full" pill onClick={onClose}>Done</Button>
        </div>
      </Sheet>
    );
  }

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
          {series && <Row icon={<Repeat />} label="Repeating class" sub={`${series.index} of ${series.total}`} />}
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
                    {a.spots > 1 && <Badge tone="blue">{a.spots} spots</Badge>}
                    {a.status !== "confirmed" && <Badge tone={statusTone(a.status)}>{STATUS_LABEL[a.status]}</Badge>}
                  </div>
                  {a.guests && <p className="mt-2 text-[13px] text-label-2">With: {a.guests}</p>}
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
                          {!over && !cancelledSession && (
                            <Button size="sm" variant="gray" disabled={pending} onClick={() => (movingId === a.bookingId ? setMovingId(null) : openMove(a))}><ArrowRightLeft className="size-4" /> Move</Button>
                          )}
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
                  {movingId === a.bookingId && (
                    <MovePerson
                      name={a.name}
                      spots={a.spots}
                      targets={targets}
                      tz={tz}
                      pending={pending}
                      onCancel={() => setMovingId(null)}
                      onMove={(toId, notify) =>
                        start(async () => {
                          setError(null);
                          const r = await moveAttendee(slug, a.bookingId, toId, notify);
                          if (r.error) setError(r.error);
                          else {
                            toast(`${a.name} moved`);
                            setMovingId(null);
                            setTargets(null);
                            await load();
                          }
                        })
                      }
                    />
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

        {waiting.length > 0 && (
          <section aria-label="Waitlist" className="space-y-2.5" data-testid="waitlist">
            <div className="flex items-center gap-2 px-1 text-[13px] font-medium text-label-2"><Hourglass className="size-4" /> Waitlist ({waiting.length})</div>
            <ul className="space-y-2">
              {waiting.map((w, i) => (
                <li key={w.id} className="flex items-center gap-3 rounded-[14px] bg-surface p-3.5 hairline" data-testid="waiting">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold text-label-2">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{w.name}{w.spots > 1 ? ` · ${w.spots} spots` : ""}</div>
                    <div className="truncate text-[12px] text-label-2">{w.email}{w.phone ? ` · ${w.phone}` : ""}</div>
                  </div>
                  <Button size="sm" variant="gray" disabled={pending} onClick={() => run(() => removeWaitlistEntry(slug, w.id), `${w.name} taken off the waitlist`)}>Remove</Button>
                </li>
              ))}
            </ul>
            <p className="px-1 text-[12px] text-label-3">When a spot opens, the first person whose group fits is booked in automatically and emailed.</p>
          </section>
        )}

        {!cancelledSession && !over && (
          <>
            {adding ? (
              <AddPerson
                customers={customers}
                full={full}
                spotsLeft={spotsLeft}
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
              {laterCount > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px]">Also change the {laterCount} later {laterCount === 1 ? "session" : "sessions"}</span>
                  <Switch checked={alsoLater} onChange={setAlsoLater} label="Also change the later sessions" />
                </div>
              )}
              <Button variant="gray" className="w-full" onClick={save} disabled={pending || (cap === saved.capacity && notes === saved.notes)}>Save changes</Button>
            </div>

            {rescheduling ? (
              <ReschedulePanel
                session={session}
                tz={tz}
                members={members}
                laterCount={laterCount}
                people={holding.people}
                pending={pending}
                onBack={() => setRescheduling(false)}
                onMove={doReschedule}
              />
            ) : (
              <Button variant="gray" className="w-full" onClick={() => setRescheduling(true)} disabled={pending}>
                <CalendarClock className="size-4" /> Move this session
              </Button>
            )}

            {cancelling ? (
              <CancelPanel count={holding.people} laterCount={laterCount} pending={pending} onBack={() => setCancelling(false)} onConfirm={doCancel} />
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

function MovePerson({
  name, spots, targets, tz, pending, onMove, onCancel,
}: {
  name: string; spots: number; targets: MoveTarget[] | null; tz: string; pending: boolean; onMove: (toId: string, notify: boolean) => void; onCancel: () => void;
}) {
  const [toId, setToId] = useState("");
  const [notify, setNotify] = useState(true);
  return (
    <div className="mt-3 space-y-2.5 rounded-[12px] bg-surface-2 p-3.5 animate-fade" data-testid="move-person">
      <div className="text-[14px] font-medium">Move {name} to</div>
      {targets === null ? (
        <p className="text-[13px] text-label-3">Loading sessions…</p>
      ) : targets.length === 0 ? (
        <p className="text-[13px] text-label-2">There are no other upcoming sessions of this class.</p>
      ) : (
        <Select aria-label="Move to" value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">Choose a session</option>
          {targets.map((t) => {
            const left = t.capacity - t.booked;
            const fits = left >= spots;
            return (
              <option key={t.id} value={t.id} disabled={!fits}>
                {formatDate(t.startsAt, tz)} · {formatTime(t.startsAt, tz)} · {left <= 0 ? "full" : !fits ? `only ${left} left` : `${left} ${left === 1 ? "spot" : "spots"} left`}
              </option>
            );
          })}
        </Select>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px]">Email them the new time</span>
        <Switch checked={notify} onChange={setNotify} label="Email them the new time" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="gray" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="flex-1" loading={pending} disabled={!toId} onClick={() => onMove(toId, notify)}>Move</Button>
      </div>
    </div>
  );
}

function ReschedulePanel({
  session, tz, members, laterCount, people, pending, onBack, onMove,
}: {
  session: ClassSession; tz: string; members: Membership[]; laterCount: number; people: number; pending: boolean; onBack: () => void;
  onMove: (v: { date: string; time: string; memberId: string; later: boolean; notify: boolean }) => void;
}) {
  const initial = splitInZone(session.starts_at, tz);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [memberId, setMemberId] = useState(session.member_id);
  const [later, setLater] = useState(false);
  const [notify, setNotify] = useState(true);
  return (
    <div className="space-y-3 rounded-[14px] bg-surface-2 p-4 animate-fade" data-testid="reschedule-session">
      <div className="text-[15px] font-semibold">Move this session</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="New date" /></Field>
        <Field label="Time">
          <Select value={time} onChange={(e) => setTime(e.target.value)} aria-label="New time">
            {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Led by">
        <Select value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="Led by">
          {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </Select>
      </Field>
      {laterCount > 0 && (
        <div className="space-y-1.5">
          <Segmented
            size="sm"
            value={later ? "later" : "this"}
            onChange={(v) => setLater(v === "later")}
            options={[{ value: "this", label: "Just this one" }, { value: "later", label: `This and ${laterCount} later` }]}
          />
          {later && <p className="text-[12px] text-label-3">The later sessions keep their dates and take this time of day and instructor.</p>}
        </div>
      )}
      {people > 0 && (
        <>
          <p className="text-[13px] text-label-2">{people} {people === 1 ? "person is" : "people are"} booked and will move with it.</p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px]">Email them the new time</span>
            <Switch checked={notify} onChange={setNotify} label="Email them the new time" />
          </div>
        </>
      )}
      <div className="flex gap-2">
        <Button variant="gray" className="flex-1" onClick={onBack}>Back</Button>
        <Button className="flex-1" loading={pending} onClick={() => onMove({ date, time, memberId, later, notify })}>Move session</Button>
      </div>
    </div>
  );
}

function AddPerson({
  customers, full, spotsLeft, pending, onAdd, onCancel,
}: {
  customers: Customer[]; full: boolean; spotsLeft: number; pending: boolean;
  onAdd: (i: { customerId?: string; name?: string; email?: string; phone?: string; spots?: number; guests?: string; notify: boolean }) => void; onCancel: () => void;
}) {
  const [spots, setSpots] = useState(1);
  const [guests, setGuests] = useState("");
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
      {Math.min(6, spotsLeft) > 1 && (
        <div className="space-y-2">
          <Select aria-label="How many spots" value={spots} onChange={(e) => setSpots(Number(e.target.value))}>
            {Array.from({ length: Math.min(6, spotsLeft) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "1 spot" : `${n} spots`}</option>)}
          </Select>
          {spots > 1 && <Input placeholder="Who's coming with them? (optional)" maxLength={300} value={guests} onChange={(e) => setGuests(e.target.value)} />}
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
          onClick={() => onAdd(mode === "existing" ? { customerId, spots, guests, notify } : { name, email, phone, spots, guests, notify })}
        >
          Add to session
        </Button>
      </div>
    </div>
  );
}

function CancelPanel({
  count, laterCount, pending, onBack, onConfirm,
}: {
  count: number; laterCount: number; pending: boolean; onBack: () => void; onConfirm: (reason: string, notify: boolean, later: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [later, setLater] = useState(false);
  return (
    <div className="space-y-3 rounded-[14px] bg-surface-2 p-4 animate-fade" data-testid="cancel-session">
      <div className="text-[15px] font-semibold">Cancel this session?</div>
      {laterCount > 0 && (
        <Segmented
          size="sm"
          value={later ? "later" : "this"}
          onChange={(v) => setLater(v === "later")}
          options={[{ value: "this", label: "Just this one" }, { value: "later", label: `This and ${laterCount} later` }]}
        />
      )}
      <p className="text-[13px] text-label-2">
        {later
          ? "Every person booked into these sessions is cancelled and paid deposits are refunded."
          : count > 0 ? `${count} ${count === 1 ? "person's spot is" : "people's spots are"} cancelled and paid deposits are refunded.` : "Nobody has booked yet."}{" "}
        This can&apos;t be undone.
      </p>
      <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {(count > 0 || later) && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px]">Tell everyone by email</span>
          <Switch checked={notify} onChange={setNotify} label="Tell everyone by email" />
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="gray" className="flex-1" onClick={onBack}>Keep it</Button>
        <Button variant="destructive" className="flex-1" loading={pending} onClick={() => onConfirm(reason, notify, later)}>{later ? "Yes, cancel them" : "Yes, cancel session"}</Button>
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
