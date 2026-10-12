import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { env, features } from "@/lib/env";
import { ensureDefaultWorkflows } from "@/lib/messaging";
import { PageHeader, Notice } from "@/components/ui/misc";
import { WorkflowsView, type LogRow, type WorkflowSummary } from "./view";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage(props: PageProps<"/o/[org]/workflows">) {
  const { org: slug } = await props.params;
  const sp = await props.searchParams;
  const { org, isAdmin } = await getOrgContext(slug);
  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Workflows" />
        <Notice tone="blue">Only owners and admins can edit the messages sent to customers.</Notice>
      </>
    );
  }

  // First visit: create the built-in messages (confirmation, reminder, ...) so there is something to edit.
  if (env.supabaseServiceKey) await ensureDefaultWorkflows(org.id, org.reminder_hours_before);

  const supabase = await createClient();
  const [{ data: workflows }, { data: log }] = await Promise.all([
    supabase.from("workflows").select("id, name, trigger, offset_minutes, active, all_services, default_key, position, steps:workflow_steps(channel, enabled), services:workflow_services(service_id)").eq("org_id", org.id).order("position").order("created_at"),
    supabase.from("message_log").select("id, workflow_name, channel, recipient, status, detail, created_at").eq("org_id", org.id).order("created_at", { ascending: false }).limit(60),
  ]);

  return (
    <WorkflowsView
      slug={slug}
      timezone={org.timezone}
      workflows={(workflows ?? []) as unknown as WorkflowSummary[]}
      log={(log ?? []) as LogRow[]}
      tab={sp.tab === "activity" ? "activity" : "workflows"}
      emailReady={features.email}
      smsReady={features.sms}
    />
  );
}
