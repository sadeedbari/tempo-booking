"use server";
import { friendlyDbError } from "@/lib/db-errors";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext, getUser } from "@/lib/auth";
import { planBlockMessage } from "@/lib/billing-server";
import { sendEmail } from "@/lib/messaging";
import { emailOnlyVariables, renderEmail, sampleVars, unknownVariables } from "@/lib/templates";
import { DEFAULT_WORKFLOWS, LIMITS, isTimed, type EditableWorkflow } from "@/lib/workflow-defaults";

type Result = { ok?: boolean; error?: string; id?: string };

async function adminCtx(slug: string) {
  const ctx = await getOrgContext(slug);
  if (!ctx.isAdmin) throw new Error("Only owners and admins can edit workflows.");
  // Every workflow action changes something or sends a message: without an active plan say so plainly instead of
  // silently changing nothing.
  const blocked = await planBlockMessage(await createClient(), ctx.org.id, ctx.isOwner);
  if (blocked) throw new Error(blocked);
  return ctx;
}

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the workflow a name").max(LIMITS.name),
  trigger: z.enum(["booking_confirmed", "booking_requested", "booking_declined", "booking_cancelled", "booking_rescheduled", "before_start", "after_end", "inquiry_received"]),
  offset_minutes: z.number().int().min(0).max(10080),
  active: z.boolean(),
  all_services: z.boolean(),
  service_ids: z.array(z.string().uuid()).max(200),
  steps: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        channel: z.enum(["email", "sms"]),
        subject: z.string().max(LIMITS.subject),
        body: z.string().trim().min(1, "Every message needs some text"),
        enabled: z.boolean(),
      }),
    )
    .min(1, "Add at least one message")
    .max(LIMITS.steps, `A workflow can have up to ${LIMITS.steps} messages`),
});

/** Problems with the wording of the messages themselves, as a sentence for the person editing. */
function checkSteps(steps: z.infer<typeof schema>["steps"]): string | null {
  for (const [i, s] of steps.entries()) {
    const n = `Message ${i + 1}`;
    const bad = unknownVariables(s.subject + " " + s.body);
    if (bad.length) return `${n}: {{${bad[0]}}} isn't a variable. Use the buttons above the message to insert one.`;
    if (s.channel === "email" && !s.subject.trim()) return `${n}: add a subject line.`;
    if (s.channel === "email" && s.body.length > LIMITS.email) return `${n}: keep emails under ${LIMITS.email} characters.`;
    if (s.channel === "sms") {
      if (s.body.length > LIMITS.sms) return `${n}: keep texts under ${LIMITS.sms} characters (about 3 messages).`;
      const emailOnly = emailOnlyVariables(s.body);
      if (emailOnly.includes("answers")) return `${n}: the booking answers only work in emails.`;
      if (emailOnly.length) return `${n}: buttons only work in emails. Use the link instead.`;
    }
  }
  return null;
}

