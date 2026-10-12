"use client";
import { useState, useTransition } from "react";
import { Check, CreditCard, Mail, MessageSquare, ExternalLink } from "lucide-react";
import { PageHeader, Notice, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-class";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PushDeviceCard } from "@/components/app/push-device";
import { useToast } from "@/components/ui/toast";
import { PALETTE } from "@/lib/utils";
import { allTimeZones, CURRENCIES } from "@/lib/timezones";
import type { Location, Membership, Organization } from "@/lib/types";
import { LocationsSection } from "./locations";
import { EmbedSection } from "./embed";
import { deleteOrg, updateOrg } from "../actions";

export function SettingsView({
  slug, org, isAdmin, isOwner, features, stripeStatus, stripeReason, locations, locationStaff, members, appUrl, services, vapidKey,
}: {
  vapidKey: string;
  slug: string; org: Organization; appUrl: string; services: { slug: string; name: string }[]; locations: Location[]; locationStaff: Record<string, string[]>; members: Membership[]; isAdmin: boolean; isOwner: boolean;
  features: { payments: boolean; email: boolean; sms: boolean; push: boolean }; stripeStatus?: string; stripeReason?: string;
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
        <div className="max-w-3xl space-y-6">
          <Notice tone="blue">Only owners and admins can change team settings. You can update your own profile and hours from Team and Availability.</Notice>
          {vapidKey && <PushDeviceCard vapidKey={vapidKey} teamEnabled={org.notify_push} />}
        </div>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <button type="button" key={c} onClick={() => setAccent(c)} className="grid size-10 place-items-center rounded-full transition-transform active:scale-90" style={{ background: c }}>
                    {accent.toLowerCase() === c.toLowerCase() && <Check className="size-4 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Booking rules" description="Control when customers can book and cancel.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <Field label="Booking alerts for your team" hint="Push notification to owners, admins and the booked team member when a booking is made, requested, rescheduled or cancelled.">
                <div className="flex h-11 items-center gap-3">
                  <Switch name="notify_push" defaultChecked={org.notify_push} label="Booking alerts for your team" />
                  <span className="text-[14px] text-label-2">{features.push ? "On by default" : "Needs server setup (VAPID keys)"}</span>
                </div>
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

        <EmbedSection appUrl={appUrl} slug={org.slug} accent={org.accent_color} services={services} />

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
              // A full navigation: the owner leaves for Stripe and comes back to this page when done.
              <a
                href={`/api/stripe/connect?org=${encodeURIComponent(slug)}${org.stripe_charges_enabled ? "&manage=1" : ""}`}
                className={buttonClass(org.stripe_charges_enabled ? "gray" : "filled", "md", true)}
              >
                {org.stripe_charges_enabled ? <>Open Stripe dashboard <ExternalLink className="size-4" /></> : org.stripe_account_id ? "Continue setup" : "Connect Stripe"}
              </a>
            )}
          </div>
          {stripeStatus === "connected" && <div className="mt-3"><Notice tone="green">Stripe connected. You can now take deposits.</Notice></div>}
          {stripeStatus === "pending" && <div className="mt-3"><Notice tone="blue">Stripe still needs a few details before you can take deposits. Choose Continue setup to finish.</Notice></div>}
          {stripeStatus === "error" && (
            <div className="mt-3">
              <Notice>
                {stripeReason === "connect_disabled"
                  ? "Stripe Connect isn't turned on for the Stripe account behind this server's key yet. In the Stripe dashboard, open Settings → Connect and click Get started, then try again."
                  : stripeReason === "bad_key"
                    ? "Stripe rejected this server's secret key. Check that STRIPE_SECRET_KEY is the right key for the right mode (test or live), then redeploy."
                    : "We couldn't reach Stripe just now. Please try again in a moment."}
              </Notice>
            </div>
          )}
        </Section>

        <Section title="Notifications" description="Alerts for you and your team, and the messages sent to customers.">
          {vapidKey && <div className="mb-4"><PushDeviceCard vapidKey={vapidKey} teamEnabled={org.notify_push} /></div>}
          <h3 className="mb-2 text-[14px] font-medium text-label-2">Messages to customers</h3>
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
      <span className="grid size-10 place-items-center rounded-[10px] text-white" style={{ background: color }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        <div className="truncate text-[13px] text-label-2">{hint}</div>
      </div>
      <Badge tone={on ? "green" : "gray"}>{on ? "Active" : "Not set up"}</Badge>
    </div>
  );
}
