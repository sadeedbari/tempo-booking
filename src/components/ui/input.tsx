import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-[11px] bg-surface-2 px-3.5 text-[16px] sm:text-[15px] text-label placeholder:text-label-3 " +
  "border border-transparent transition-[box-shadow,background-color,border-color] duration-200 " +
  "focus:bg-surface focus:border-accent focus:shadow-[var(--ring)] outline-none disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(field, "h-11", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(field, "min-h-24 py-2.5 resize-y", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(field, "h-11 appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-label-3"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
      >
        <path d="M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      {label && <span className="block text-[13px] font-medium text-label-2 px-1">{label}</span>}
      {children}
      {error ? (
        <span className="block text-[12px] text-red-text px-1">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-label-2 px-1">{hint}</span>
      ) : null}
    </label>
  );
}
