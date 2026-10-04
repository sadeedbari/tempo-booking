"use client";
import { useState, useTransition } from "react";
import { Check, CreditCard, Mail, MessageSquare, ExternalLink } from "lucide-react";
import { PageHeader, Notice, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PALETTE } from "@/lib/utils";
import { allTimeZones, CURRENCIES } from "@/lib/timezones";
import type { Location, Membership, Organization } from "@/lib/types";
import { LocationsSection } from "./locations";
import { connectStripe, deleteOrg, updateOrg } from "../actions";

export function SettingsView({
  slug, org, isAdmin, isOwner, features, stripeStatus, locations, locationStaff, members,
}: {
  slug: string; org: Organization; locations: Location[]; locationStaff: Record<string, string[]>; members: Membership[]; isAdmin: boolean; isOwner: boolean;
  features: { payments: boolean; email: boolean; sms: boolean }; stripeStatus?: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accent, setAccent] = useState(org.accent_color);
  const [confirmDelete, setConfirmDelete] = useState("");

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Settings" />
        <Notice tone="blue">Only owners and admins can change team settings. You can update your own profile and hours from Team and Availability.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your business, booking rules and integrations." />
      <div className="max-w-3xl space-y-10">
        <form
          action={(fd) => {
            fd.set("accent_color", accent);
            start(async () => {
              const r = await updateOrg(slug, fd);
              if (r?.error) setError(r.error); else { setError(null); toast("Settings saved"); }
            });
          }}
          className="space-y-10"
        >
          <Section title="Business" description="Shown on your booking page and in emails.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input name="name" defaultValue={org.name} required /></Field>
              <Field label="Booking link" hint={`/${org.slug}`}><Input name="slug" defaultValue={org.slug} required /></Field>
              <Field label="About" className="sm:col-span-2"><Textarea name="description" defaultValue={org.description ?? ""} placeholder="A sentence or two about what you do." className="min-h-20" /></Field>
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={org.phone ?? ""} /></Field>
              <Field label="Website"><Input name="website" defaultValue={org.website ?? ""} placeholder="https://" /></Field>
              <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={org.address ?? ""} /></Field>
              <Field label="Time zone">
                <Select name="timezone" defaultValue={org.timezone}>
                  {allTimeZones().map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                </Select>
              </Field>
              <Field label="Currency">
                <Select name="currency" defaultValue={org.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
              </Field>
            </div>
            <div className="mt-5 space-y-2">
              <span className="px-1 text-[13px] font-medium text-label-2">Brand colour</span>
              <div className="flex flex-wrap gap-2.5">
                {PALETTE.map((c) => (
                  <button type="button" key={c} onClick={() => setAccent(c)} className="grid size-9 place-items-center rounded-full transition-transform active:scale-90" style={{ background: c }}>
                    {accent.toLowerCase() === c.toLowerCase() && <Check className="size-4 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Booking rules" description="Control when customers can book and cancel.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum notice">
                <Select name="min_notice_minutes" defaultValue={org.min_notice_minutes}>
                  {[[0, "None"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [720, "12 hours"], [1440, "1 day"], [2880, "2 days"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Book up to">
                <Select name="max_advance_days" defaultValue={org.max_advance_days}>
                  {[7, 14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
                </Select>
              </Field>
              <Field label="Time slot spacing">
                <Select name="slot_interval_minutes" defaultValue={org.slot_interval_minutes}>
                  {[5, 10, 15, 20, 30, 60].map((d) => <option key={d} value={d}>Every {d} minutes</option>)}
                </Select>
              </Field>
              <Field label="Customers can cancel or reschedule until">
                <Select name="cancellation_window_hours" defaultValue={org.cancellation_window_hours}>
                  {[[0, "Any time"], [2, "2 hours before"], [12, "12 hours before"], [24, "24 hours before"], [48, "48 hours before"], [72, "3 days before"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Send reminder">
                <Select name="reminder_hours_before" defaultValue={org.reminder_hours_before}>
                  {[[0, "Don't send"], [2, "2 hours before"], [12, "12 hours before"], [24, "24 hours before"], [48, "48 hours before"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            </div>
          </Section>

          {error && <Notice>{error}</Notice>}
          <div className="sticky bottom-20 z-10 flex justify-end lg:bottom-6">
            <Button type="submit" pill size="lg" loading={pending} className="shadow-lg">Save changes</Button>
          </div>
        </form>

        <LocationsSection slug={slug} locations={locations} staffMap={locationStaff} members={members.filter((m) => m.bookable)} />

        <Section title="Payments" description="Take deposits when customers book. Funds go straight to your Stripe account.">
          <div className="flex flex-wrap items-center gap-4 rounded-[16px] bg-surface p-5 shadow-sm hairline">
            <div className="grid size-12 place-items-center rounded-[13px] bg-gradient-to-b from-[#7A73FF] to-[#635BFF] text-white"><CreditCard className="size-6" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[16px] font-semibold">
                Stripe {org.stripe_charges_enabled ? <Badge tone="green">Connected</Badge> : org.stripe_account_id ? <Badge tone="orange">Setup incomplete</Badge> : null}
              </div>
              <div className="text-[14px] text-label-2">
                {!features.payments ? "Add STRIPE_SECRET_KEY to the server environment to enable payments." : org.stripe_charges_enabled ? "You're ready to accept deposits." : "Connect your Stripe account to start collecting deposits."}
              </div>
            </div>
            {features.payments && (
              <Button variant={org.stripe_charges_enabled ? "gray" : "filled"} pill disabled={pending}
                onClick={() => start(async () => { const r = await connectStripe(slug); if (r?.error) toast(r.error, "error"); })}>
                {org.stripe_charges_enabled ? <>Manage <ExternalLink className="size-4" /></> : "Connect Stripe"}
              </Button>
            )}
          </div>
          {stripeStatus === "connected" && <div className="mt-3"><Notice tone="green">Stripe connected.</Notice></div>}
        </Section>

        <Section title="Notifications" description="Confirmations, cancellations and reminders sent to customers.">
          <div className="overflow-hidden rounded-[16px] bg-surface shadow-sm hairline divide-y divide-separator">
            <Integration icon={<Mail className="size-5" />} color="#007AFF" title="Email" on={features.email} hint="Powered by Resend — set RESEND_API_KEY and EMAIL_FROM." />
            <Integration icon={<MessageSquare className="size-5" />} color="#34C759" title="SMS" on={features.sms} hint="Powered by Twilio — set TWILIO_* variables." />
          </div>
        </Section>

        {isOwner && (
          <Section title="Danger zone" description="Deleting your team removes all services, bookings and customers. This can't be undone.">
            <div className="flex flex-wrap items-center gap-3 rounded-[16px] bg-surface p-5 shadow-sm hairline">
              <Input className="max-w-xs" placeholder={`Type "${org.slug}" to confirm`} value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
              <Button variant="destructive" disabled={confirmDelete !== org.slug || pending}
                onClick={() => start(async () => { const r = await deleteOrg(slug); if (r?.error) toast(r.error, "error"); })}>
                Delete team
              </Button>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[20px] font-semibold">{title}</h2>
      {description && <p className="mt-0.5 mb-4 text-[14px] text-label-2">{description}</p>}
      {children}
    </section>
  );
}

function Integration({ icon, color, title, on, hint }: { icon: React.ReactNode; color: string; title: string; on: boolean; hint: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="grid size-9 place-items-center rounded-[10px] text-white" style={{ background: color }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        <div className="truncate text-[13px] text-label-2">{hint}</div>
      </div>
      <Badge tone={on ? "green" : "gray"}>{on ? "Active" : "Not set up"}</Badge>
    </div>
  );
}
