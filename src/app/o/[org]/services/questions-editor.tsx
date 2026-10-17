"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { QuestionType, ServiceQuestion } from "@/lib/types";

/** A question as the editor holds it: choices are one per line, and `key` identifies it before it has an id. */
export interface DraftQuestion {
  key: string;
  id?: string;
  label: string;
  help_text: string;
  type: QuestionType;
  choices: string;
  required: boolean;
}

export const TYPE_LABEL: Record<QuestionType, string> = {
  text: "Short answer",
  paragraph: "Long answer",
  choice: "Choose one",
  multi: "Choose several",
  yes_no: "Yes or no",
  agree: "I agree (tick box)",
  date: "Date",
};

let counter = 0;
const newKey = () => `q${Date.now().toString(36)}${++counter}`;

export const toDrafts = (qs: ServiceQuestion[], keepIds = true): DraftQuestion[] =>
  qs.map((q) => ({ key: newKey(), id: keepIds ? q.id : undefined, label: q.label, help_text: q.help_text ?? "", type: q.type, choices: q.options.join("\n"), required: q.required }));

/** What gets sent to the server. */
export const serializeDrafts = (ds: DraftQuestion[]) =>
  JSON.stringify(
    ds.map((d) => ({
      id: d.id ?? null,
      label: d.label,
      help_text: d.help_text || null,
      type: d.type,
      options: d.type === "choice" || d.type === "multi" ? d.choices.split("\n").map((s) => s.trim()).filter(Boolean) : [],
      required: d.required,
    })),
  );

const MAX = 12;

export function QuestionsEditor({
  value, onChange, others,
}: {
  value: DraftQuestion[];
  onChange: (v: DraftQuestion[]) => void;
  /** Other services' questions, to copy from. */
  others: { id: string; name: string; questions: ServiceQuestion[] }[];
}) {
  const [copyFrom, setCopyFrom] = useState("");
  const update = (key: string, patch: Partial<DraftQuestion>) => onChange(value.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3" data-testid="questions-editor">
      <div>
        <div className="px-1 text-[13px] font-medium text-label-2">Questions for customers</div>
        <p className="px-1 text-[12px] text-label-3">Asked on the booking form, after their details. Only ask what you need: answers are visible to your team on the booking.</p>
      </div>

      {value.map((q, i) => (
        <fieldset key={q.key} className="space-y-3 rounded-[14px] bg-surface-2 p-3.5">
          <legend className="sr-only">Question {i + 1}</legend>
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-[12px] font-semibold text-label-2">{i + 1}</span>
            <Input value={q.label} onChange={(e) => update(q.key, { label: e.target.value })} placeholder="Your question, e.g. Any allergies?" maxLength={200} className="bg-surface" aria-label={`Question ${i + 1}`} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select value={q.type} onChange={(e) => update(q.key, { type: e.target.value as QuestionType })} className="bg-surface" aria-label={`Answer type for question ${i + 1}`}>
              {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </Select>
            <div className="flex h-11 items-center justify-between gap-3 rounded-[11px] bg-surface px-3.5">
              <span className="text-[14px]">Required</span>
              <Switch checked={q.required} onChange={(v) => update(q.key, { required: v })} label={`Question ${i + 1} is required`} />
            </div>
          </div>
          {(q.type === "choice" || q.type === "multi") && (
            <Textarea
              value={q.choices}
              onChange={(e) => update(q.key, { choices: e.target.value })}
              placeholder={"One choice per line\nDry\nOily\nCombination"}
              className="min-h-24 bg-surface"
              aria-label={`Choices for question ${i + 1}`}
            />
          )}
          <Input value={q.help_text} onChange={(e) => update(q.key, { help_text: e.target.value })} placeholder="Help text (optional)" maxLength={300} className="bg-surface" aria-label={`Help text for question ${i + 1}`} />
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="gray" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`}><ArrowUp className="size-4" /></Button>
            <Button type="button" size="sm" variant="gray" onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label={`Move question ${i + 1} down`}><ArrowDown className="size-4" /></Button>
            <Button type="button" size="sm" variant="destructive" className="ml-auto" onClick={() => onChange(value.filter((x) => x.key !== q.key))} aria-label={`Remove question ${i + 1}`}>
              <Trash2 className="size-4" /> Remove
            </Button>
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="tinted" disabled={value.length >= MAX} onClick={() => onChange([...value, { key: newKey(), label: "", help_text: "", type: "text", choices: "", required: false }])}>
          <Plus className="size-4" /> Add a question
        </Button>
        {value.length >= MAX && <span className="text-[12px] text-label-3">That&apos;s the most a service can have ({MAX}).</span>}
        {others.some((o) => o.questions.length > 0) && value.length < MAX && (
          <div className="flex items-center gap-2">
            <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="h-9 w-auto max-w-[200px] text-[13px]" aria-label="Copy questions from another service">
              <option value="">Copy from…</option>
              {others.filter((o) => o.questions.length > 0).map((o) => <option key={o.id} value={o.id}>{o.name} ({o.questions.length})</option>)}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="gray"
              disabled={!copyFrom}
              onClick={() => {
                const src = others.find((o) => o.id === copyFrom);
                if (!src) return;
                onChange([...value, ...toDrafts(src.questions, false)].slice(0, MAX));
                setCopyFrom("");
              }}
            >
              <Copy className="size-4" /> Copy
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
