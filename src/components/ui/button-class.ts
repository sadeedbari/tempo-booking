import { cn } from "@/lib/utils";

export type Variant = "filled" | "tinted" | "gray" | "plain" | "destructive" | "glass";
export type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  filled: "bg-accent-fill text-white hover:bg-accent-fill-hover shadow-[0_1px_2px_rgba(0,0,0,0.12)]",
  tinted: "bg-accent-soft text-accent-text hover:brightness-95",
  gray: "bg-surface-2 text-label hover:bg-surface-3",
  plain: "bg-transparent text-accent-text hover:bg-accent-soft",
  destructive: "bg-red-soft text-red-text hover:brightness-95",
  glass: "glass hairline text-label hover:bg-surface",
};

const sizes: Record<Size, string> = {
  sm: "h-10 px-3.5 text-[14px] gap-1.5 sm:h-8 sm:px-3 sm:text-[13px]",
  md: "h-10 px-4 text-[15px] gap-2",
  lg: "h-12 px-6 text-[17px] gap-2",
};

export const buttonClass = (variant: Variant = "filled", size: Size = "md", pill = false, extra?: string) =>
  cn(
    "inline-flex items-center justify-center font-medium select-none whitespace-nowrap",
    "transition-[background-color,transform,filter,opacity] duration-200 ease-[var(--ease-apple)]",
    "active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100",
    pill ? "rounded-full" : size === "sm" ? "rounded-[9px]" : "rounded-[12px]",
    variants[variant],
    sizes[size],
    extra,
  );

