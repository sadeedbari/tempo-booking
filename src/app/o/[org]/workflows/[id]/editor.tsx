"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail, MessageSquare, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { finalizeSms, smsInfo } from "@/lib/sms";
import { renderEmail, renderText, sampleVars, VARIABLES } from "@/lib/templates";
import { describeTrigger, isTimed, LIMITS, TRIGGERS, type EditableStep, type EditableWorkflow } from "@/lib/workflow-defaults";
import { deleteWorkflow, restoreDefault, saveWorkflow, sendTestEmail } from "../actions";
import { useSafeTransition } from "@/components/ui/use-server-action";

type Business = { name: string; phone: string | null; accent: string };
type Focus = { step: number; field: "subject" | "body" };

const UNITS = [
  { value: 1, label: "minutes" },
  { value: 60, label: "hours" },
  { value: 1440, label: "days" },
];
/** 120 minutes -> { amount: 2, unit: 60 } */
function splitOffset(minutes: number) {
  const unit = minutes > 0 && minutes % 1440 === 0 ? 1440 : minutes > 0 && minutes % 60 === 0 ? 60 : 1;
  return { amount: minutes / unit, unit };
}

export function WorkflowEditor({
  slug, initial, services, business,
}: {
  slug: string; initial: EditableWorkflow; services: { id: string; name: string; color: string }[]; business: Business;
}) {
  const router = useRouter();
  const toast = useToast();
  const [w, setW] = useState<EditableWorkflow>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useSafeTransition(setError); // a failed request becomes an inline message, not the crash page
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [offset, setOffset] = useState(splitOffset(initial.offset_minutes));
  const focus = useRef<Focus>({ step: 0, field: "body" });
  const fields = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  const isNew = !initial.id;
  const timed = isTimed(w.trigger);
  const minutes = Math.max(0, Math.round(offset.amount || 0)) * offset.unit;

  const patchStep = (i: number, p: Partial<EditableStep>) => setW((cur) => ({ ...cur, steps: cur.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) }));

  /** Inserts a {{variable}} where the cursor is (in the subject or the message that was last clicked). */
  function insertVariable(step: number, key: string) {
    const f = focus.current.step === step ? focus.current.field : "body";
    const el = fields.current[`${step}-${f}`];
    const token = `{{${key}}}`;
    const cur = w.steps[step][f];
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    patchStep(step, { [f]: cur.slice(0, start) + token + cur.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveWorkflow(slug, { ...w, offset_minutes: timed ? minutes : 0 });
      if (r.error) return setError(r.error);
      toast("Workflow saved");
      if (isNew && r.id) router.replace(`/o/${slug}/workflows/${r.id}`);
      else router.refresh();
    });

  const remove = () =>
    start(async () => {
      if (!confirmDelete) return setConfirmDelete(true);
      const r = await deleteWorkflow(slug, w.id!);
      if (r.error) return setError(r.error);
      toast("Workflow deleted");
      router.push(`/o/${slug}/workflows`);
    });

  const restore = () =>
    start(async () => {
      const r = await restoreDefault(slug, w.id!);
      if (r.error) return setError(r.error);
      toast("Restored to the original wording");
      window.location.reload(); // reload so the editor shows the restored text
    });

  const toggleService = (id: string) =>
    setW((cur) => ({ ...cur, service_ids: cur.service_ids.includes(id) ? cur.service_ids.filter((x) => x !== id) : [...cur.service_ids, id] }));

  return (
    <div className="max-w-3xl pb-24">
      <Link href={`/o/${slug}/workflows`} className="mb-4 inline-flex min-h-10 items-center gap-1 text-[15px] font-medium text-accent">
        <ArrowLeft className="size-4" /> Workflows
      </Link>

      <div className="mb-6 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-bold leading-tight sm:text-[34px]">{isNew ? "New workflow" : w.name}</h1>
          <p className="mt-1 text-[15px] text-label-2">{describeTrigger(w.trigger, timed ? minutes : 0)}</p>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <span className="text-[13px] text-label-2">{w.active ? "On" : "Off"}</span>
          <Switch checked={w.active} onChange={(v) => setW({ ...w, active: v })} label="Workflow on or off" />
        </div>
      </div>

      <div className="space-y-6">
        {/* Name, trigger, timing */}
        <section className="space-y-4 rounded-[18px] bg-surface p-5 shadow-sm hairline">
          <Field label="Name">
            <Input value={w.name} maxLength={LIMITS.name} onChange={(e) => setW({ ...w, name: e.target.value })} />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Send when" hint={w.default_key ? "Built-in workflows keep their trigger." : undefined}>
              <Select
                value={w.trigger}
                disabled={!!w.default_key}
                onChange={(e) => {
                  const t = e.target.value as EditableWorkflow["trigger"];
                  setW({ ...w, trigger: t });
                  if (isTimed(t) && !offset.amount) setOffset({ amount: 1, unit: 60 });
                }}
              >
                {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>

            {timed && (
              <Field label={w.trigger === "before_start" ? "How long before" : "How long after it ends"}>
                <div className="flex gap-2">
                  <Input type="number" min={w.trigger === "before_start" ? 1 : 0} max={10080} inputMode="numeric" className="w-24" value={offset.amount} onChange={(e) => setOffset({ ...offset, amount: Number(e.target.value) })} />
                  <Select value={offset.unit} onChange={(e) => setOffset({ ...offset, unit: Number(e.target.value) })}>
                    {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </Select>
                </div>
              </Field>
            )}
          </div>
          {timed && <p className="text-[13px] text-label-3">Timed messages go out on the hour, so they can arrive up to an hour after the exact time.</p>}

          <div className="space-y-2">
            <span className="px-1 text-[13px] font-medium text-label-2">Applies to</span>
            <div className="flex gap-2">
              {[true, false].map((all) => (
                <button
                  type="button"
                  key={String(all)}
                  onClick={() => setW({ ...w, all_services: all })}
                  className={cn("h-10 rounded-full px-4 text-[14px] font-medium transition", w.all_services === all ? "bg-accent text-white" : "bg-surface-2 text-label-2 hover:text-label")}
                >
                  {all ? "All services" : "Selected services"}
                </button>
              ))}
            </div>
            {!w.all_services && (
              <div className="flex flex-wrap gap-2 pt-1">
                {services.length === 0 && <span className="text-[13px] text-label-3">Add a service first.</span>}
                {services.map((s) => {
                  const on = w.service_ids.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => toggleService(s.id)}
                      className={cn("flex h-10 items-center gap-2 rounded-full px-3.5 text-[14px] font-medium transition", on ? "bg-label text-canvas" : "bg-surface-2 text-label-2 hover:text-label")}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: s.color }} /> {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Messages */}
        {w.steps.map((s, i) => (
          <StepCard
            key={s.id ?? `new-${i}`}
            index={i}
            step={s}
            business={business}
            canRemove={w.steps.length > 1}
            register={(k, el) => { fields.current[k] = el; }}
            onFocus={(field) => (focus.current = { step: i, field })}
            onChange={(p) => patchStep(i, p)}
            onInsert={(key) => insertVariable(i, key)}
            onRemove={() => setW((cur) => ({ ...cur, steps: cur.steps.filter((_, j) => j !== i) }))}
            slug={slug}
          />
        ))}

        {w.steps.length < LIMITS.steps && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="gray" pill onClick={() => setW({ ...w, steps: [...w.steps, { channel: "email", subject: "", body: "Hi {{customer_first_name}},\n\n", enabled: true }] })}>
              <Plus className="size-4" /> <Mail className="size-4" /> Add an email
            </Button>
            <Button type="button" variant="gray" pill onClick={() => setW({ ...w, steps: [...w.steps, { channel: "sms", subject: "", body: "{{business_name}}: ", enabled: true }] })}>
              <Plus className="size-4" /> <MessageSquare className="size-4" /> Add a text
            </Button>
          </div>
        )}

        {error && <Notice>{error}</Notice>}

        <div className="flex flex-wrap items-center gap-2 border-t border-separator pt-5">
          {w.default_key && (
            <Button type="button" variant="gray" onClick={restore} disabled={pending}>Restore original wording</Button>
          )}
          {!isNew && !w.default_key && (
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              <Trash2 className="size-4" /> {confirmDelete ? "Tap to confirm" : "Delete"}
            </Button>
          )}
          <Button type="button" pill size="lg" className="ml-auto" loading={pending} onClick={save}>Save workflow</Button>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  index, step, business, canRemove, register, onFocus, onChange, onInsert, onRemove, slug,
}: {
  index: number; step: EditableStep; business: Business; canRemove: boolean; slug: string;
  register: (key: string, el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onFocus: (f: "subject" | "body") => void;
  onChange: (p: Partial<EditableStep>) => void;
  onInsert: (key: string) => void;
  onRemove: () => void;
}) {
  const toast = useToast();
  const [sending, start] = useSafeTransition((m) => toast(m, "error")); // a failed request becomes an inline message, not the crash page
  const isEmail = step.channel === "email";
  const vars = useMemo(() => ({ ...sampleVars(), business_name: business.name, business_phone: business.phone ?? "" }), [business]);

  const email = useMemo(() => (isEmail ? renderEmail({ subject: step.subject || "(no subject yet)", body: step.body, vars, accent: business.accent, phone: business.phone }) : null), [isEmail, step.subject, step.body, vars, business]);
  const sms = useMemo(() => (isEmail ? null : finalizeSms(renderText(step.body, vars))), [isEmail, step.body, vars]);
  const info = sms ? smsInfo(sms) : null;
  const chips = VARIABLES.filter((v) => isEmail || !("emailOnly" in v));
  const Icon = isEmail ? Mail : MessageSquare;
  const max = isEmail ? LIMITS.email : LIMITS.sms;

  return (
    <section className={cn("rounded-[18px] bg-surface p-5 shadow-sm hairline", !step.enabled && "opacity-70")}>
      <div className="mb-4 flex items-center gap-3">
        <span className={cn("grid size-9 place-items-center rounded-[10px] text-white", isEmail ? "bg-accent" : "bg-green")}><Icon className="size-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">{isEmail ? "Email" : "Text message"} to the customer</div>
          {!isEmail && <div className="text-[12px] text-label-3">Only sent to customers who agreed to texts.</div>}
        </div>
        <Switch checked={step.enabled} onChange={(v) => onChange({ enabled: v })} label={`Message ${index + 1} on or off`} />
        {canRemove && (
          <button type="button" onClick={onRemove} aria-label="Remove this message" className="grid size-10 place-items-center rounded-full text-label-3 hover:bg-red-soft hover:text-red">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      <div className="space-y-4">
        {isEmail && (
          <Field label="Subject">
            <Input
              ref={(el) => register(`${index}-subject`, el)}
              value={step.subject}
              maxLength={LIMITS.subject}
              onFocus={() => onFocus("subject")}
              onChange={(e) => onChange({ subject: e.target.value })}
              placeholder="Confirmed: {{service_name}}"
            />
          </Field>
        )}

        <Field label="Message">
          <Textarea
            ref={(el) => register(`${index}-body`, el)}
            value={step.body}
            rows={isEmail ? 10 : 5}
            maxLength={max}
            onFocus={() => onFocus("body")}
            onChange={(e) => onChange({ body: e.target.value })}
            className="min-h-32 font-[inherit] leading-relaxed"
          />
        </Field>

        <div>
          <div className="mb-1.5 px-1 text-[13px] font-medium text-label-2">Insert</div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((v) => (
              <button
                type="button"
                key={v.key}
                onMouseDown={(e) => e.preventDefault()} // keep the cursor where it was
                onClick={() => onInsert(v.key)}
                className="h-9 rounded-full bg-surface-2 px-3 text-[13px] font-medium text-label-2 transition hover:bg-accent-soft hover:text-accent"
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div>
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-[13px] font-medium text-label-2">Preview with sample details</span>
            {isEmail ? (
              <Button
                type="button"
                size="sm"
                variant="gray"
                loading={sending}
                onClick={() =>
                  start(async () => {
                    const r = await sendTestEmail(slug, { subject: step.subject, body: step.body });
                    if (r.error) toast(r.error, "error"); else toast("Test email sent to you");
                  })
                }
              >
                <Send className="size-3.5" /> Send test to me
              </Button>
            ) : (
              info && (
                <span className={cn("text-[12px]", info.segments > 2 ? "font-medium text-orange" : "text-label-3")}>
                  {info.segments} message{info.segments === 1 ? "" : "s"} · {info.length} characters
                </span>
              )
            )}
          </div>

          {email ? (
            <div className="overflow-hidden rounded-[14px] bg-surface-2">
              <div className="border-b border-separator px-3.5 py-2 text-[13px]"><span className="text-label-3">Subject: </span><span className="font-medium">{email.subject}</span></div>
              <iframe title="Email preview" sandbox="" srcDoc={email.html} className="h-[420px] w-full border-0 bg-[#f5f5f7]" />
            </div>
          ) : (
            <div className="rounded-[14px] bg-surface-2 p-4">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-bl-[6px] bg-surface px-3.5 py-2.5 text-[14px] leading-snug shadow-sm">{sms}</div>
              <p className="mt-2 text-[12px] text-label-3">
                &ldquo;Reply STOP to opt out.&rdquo; is added automatically. {info?.unicode && "Special characters make each message shorter, so it may cost more."}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
