"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** iOS-style toggle. Works inside forms via `name` (submits "on" when checked). */
export function Switch({
  name,
  defaultChecked,
  checked: controlled,
  onChange,
  disabled,
  label,
}: {
  name?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [inner, setInner] = useState(!!defaultChecked);
  const on = controlled ?? inner;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        const v = !on;
        setInner(v);
        onChange?.(v);
      }}
      className={cn(
        "relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-300 ease-[var(--ease-apple)] disabled:opacity-40",
        on ? "bg-green" : "bg-surface-3",
      )}
    >
      {name && <input type="hidden" name={name} value={on ? "on" : ""} />}
      <span
        className={cn(
          "absolute left-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)]",
          "transition-transform duration-300 ease-[var(--ease-spring)]",
          on ? "translate-x-[20px]" : "translate-x-0",
        )}
      />
    </button>
  );
}
