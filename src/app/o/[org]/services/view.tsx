"use client";
import { useState, useTransition } from "react";
import { Clock, Link2, MapPin, Phone, Plus, Sparkles, Video, Check } from "lucide-react";
import { PageHeader, EmptyState, Avatar, Notice, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, PALETTE } from "@/lib/utils";
import { formatDuration, formatMoney } from "@/lib/format";
import type { LocationType, Membership, Organization, Service, ServiceKind, ServiceQuestion } from "@/lib/types";
import { QuestionsEditor, serializeDrafts, toDrafts, type DraftQuestion } from "./questions-editor";
import { deleteService, saveService } from "../actions";

const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360, 480];
const LOC_ICON = { in_person: MapPin, video: Video, phone: Phone };

export function ServicesView({
  slug, org, services, staffMap, questionMap, members, canEdit,
}: {
  slug: string; org: Organization; services: Service[]; staffMap: Record<string, string[]>; questionMap: Record<string, ServiceQuestion[]>; members: Membership[]; canEdit: boolean;
}) {
  const [editing, setEditing] = useState<Partial<Service> | null>(null);
  const toast = useToast();

  const copy = async (s: Service) => {
    await navigator.clipboard.writeText(`${window.location.origin}/${org.slug}?service=${s.slug}`);
    toast("Link copied");
  };

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="What customers can book, how long it takes, and what it costs."
        actions={canEdit && <Button pill onClick={() => setEditing({})}><Plus className="size-4" strokeWidth={2.5} /> New service</Button>}
      />
      {services.length === 0 ? (
        <EmptyState icon={<Sparkles className="size-7" />} title="No services yet" body="Create your first service so customers can start booking." action={canEdit && <Button pill onClick={() => setEditing({})}>Create service</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {services.map((s) => {
            const Icon = LOC_ICON[s.location_type];
            const staff = staffMap[s.id] ?? [];
            const shown = staff.length ? members.filter((m) => staff.includes(m.id)) : members;
            return (
              <div key={s.id} className={cn("group relative flex flex-col rounded-[20px] bg-surface p-5 shadow-sm hairline transition hover:shadow-md animate-rise", !s.active && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: s.color }} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[17px] font-semibold">{s.name}</h3>
                    {s.description && <p className="mt-0.5 line-clamp-2 text-[14px] text-label-2">{s.description}</p>}
                  </div>
                  {!s.active && <Badge>Hidden</Badge>}
                  {s.active && !s.auto_approve && <Badge tone="orange">Needs approval</Badge>}
                </div>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-label-2">
                  <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" />{formatDuration(s.duration_minutes)}</span>
                  <span className="inline-flex items-center gap-1.5"><Icon className="size-3.5" />{s.location_type === "in_person" ? "In person" : s.location_type === "video" ? "Video" : "Phone"}</span>
                  <span className="font-medium text-label">{formatMoney(s.price_cents, org.currency)}</span>
                  {s.deposit_cents > 0 && <span>{formatMoney(s.deposit_cents, org.currency)} deposit</span>}
                  {(questionMap[s.id]?.length ?? 0) > 0 && <span>{questionMap[s.id].length} question{questionMap[s.id].length === 1 ? "" : "s"}</span>}
                </div>
                <div className="mt-auto flex items-center justify-between pt-5">
                  <div className="flex -space-x-1">
                    {shown.slice(0, 5).map((m) => <Avatar key={m.id} name={m.display_name} color={m.color} size={26} className="ring-2 ring-surface" />)}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="gray" onClick={() => copy(s)}><Link2 className="size-3.5" /> Link</Button>
                    {canEdit && <Button size="sm" variant="tinted" onClick={() => setEditing(s)}>Edit</Button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ServiceEditor
          slug={slug}
          org={org}
          service={editing}
          staff={editing.id ? staffMap[editing.id] ?? [] : []}
          questions={editing.id ? questionMap[editing.id] ?? [] : []}
          others={services.filter((s) => s.id !== editing.id).map((s) => ({ id: s.id, name: s.name, questions: questionMap[s.id] ?? [] }))}
          members={members}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ServiceEditor({
  slug, org, service, staff, questions, others, members, onClose,
}: {
  slug: string; org: Organization; service: Partial<Service>; staff: string[]; questions: ServiceQuestion[]; others: { id: string; name: string; questions: ServiceQuestion[] }[]; members: Membership[]; onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ServiceKind>(service.kind ?? "appointment");
  const [loc, setLoc] = useState<LocationType>(service.location_type ?? (kind === "meeting" ? "video" : "in_person"));
  const [color, setColor] = useState(service.color ?? PALETTE[0]);
  const [selectedStaff, setSelectedStaff] = useState<string[]>(staff);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [drafts, setDrafts] = useState<DraftQuestion[]>(() => toDrafts(questions));

  const submit = (fd: FormData) => {
    fd.set("questions", serializeDrafts(drafts));
    fd.set("kind", kind);
    fd.set("location_type", loc);
    fd.set("color", color);
    fd.delete("staff");
    selectedStaff.forEach((id) => fd.append("staff", id));
    start(async () => {
      const r = await saveService(slug, fd);
      if (r.error) setError(r.error);
      else { toast(service.id ? "Service updated" : "Service created"); onClose(); }
    });
  };

  const remove = () =>
    start(async () => {
      if (!service.id || !confirmDelete) return setConfirmDelete(true);
      const r = await deleteService(slug, service.id);
      if (r.error) setError(r.error);
      else { toast("Service deleted"); onClose(); }
    });

  return (
    <Sheet open onClose={onClose} title={service.id ? "Edit service" : "New service"}>
      <form action={submit} className="space-y-5">
        <input type="hidden" name="id" value={service.id ?? ""} />
        <Field label="Name"><Input name="name" defaultValue={service.name} placeholder="Haircut & style" required autoFocus={!service.id} /></Field>
        <Field label="Description"><Textarea name="description" defaultValue={service.description ?? ""} placeholder="What's included?" className="min-h-16" /></Field>

        <div className="flex items-center justify-between">
          <span className="px-1 text-[13px] font-medium text-label-2">Type</span>
          <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: "appointment", label: "Appointment" }, { value: "meeting", label: "Meeting" }]} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration">
            <Select name="duration_minutes" defaultValue={service.duration_minutes ?? 30}>
              {DURATIONS.map((d) => <option key={d} value={d}>{formatDuration(d)}</option>)}
            </Select>
          </Field>
          <Field label="Break after" hint="Buffer before the next booking.">
            <Select name="buffer_after_minutes" defaultValue={service.buffer_after_minutes ?? 0}>
              {[0, 5, 10, 15, 20, 30, 45, 60].map((d) => <option key={d} value={d}>{d ? formatDuration(d) : "None"}</option>)}
            </Select>
          </Field>
          <Field label={`Price (${org.currency})`} hint="0 for free.">
            <Input name="price" type="number" min={0} step="0.01" defaultValue={(service.price_cents ?? 0) / 100} />
          </Field>
          <Field label="Deposit" hint={org.stripe_charges_enabled ? "Charged when booking." : "Connect Stripe to collect."}>
            <Input name="deposit" type="number" min={0} step="0.01" defaultValue={(service.deposit_cents ?? 0) / 100} />
          </Field>
        </div>

        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Location</span>
          <Segmented className="w-full" value={loc} onChange={setLoc} options={[{ value: "in_person", label: "In person" }, { value: "video", label: "Video" }, { value: "phone", label: "Phone" }]} />
          {loc !== "phone" && (
            <Input name="location_detail" defaultValue={service.location_detail ?? ""} placeholder={loc === "video" ? "Meeting link (Zoom, Google Meet, FaceTime…)" : `Address (defaults to ${org.address || "your business address"})`} />
          )}
        </div>

        <Field label="Customer's address" hint="For mobile services where you go to the customer, like detailing or house calls.">
          <Select name="address_mode" defaultValue={service.address_mode ?? "off"}>
            <option value="off">Don&apos;t ask</option>
            <option value="optional">Ask, but optional</option>
            <option value="required">Required to book</option>
          </Select>
        </Field>

        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Colour</span>
          <div className="flex flex-wrap gap-2.5">
            {PALETTE.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} className="grid size-10 place-items-center sm:size-8 rounded-full transition-transform active:scale-90" style={{ background: c }} aria-label={c}>
                {color === c && <Check className="size-4 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Who performs this?</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedStaff([])} className={cn("h-10 sm:h-8 rounded-full px-3.5 text-[13px] font-medium transition", selectedStaff.length === 0 ? "bg-accent text-white" : "bg-surface-2")}>
              Anyone
            </button>
            {members.map((m) => {
              const on = selectedStaff.includes(m.id);
              return (
                <button type="button" key={m.id} onClick={() => setSelectedStaff((s) => (on ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                  className={cn("flex h-10 sm:h-8 items-center gap-1.5 rounded-full pl-1 pr-3 text-[13px] font-medium transition", on ? "bg-accent text-white" : "bg-surface-2")}>
                  <Avatar name={m.display_name} color={m.color} size={24} /> {m.display_name}
                </button>
              );
            })}
          </div>
        </div>

        <QuestionsEditor value={drafts} onChange={setDrafts} others={others} />

        <div className="flex items-center justify-between gap-4 rounded-[12px] bg-surface-2 px-4 py-3">
          <div>
            <div className="text-[15px] font-medium">Automatically approve bookings</div>
            <div className="text-[13px] text-label-2">Off: each online booking arrives as a request that you confirm or reject.</div>
          </div>
          <Switch name="auto_approve" defaultChecked={service.auto_approve ?? true} label="Automatically approve bookings" />
        </div>

        <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-4 py-3">
          <div>
            <div className="text-[15px] font-medium">Bookable online</div>
            <div className="text-[13px] text-label-2">Show on your public booking page.</div>
          </div>
          <Switch name="active" defaultChecked={service.active ?? true} />
        </div>

        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          {service.id && (
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {confirmDelete ? "Tap to confirm" : "Delete"}
            </Button>
          )}
          <Button type="submit" className="flex-1" pill loading={pending}>Save</Button>
        </div>
      </form>
    </Sheet>
  );
}
