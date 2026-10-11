"use client";
import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Avatar, Notice } from "@/components/ui/misc";
import { AddressInput } from "@/components/ui/address-input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatDuration, formatMoney, todayKey } from "@/lib/format";
import type { Customer, Location, Membership, Organization, Service } from "@/lib/types";
import { createManualBooking } from "@/app/o/[org]/actions";
import { joinInZone, splitInZone, TIME_OPTIONS } from "./datetime";

interface NewProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  org: Organization;
  defaultStart?: string;
  defaultMemberId?: string;
  locations: Location[];
  defaultLocationId?: string;
  members: Membership[];
  services: Service[];
  customers: Customer[];
}

export function NewBookingSheet(props: NewProps) {
  if (!props.open) return null;
  // Keyed so the form starts fresh for every new slot that's tapped.
  return <NewBookingSheetInner key={`${props.defaultStart}-${props.defaultMemberId}`} {...props} />;
}

function NewBookingSheetInner({ open, onClose, slug, org, defaultStart, defaultMemberId, locations, defaultLocationId, members, services, customers }: NewProps) {
  const tz = org.timezone;
  const toast = useToast();
  const initial = defaultStart ? splitInZone(defaultStart, tz) : { date: todayKey(tz), time: "09:00" };
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [memberId, setMemberId] = useState(
    defaultMemberId && members.some((m) => m.id === defaultMemberId) ? defaultMemberId : members[0]?.id ?? "",
  );
  const [locationId, setLocationId] = useState(defaultLocationId ?? locations[0]?.id ?? "");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [mode, setMode] = useState<"existing" | "new">(customers.length ? "existing" : "new");
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("");

  const selectedService = services.find((s) => s.id === serviceId) ?? null;
  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q)).slice(0, 6);
  }, [customers, query]);

  function submit(formData: FormData) {
    setError(null);
    formData.set("service_id", serviceId);
    formData.set("member_id", memberId);
    formData.set("location_id", locationId);
    formData.set("starts_at", joinInZone(date, time, tz));
    if (mode === "existing") formData.set("customer_id", customerId);
    start(async () => {
      const r = await createManualBooking(slug, formData);
      if (r.error) setError(r.error);
      else {
        toast("Booking added");
        onClose();
      }
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="New booking" subtitle="Add an appointment to the calendar.">
      <form action={submit} className="space-y-5">
        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Service</span>
          <div className="grid gap-2 p-0.5">
            {services.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => setServiceId(s.id)}
                className={cn(
                  "flex items-center gap-3 rounded-[12px] bg-surface px-3.5 py-2.5 text-left transition",
                  serviceId === s.id ? "ring-2 ring-accent" : "hairline hover:bg-surface-2",
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-[15px] font-medium">{s.name}</span>
                <span className="text-[13px] text-label-2">{formatDuration(s.duration_minutes)} · {formatMoney(s.price_cents, org.currency)}</span>
              </button>
            ))}
            {services.length === 0 && <Notice tone="blue">Create a service first.</Notice>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Time">
            <Select value={time} onChange={(e) => setTime(e.target.value)}>
              {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>

        {locations.length > 1 && (
          <Field label="Location">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        )}

        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">With</span>
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {members.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setMemberId(m.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-[14px] font-medium transition",
                  memberId === m.id ? "bg-accent text-white" : "bg-surface-2 text-label",
                )}
              >
                <Avatar name={m.display_name} color={m.color} size={26} />
                {m.display_name}
              </button>
            ))}
          </div>
        </div>

        {selectedService && selectedService.address_mode !== "off" && (
          <Field label={selectedService.address_mode === "required" ? "Service address" : "Service address (optional)"} hint="Where the team goes.">
            <AddressInput name="customer_address" currency={org.currency} required={selectedService.address_mode === "required"} placeholder="Start typing the address" />
          </Field>
        )}
        {selectedService && selectedService.address_mode !== "off" && (
          <Field label="Unit, apartment or suite (optional)">
            <Input name="customer_unit" maxLength={30} placeholder="e.g. Apt 4B" />
          </Field>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="px-1 text-[13px] font-medium text-label-2">Customer</span>
            {customers.length > 0 && (
              <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "existing", label: "Existing" }, { value: "new", label: "New" }]} />
            )}
          </div>
          {mode === "existing" ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-label-3" />
                <Input className="pl-9" placeholder="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="overflow-hidden rounded-[12px] hairline divide-y divide-separator">
                {filtered.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setCustomerId(c.id)}
                    className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition", customerId === c.id ? "bg-accent-soft" : "hover:bg-surface-2")}
                  >
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
              {selectedCustomer && (
                selectedCustomer.sms_consent_at ? (
                  <p className="px-1 text-[13px] text-label-3">{selectedCustomer.name} has agreed to text messages.</p>
                ) : selectedCustomer.phone ? (
                  <label className="flex cursor-pointer items-start gap-2.5 px-1 text-[13px] leading-snug text-label-2">
                    <input type="checkbox" name="sms_consent" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                    <span>{selectedCustomer.name} agreed to receive text messages about this booking.</span>
                  </label>
                ) : (
                  <p className="px-1 text-[13px] text-label-3">No phone number on file for {selectedCustomer.name}, so no texts will be sent.</p>
                )
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="customer_name" placeholder="Full name" className="sm:col-span-2" />
              <Input name="customer_email" type="email" placeholder="Email" />
              <Input name="customer_phone" type="tel" placeholder="Phone (optional)" />
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-label-2 sm:col-span-2">
                <input type="checkbox" name="sms_consent" defaultChecked className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                <span>The customer agreed to receive text messages about this booking.</span>
              </label>
            </div>
          )}
        </div>

        <Field label="Notes">
          <Textarea name="notes" placeholder="Anything the team should know" className="min-h-16" />
        </Field>

        <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-4 py-3">
          <div>
            <div className="text-[15px] font-medium">Send confirmation</div>
            <div className="text-[13px] text-label-2">Email the customer the details.</div>
          </div>
          <Switch name="notify" defaultChecked />
        </div>

        {error && <Notice>{error}</Notice>}
        <Button type="submit" size="lg" pill className="w-full" loading={pending} disabled={!serviceId || !memberId}>
          Add booking
        </Button>
      </form>
    </Sheet>
  );
}
