"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Circle } from "lucide-react";

export interface SetupItem {
  done: boolean;
  label: string;
  href: string;
}

/** A small progress ring with the percent finished; opens a list of what is left to do. */
export function SetupProgress({ items }: { items: SetupItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const done = items.filter((i) => i.done).length;
  const percent = Math.round((done / items.length) * 100);
  const remaining = items.filter((i) => !i.done);
  const R = 11;
  const C = 2 * Math.PI * R;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Setup ${percent}% complete. ${remaining.length} step${remaining.length === 1 ? "" : "s"} left`}
        className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-surface-2 pl-2.5 pr-3.5 text-[13px] font-medium transition hover:bg-surface-3 sm:h-10"
      >
        <svg viewBox="0 0 28 28" className="size-6 -rotate-90" aria-hidden>
          <circle cx="14" cy="14" r={R} fill="none" strokeWidth="3" className="stroke-label-4/40" />
          <circle cx="14" cy="14" r={R} fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-accent transition-[stroke-dashoffset] duration-500" strokeDasharray={C} strokeDashoffset={C * (1 - percent / 100)} />
        </svg>
        <span className="tabular-nums">{percent}%</span>
        <span className="hidden text-label-2 sm:inline">set up</span>
      </button>

      {open && (
        <div className="fixed inset-x-4 z-40 mt-2 overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-[320px] rounded-[16px] bg-surface hairline p-1.5 shadow-lg animate-pop">
          <div className="px-3 pb-1 pt-2">
            <div className="text-[15px] font-semibold">Get set up</div>
            <div className="text-[13px] text-label-2">{done} of {items.length} done</div>
          </div>
          <ul>
            {remaining.map((s) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[14px] transition hover:bg-surface-2"
                >
                  <Circle className="size-5 shrink-0 text-label-4" />
                  <span className="flex-1">{s.label}</span>
                  <ChevronRight className="size-4 text-label-3" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
