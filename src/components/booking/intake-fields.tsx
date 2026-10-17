"use client";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { ServiceQuestion } from "@/lib/types";

/** The form field name for a question's answer. */
const fieldName = (q: ServiceQuestion) => `q_${q.id}`;

/** The service's intake questions, as part of the booking form. Required ones use the browser's own checks. */
export function IntakeFields({ questions }: { questions: ServiceQuestion[] }) {
  if (!questions.length) return null;
  return (
    <div className="space-y-4 sm:col-span-2" data-testid="intake-questions">
      <div className="border-t border-separator pt-4 text-[13px] font-medium text-label-2">A few questions</div>
      {questions.map((q) => (
        <Question key={q.id} q={q} />
      ))}
    </div>
  );
}

function Question({ q }: { q: ServiceQuestion }) {
  const name = fieldName(q);
  const label = q.required ? q.label : `${q.label} (optional)`;

  if (q.type === "text") {
    return <Field label={label} hint={q.help_text ?? undefined}><Input name={name} required={q.required} maxLength={300} /></Field>;
  }
  if (q.type === "paragraph") {
    return <Field label={label} hint={q.help_text ?? undefined}><Textarea name={name} required={q.required} maxLength={2000} className="min-h-20" /></Field>;
  }
  if (q.type === "date") {
    return <Field label={label} hint={q.help_text ?? undefined}><Input name={name} type="date" required={q.required} /></Field>;
  }
  if (q.type === "choice") {
    return (
      <Field label={label} hint={q.help_text ?? undefined}>
        <Select name={name} required={q.required} defaultValue="">
          <option value="">{q.required ? "Choose…" : "No answer"}</option>
          {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </Field>
    );
  }
  // Groups of tick boxes and yes/no buttons: a fieldset with a visible legend.
  return (
    <fieldset className="space-y-2">
      <legend className="px-1 text-[13px] font-medium text-label-2">{q.type === "agree" ? "" : label}</legend>
      {q.help_text && q.type !== "agree" && <p className="px-1 text-[12px] text-label-3">{q.help_text}</p>}
      {q.type === "multi" && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {q.options.map((o) => (
            <label key={o} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[11px] bg-surface-2 px-3.5 text-[15px]">
              <input type="checkbox" name={name} value={o} className="size-[18px] shrink-0 accent-[var(--accent)]" />
              {o}
            </label>
          ))}
        </div>
      )}
      {q.type === "yes_no" && (
        <div className="flex gap-2">
          {["Yes", "No"].map((o) => (
            <label key={o} className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[11px] bg-surface-2 px-3.5 text-[15px] has-[:checked]:bg-accent has-[:checked]:text-white">
              <input type="radio" name={name} value={o} required={q.required} className="sr-only" />
              {o}
            </label>
          ))}
        </div>
      )}
      {q.type === "agree" && (
        <label className="flex cursor-pointer items-start gap-2.5 text-[14px] leading-snug text-label">
          <input type="checkbox" name={name} value="on" required={q.required} className="mt-0.5 size-[18px] shrink-0 accent-[var(--accent)]" />
          <span>
            {q.label}
            {!q.required && <span className="text-label-3"> (optional)</span>}
            {q.help_text && <span className="mt-0.5 block text-[12px] text-label-3">{q.help_text}</span>}
          </span>
        </label>
      )}
    </fieldset>
  );
}

/** The answers in the form, keyed by question id: text, or a list of choices. Unanswered questions are left out. */
export function collectAnswers(questions: ServiceQuestion[], fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const q of questions) {
    const name = fieldName(q);
    if (q.type === "multi") {
      const picked = fd.getAll(name).map(String);
      if (picked.length) out[q.id] = picked;
    } else {
      const v = String(fd.get(name) ?? "").trim();
      if (v) out[q.id] = v;
    }
  }
  return out;
}
