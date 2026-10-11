"use client";
import { useMemo, useState, useTransition } from "react";
import { Contact, Plus, Search } from "lucide-react";
import { PageHeader, EmptyState, Avatar, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatMoney } from "@/lib/format";
import type { Customer, Organization } from "@/lib/types";
import { deleteCustomer, saveCustomer } from "../actions";

export function CustomersView({
  slug, org, customers, stats, canDelete,
}: {
  slug: string; org: Organization; canDelete: boolean; customers: Customer[]; stats: Record<string, { visits: number; last: string | null; spent: number }>;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return customers.filter((c) => !t || c.name.toLowerCase().includes(t) || c.email.includes(t) || c.phone?.includes(t));
  }, [customers, q]);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} ${customers.length === 1 ? "person" : "people"}`}
        actions={<Button pill onClick={() => { setError(null); setConfirmDelete(false); setEditing({}); }}><Plus className="size-4" strokeWidth={2.5} /> Add</Button>}
      />
      <div className="relative mb-5 max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-label-3" />
        <Input className="pl-9" placeholder="Search by name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<Contact className="size-7" />} title="No customers yet" body="Customers are added automatically when someone books." />
      ) : (
        <div className="overflow-hidden rounded-[16px] bg-surface shadow-sm hairline divide-y divide-separator">
          {list.map((c) => {
            const s = stats[c.id];
            return (
              <button key={c.id} onClick={() => { setError(null); setConfirmDelete(false); setEditing(c); }} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2">
                <Avatar name={c.name} size={36} color="#8E8E93" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{c.name}</div>
                  <div className="truncate text-[13px] text-label-2">{c.email}{c.phone ? ` · ${c.phone}` : ""}</div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-[14px]">{s?.visits ?? 0} visit{s?.visits === 1 ? "" : "s"}</div>
                  <div className="text-[12px] text-label-3">{s?.last ? `Last ${formatDate(s.last, org.timezone, { weekday: undefined })}` : "No visits"}</div>
                </div>
                <div className="hidden w-20 text-right text-[14px] text-label-2 md:block">{s?.spent ? formatMoney(s.spent, org.currency) : "—"}</div>
              </button>
            );
          })}
        </div>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? editing.name : "New customer"}>
        {editing && (
          <form
            action={(fd) =>
              start(async () => {
                const r = await saveCustomer(slug, fd);
                if (r.error) setError(r.error);
                else { toast("Customer saved"); setEditing(null); }
              })
            }
            className="space-y-4"
          >
            <input type="hidden" name="id" value={editing.id ?? ""} />
            <Field label="Name"><Input name="name" defaultValue={editing.name} required /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={editing.email} required /></Field>
            <PhoneWithConsent initialPhone={editing.phone ?? ""} consentAt={editing.sms_consent_at ?? null} timeZone={org.timezone} />
            <Field label="Private notes" hint="Only your team can see these."><Textarea name="notes" defaultValue={editing.notes ?? ""} /></Field>
            {error && <Notice>{error}</Notice>}
            <Button type="submit" size="lg" pill className="w-full" loading={pending}>Save</Button>
            {canDelete && editing.id && (
              <div className="space-y-2 border-t border-separator pt-4">
                {confirmDelete && (
                  <p className="text-[13px] text-label-2">
                    This permanently removes {editing.name}&apos;s details. Their past bookings stay in your records but no longer show who they were. This can&apos;t be undone.
                  </p>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  disabled={pending}
                  onClick={() => {
                    if (!confirmDelete) return setConfirmDelete(true);
                    start(async () => {
                      const r = await deleteCustomer(slug, editing.id!);
                      if (r.error) setError(r.error);
                      else { toast("Customer deleted"); setEditing(null); }
                    });
                  }}
                >
                  {confirmDelete ? "Tap again to delete" : "Delete customer"}
                </Button>
              </div>
            )}
          </form>
        )}
      </Sheet>
    </>
  );
}

/** Phone field with the text-message consent checkbox, shown once a number is entered. */
function PhoneWithConsent({ initialPhone, consentAt, timeZone }: { initialPhone: string; consentAt: string | null; timeZone: string }) {
  const [phone, setPhone] = useState(initialPhone);
  return (
    <>
      <Field label="Phone" hint="Optional. Any format works, we'll tidy it up.">
        <Input name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {phone.trim().length > 0 && (
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-label-2">
          <input type="checkbox" name="sms_consent" defaultChecked={consentAt ? true : initialPhone === ""} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
          <span>
            This customer agreed to receive text messages about their bookings.
            {consentAt && <span className="block text-label-3">Agreed on {formatDate(consentAt, timeZone, { weekday: undefined, year: "numeric" })}. Untick to stop texting them.</span>}
          </span>
        </label>
      )}
    </>
  );
}
