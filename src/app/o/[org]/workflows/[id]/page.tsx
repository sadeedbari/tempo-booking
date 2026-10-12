import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth";
import { PageHeader, Notice } from "@/components/ui/misc";
import { STARTERS, type EditableWorkflow, type Trigger, type Channel } from "@/lib/workflow-defaults";
import { WorkflowEditor } from "./editor";

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowPage(props: PageProps<"/o/[org]/workflows/[id]">) {
  const { org: slug, id } = await props.params;
  const sp = await props.searchParams;
  const { org, isAdmin } = await getOrgContext(slug);
  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Workflow" />
        <Notice tone="blue">Only owners and admins can edit the messages sent to customers.</Notice>
      </>
    );
  }

  const supabase = await createClient();
  const { data: services } = await supabase.from("services").select("id, name, color").eq("org_id", org.id).order("position").order("created_at");

  let initial: EditableWorkflow;
  if (id === "new") {
    const s = STARTERS.find((x) => x.id === sp.starter) ?? STARTERS[STARTERS.length - 1];
    initial = { name: s.name, trigger: s.trigger, offset_minutes: s.offset_minutes, active: true, all_services: true, service_ids: [], default_key: null, steps: s.steps.map((x) => ({ ...x, enabled: true })) };
  } else {
    if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
    const { data: w } = await supabase
      .from("workflows")
      .select("id, name, trigger, offset_minutes, active, all_services, default_key, steps:workflow_steps(id, channel, subject, body, enabled, position), services:workflow_services(service_id)")
      .eq("id", id)
      .eq("org_id", org.id)
      .single();
    if (!w) notFound();
    const steps = [...(w.steps as { id: string; channel: Channel; subject: string; body: string; enabled: boolean; position: number }[])].sort((a, b) => a.position - b.position);
    initial = {
      id: w.id as string,
      name: w.name as string,
      trigger: w.trigger as Trigger,
      offset_minutes: w.offset_minutes as number,
      active: w.active as boolean,
      all_services: w.all_services as boolean,
      service_ids: (w.services as { service_id: string }[]).map((s) => s.service_id),
      default_key: (w.default_key as string | null) ?? null,
      steps: steps.map((s) => ({ id: s.id, channel: s.channel, subject: s.subject, body: s.body, enabled: s.enabled })),
    };
  }

  return (
    <WorkflowEditor
      slug={slug}
      initial={initial}
      services={(services ?? []) as { id: string; name: string; color: string }[]}
      business={{ name: org.name, phone: org.phone, accent: org.accent_color }}
    />
  );
}
