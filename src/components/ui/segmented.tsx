"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** iOS segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(value)}"]`);
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);

  return (
    <div
      ref={ref}
      role="tablist"
      className={cn(
        "relative inline-flex rounded-[10px] bg-surface-2 p-[2px]",
        size === "sm" ? "h-9 text-[13px] sm:h-8" : "h-10 text-[14px] sm:h-9",
        className,
      )}
    >
      {thumb && (
        <span
          className="absolute top-[2px] bottom-[2px] rounded-[8px] bg-surface shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transition-all duration-300 ease-[var(--ease-apple)] dark:bg-surface-3"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 flex-1 px-3.5 font-medium transition-colors whitespace-nowrap",
            o.value === value ? "text-label" : "text-label-2 hover:text-label",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
