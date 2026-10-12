"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare, Plus, ChevronRight, CheckCircle2, XCircle, Clock } from "lucide-react";
import { PageHeader, EmptyState, Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { describeTrigger, STARTERS, type Channel, type Trigger } from "@/lib/workflow-defaults";
import { setWorkflowActive } from "./actions";

export interface WorkflowSummary {
  id: string;
  name: string;
  trigger: Trigger;
  offset_minutes: number;
  active: boolean;
  all_services: boolean;
  default_key: string | null;
  steps: { channel: Channel; enabled: boolean }[];
  services: { service_id: string }[];
}
export interface LogRow {
  id: string;
  workflow_name: string;
  channel: Channel;
  recipient: string;
  status: "sending" | "sent" | "failed";
  detail: string | null;
  created_at: string;
}

export function WorkflowsView({
  slug, timezone, workflows, log, tab: initialTab, emailReady, smsReady,
}: {
  slug: string; timezone: string; workflows: WorkflowSummary[]; log: LogRow[]; tab: "workflows" | "activity"; emailReady: boolean; smsReady: boolean;
}) {
  const [tab, setTab] = useState(initialTab);
  const [picking, setPicking] = useState(false);

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle="The emails and texts your customers get, written your way."
        actions={<Button pill onClick={() => setPicking(true)}><Plus className="size-4" strokeWidth={2.5} /> New workflow</Button>}
      />

      <div className="max-w-3xl space-y-5">
        {!emailReady && <Notice tone="blue">Email isn&apos;t set up on this server yet, so emails can&apos;t be sent. Add RESEND_API_KEY and EMAIL_FROM to turn it on.</Notice>}
        {!smsReady && <Notice tone="blue">Texting isn&apos;t set up on this server yet. You can still write texts; they send once Twilio is connected.</Notice>}

        <Segmented value={tab} onChange={setTab} options={[{ value: "workflows", label: "Workflows" }, { value: "activity", label: "Activity" }]} />

        {tab === "workflows" ? (
          workflows.length === 0 ? (
            <EmptyState icon={<Mail className="size-7" />} title="No workflows yet" body="Create one to send customers a message when something happens to their booking." />
          ) : (
            <ul className="space-y-3">
              {workflows.map((w) => <WorkflowRow key={w.id} slug={slug} w={w} />)}
            </ul>
          )
        ) : (
          <Activity log={log} timezone={timezone} />
        )}
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)} title="New workflow" subtitle="Start from an idea, then change anything.">
        <div className="space-y-2">
          {STARTERS.map((s) => (
            <Link key={s.id} href={`/o/${slug}/workflows/new?starter=${s.id}`} className="flex items-center gap-3 rounded-[14px] bg-surface-2 p-4 transition hover:bg-surface-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{s.label}</div>
                <div className="text-[13px] text-label-2">{s.hint}</div>
              </div>
              <ChevronRight className="size-4 text-label-3" />
            </Link>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function WorkflowRow({ slug, w }: { slug: string; w: WorkflowSummary }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [active, setActive] = useState(w.active);
  const channels = [...new Set(w.steps.filter((s) => s.enabled).map((s) => s.channel))];

  return (
    <li className={cn("flex items-center gap-3 rounded-[18px] bg-surface p-4 shadow-sm hairline transition hover:shadow-md", !active && "opacity-70")}>
      <Link href={`/o/${slug}/workflows/${w.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[16px] font-semibold">{w.name}</h3>
            {w.default_key && <Badge>Built in</Badge>}
          </div>
          <p className="mt-0.5 text-[14px] text-label-2">{describeTrigger(w.trigger, w.offset_minutes)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-label-3">
            {channels.includes("email") && <span className="inline-flex items-center gap-1"><Mail className="size-3.5" /> Email</span>}
            {channels.includes("sms") && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" /> Text</span>}
            {channels.length === 0 && <span>All messages off</span>}
            <span>{w.all_services ? "All services" : `${w.services.length} service${w.services.length === 1 ? "" : "s"}`}</span>
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-label-3" />
      </Link>
      <Switch
        checked={active}
        disabled={pending}
        label={`${w.name} on or off`}
        onChange={(v) => {
          setActive(v);
          start(async () => {
            const r = await setWorkflowActive(slug, w.id, v);
            if (r.error) { setActive(!v); toast(r.error, "error"); } else router.refresh();
          });
        }}
      />
    </li>
  );
}

function Activity({ log, timezone }: { log: LogRow[]; timezone: string }) {
  if (log.length === 0) {
    return <EmptyState icon={<Clock className="size-7" />} title="Nothing sent yet" body="Messages appear here as your workflows send them, so you can see what each customer received." />;
  }
  return (
    <ul className="divide-y divide-separator overflow-hidden rounded-[18px] bg-surface shadow-sm hairline">
      {log.map((m) => (
        <li key={m.id} className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5">
            {m.status === "sent" ? <CheckCircle2 className="size-5 text-green" /> : m.status === "failed" ? <XCircle className="size-5 text-red" /> : <Clock className="size-5 text-label-3" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">{m.workflow_name}</div>
            <div className="truncate text-[13px] text-label-2">
              {m.channel === "email" ? "Email" : "Text"} to {m.recipient}
            </div>
            {m.status === "failed" && m.detail && <div className="mt-0.5 text-[12px] text-red">{m.detail}</div>}
          </div>
          <div className="shrink-0 text-right text-[12px] text-label-3">{formatDateTime(m.created_at, timezone)}</div>
        </li>
      ))}
    </ul>
  );
}
