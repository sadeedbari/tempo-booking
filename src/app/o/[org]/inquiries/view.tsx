"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Archive, CalendarPlus, Inbox, Mail, MessageSquareText, Phone, RotateCcw, Check, Trash2 } from "lucide-react";
import { PageHeader, EmptyState, Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import type { Inquiry, InquiryStatus } from "@/lib/types";
import { deleteInquiry, saveInquiryNote, setInquiryStatus } from "./actions";

const LABEL: Record<InquiryStatus, string> = { new: "New", handled: "Handled", archived: "Archived" };

export function InquiriesView({
  slug, orgName, timezone, isAdmin, enabled, inquiries,
}: {
  slug: string; orgName: string; timezone: string; isAdmin: boolean; enabled: boolean; inquiries: Inquiry[];
}) {
  const [tab, setTab] = useState<InquiryStatus>("new");
  const counts = useMemo(() => {
    const c: Record<InquiryStatus, number> = { new: 0, handled: 0, archived: 0 };
    for (const i of inquiries) c[i.status]++;
    return c;
  }, [inquiries]);
  const shown = inquiries.filter((i) => i.status === tab);

  return (
    <>
      <PageHeader title="Inquiries" subtitle="Questions people send from your website, before they book." />
      <div className="max-w-3xl space-y-5">
        {!enabled && (
          <Notice tone="blue">
            The contact form is turned off, so no new messages will arrive. Turn it on in <Link href={`/o/${slug}/settings`} className="underline">Settings</Link>.
          </Notice>
        )}
        <Segmented<InquiryStatus>
          value={tab}
          onChange={setTab}
          options={(["new", "handled", "archived"] as const).map((s) => ({ value: s, label: counts[s] ? `${LABEL[s]} (${counts[s]})` : LABEL[s] }))}
        />
        {shown.length === 0 ? (
          <EmptyState
            icon={tab === "new" ? <Inbox className="size-7" /> : <MessageSquareText className="size-7" />}
            title={tab === "new" ? "No new messages" : tab === "handled" ? "Nothing handled yet" : "Nothing archived"}
            body={tab === "new"
              ? `When someone sends a question from your website, it shows up here and you're notified. Add the contact form to your site from Settings, or share ${orgName}'s contact link.`
              : "Messages you move here will appear in this list."}
            action={tab === "new" ? <Link href={`/o/${slug}/settings#contact-form`} className="text-[15px] font-medium text-accent">Get the contact form</Link> : undefined}
          />
        ) : (
          <ul className="space-y-3">
            {shown.map((i) => <InquiryCard key={i.id} i={i} slug={slug} timezone={timezone} orgName={orgName} isAdmin={isAdmin} />)}
          </ul>
        )}
      </div>
    </>
  );
}

function InquiryCard({ i, slug, timezone, orgName, isAdmin }: { i: Inquiry; slug: string; timezone: string; orgName: string; isAdmin: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(i.note ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(i.note));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const noteChanged = note.trim() !== (i.note ?? "");

  const act = (fn: () => Promise<{ ok?: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast(r.error, "error");
      else toast(done);
    });

  const reply = `mailto:${encodeURIComponent(i.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Re: your message to ${orgName}`)}`;

  return (
    <li className="rounded-[18px] bg-surface p-5 shadow-sm hairline" data-testid="inquiry">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-semibold">{i.name}</h3>
            {i.service_name && <Badge tone="blue">{i.service_name}</Badge>}
          </div>
          <div className="mt-0.5 text-[13px] text-label-3">{formatDateTime(i.created_at, timezone)}</div>
        </div>
        <Badge tone={i.status === "new" ? "orange" : i.status === "handled" ? "green" : "gray"}>{LABEL[i.status]}</Badge>
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{i.message}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={reply} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-medium text-white transition hover:bg-accent-hover">
          <Mail className="size-4" /> Reply by email
        </a>
        {i.customer_id && i.status !== "archived" && (
          <Link
            href={`/o/${slug}/calendar?newFor=${i.customer_id}${i.service_id ? `&service=${i.service_id}` : ""}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-[14px] font-medium transition hover:bg-surface-3"
          >
            <CalendarPlus className="size-4" /> Create booking
          </Link>
        )}
        {i.phone && (
          <a href={`tel:${i.phone}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-[14px] font-medium transition hover:bg-surface-3">
            <Phone className="size-4" /> {i.phone}
          </a>
        )}
        <span className="text-[13px] text-label-3">{i.email}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-separator pt-3">
        {i.status !== "handled" && (
          <Button size="sm" variant="gray" disabled={pending} onClick={() => act(() => setInquiryStatus(slug, i.id, "handled"), "Marked as handled")}>
            <Check className="size-4" /> Mark handled
          </Button>
        )}
        {i.status !== "archived" && (
          <Button size="sm" variant="gray" disabled={pending} onClick={() => act(() => setInquiryStatus(slug, i.id, "archived"), "Archived")}>
            <Archive className="size-4" /> Archive
          </Button>
        )}
        {i.status !== "new" && (
          <Button size="sm" variant="gray" disabled={pending} onClick={() => act(() => setInquiryStatus(slug, i.id, "new"), "Moved back to New")}>
            <RotateCcw className="size-4" /> Reopen
          </Button>
        )}
        {!noteOpen && <button type="button" onClick={() => setNoteOpen(true)} className="min-h-10 px-2 text-[14px] font-medium text-accent">Add a note</button>}
        {isAdmin && !confirmingDelete && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmingDelete(true)}
            className="ml-auto inline-flex min-h-10 items-center gap-1 px-2 text-[13px] text-label-3 transition hover:text-red"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        )}
        {isAdmin && confirmingDelete && (
          <span className="ml-auto flex flex-wrap items-center gap-2" role="group" aria-label={`Delete the message from ${i.name}?`}>
            <span className="text-[13px] text-label-2">Delete this message for good?</span>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => act(() => deleteInquiry(slug, i.id), "Deleted")}>Yes, delete</Button>
            <Button size="sm" variant="gray" disabled={pending} onClick={() => setConfirmingDelete(false)}>Keep it</Button>
          </span>
        )}
      </div>

      {noteOpen && (
        <div className="mt-3 space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="A private note for your team" aria-label={`Private note for ${i.name}`} className="min-h-20" />
          {noteChanged && (
            <Button size="sm" disabled={pending} onClick={() => act(() => saveInquiryNote(slug, i.id, note), "Note saved")}>Save note</Button>
          )}
        </div>
      )}
    </li>
  );
}