export async function saveWorkflow(slug: string, input: EditableWorkflow): Promise<Result> {
  try {
    const { org } = await adminCtx(slug);
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const problem = checkSteps(v.steps);
    if (problem) return { error: problem };
    if (!v.all_services && v.service_ids.length === 0) return { error: "Choose at least one service, or apply it to all services." };

    const supabase = await createClient();
    let id = v.id;
    let trigger = v.trigger;

    if (id) {
      const { data: current } = await supabase.from("workflows").select("id, trigger, default_key").eq("id", id).eq("org_id", org.id).single();
      if (!current) return { error: "Workflow not found." };
      if (current.default_key) trigger = current.trigger; // built-in workflows keep their trigger
    } else {
      const { count } = await supabase.from("workflows").select("id", { count: "exact", head: true }).eq("org_id", org.id);
      if ((count ?? 0) >= LIMITS.workflows) return { error: `You can have up to ${LIMITS.workflows} workflows.` };
    }
    const offset = isTimed(trigger) ? v.offset_minutes : 0;
    if (trigger === "before_start" && offset < 5) return { error: "A reminder needs to be at least 5 minutes before the appointment." };

    const row = { org_id: org.id, name: v.name, trigger, offset_minutes: offset, active: v.active, all_services: v.all_services, updated_at: new Date().toISOString() };
    if (id) {
      const { error } = await supabase.from("workflows").update(row).eq("id", id).eq("org_id", org.id);
      if (error) return { error: friendlyDbError(error)! };
    } else {
      const { data, error } = await supabase.from("workflows").insert({ ...row, position: 100 }).select("id").single();
      if (error) return { error: friendlyDbError(error)! };
      id = data.id as string;
    }

    // Keep each message's id stable when it is edited: "already sent" records are tied to it,
    // so replacing it would re-send reminders that already went out.
    const { data: existing } = await supabase.from("workflow_steps").select("id").eq("workflow_id", id);
    const keep = new Set(v.steps.map((s) => s.id).filter(Boolean) as string[]);
    const removed = (existing ?? []).map((s) => s.id as string).filter((x) => !keep.has(x));
    if (removed.length) await supabase.from("workflow_steps").delete().in("id", removed);
    for (const [position, s] of v.steps.entries()) {
      const stepRow = { workflow_id: id, org_id: org.id, channel: s.channel, subject: s.channel === "email" ? s.subject.trim() : "", body: s.body, enabled: s.enabled, position };
      const known = s.id && (existing ?? []).some((e) => e.id === s.id);
      const { error } = known ? await supabase.from("workflow_steps").update(stepRow).eq("id", s.id!) : await supabase.from("workflow_steps").insert(stepRow);
      if (error) return { error: friendlyDbError(error)! };
    }

    await supabase.from("workflow_services").delete().eq("workflow_id", id);
    if (!v.all_services) {
      const { error } = await supabase.from("workflow_services").insert(v.service_ids.map((service_id) => ({ workflow_id: id, service_id })));
      if (error) return { error: friendlyDbError(error)! };
    }
    revalidatePath(`/o/${slug}/workflows`, "layout");
    return { ok: true, id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteWorkflow(slug: string, id: string): Promise<Result> {
  try {
    const { org } = await adminCtx(slug);
    const supabase = await createClient();
    const { data: w } = await supabase.from("workflows").select("default_key").eq("id", id).eq("org_id", org.id).single();
    if (!w) return { error: "Workflow not found." };
    if (w.default_key) return { error: "Built-in workflows can't be deleted. Turn them off instead." };
    const { error } = await supabase.from("workflows").delete().eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendlyDbError(error)! };
    revalidatePath(`/o/${slug}/workflows`, "layout");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Puts a built-in workflow back to its original wording and timing. */
export async function restoreDefault(slug: string, id: string): Promise<Result> {
  try {
    const { org } = await adminCtx(slug);
    const supabase = await createClient();
    const { data: w } = await supabase.from("workflows").select("id, default_key").eq("id", id).eq("org_id", org.id).single();
    const def = DEFAULT_WORKFLOWS.find((d) => d.key === w?.default_key);
    if (!w || !def) return { error: "Only built-in workflows can be restored." };

    await supabase.from("workflows").update({ name: def.name, offset_minutes: def.offset_minutes, all_services: true, active: true, updated_at: new Date().toISOString() }).eq("id", id);
    await supabase.from("workflow_services").delete().eq("workflow_id", id);
    const { data: existing } = await supabase.from("workflow_steps").select("id, channel").eq("workflow_id", id).order("position");
    // Reuse existing message rows (same channel) so earlier "already sent" records stay valid.
    const pool = [...(existing ?? [])];
    const used = new Set<string>();
    for (const [position, s] of def.steps.entries()) {
      const i = pool.findIndex((p) => p.channel === s.channel && !used.has(p.id as string));
      const base = { workflow_id: id, org_id: org.id, channel: s.channel, subject: s.subject, body: s.body, enabled: true, position };
      if (i >= 0) {
        used.add(pool[i].id as string);
        await supabase.from("workflow_steps").update(base).eq("id", pool[i].id);
      } else {
        await supabase.from("workflow_steps").insert(base);
      }
    }
    const extra = pool.filter((p) => !used.has(p.id as string)).map((p) => p.id as string);
    if (extra.length) await supabase.from("workflow_steps").delete().in("id", extra);
    revalidatePath(`/o/${slug}/workflows`, "layout");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setWorkflowActive(slug: string, id: string, active: boolean): Promise<Result> {
  try {
    const { org } = await adminCtx(slug);
    const { error } = await (await createClient()).from("workflows").update({ active, updated_at: new Date().toISOString() }).eq("id", id).eq("org_id", org.id);
    if (error) return { error: friendlyDbError(error)! };
    revalidatePath(`/o/${slug}/workflows`, "layout");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Sends the email being edited to the person editing it, with sample booking details. */
export async function sendTestEmail(slug: string, input: { subject: string; body: string }): Promise<Result> {
  try {
    const { org } = await adminCtx(slug);
    const user = await getUser();
    if (!user?.email) return { error: "Please sign in again." };
    const bad = unknownVariables(input.subject + " " + input.body);
    if (bad.length) return { error: `{{${bad[0]}}} isn't a variable.` };
    if (input.body.length > LIMITS.email || input.subject.length > LIMITS.subject) return { error: "That message is too long." };
    const vars = { ...sampleVars(), business_name: org.name, business_phone: org.phone ?? "" };
    const e = renderEmail({ subject: input.subject || "(no subject)", body: input.body, vars, accent: org.accent_color, phone: org.phone });
    const r = await sendEmail({ to: user.email, businessName: org.name, subject: `[Test] ${e.subject}`, html: e.html, text: e.text });
    return r.ok ? { ok: true } : { error: r.error ?? "Couldn't send the test email." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
