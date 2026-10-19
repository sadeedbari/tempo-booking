import type { ReactNode } from "react";
import { cn, initials } from "@/lib/utils";

export function Avatar({
  name,
  color = "#8E8E93",
  src,
  size = 32,
  className,
}: {
  name: string;
  color?: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: src ? undefined : `linear-gradient(180deg, ${color}cc, ${color})`,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

const tones = {
  gray: "bg-surface-2 text-label-2",
  // The text colours are the AA-contrast variants (globals.css); the tints behind them are unchanged.
  blue: "bg-accent-soft text-accent-text",
  green: "bg-[color-mix(in_srgb,var(--green)_15%,transparent)] text-green-text",
  orange: "bg-[color-mix(in_srgb,var(--orange)_15%,transparent)] text-orange-text",
  red: "bg-red-soft text-red-text",
  purple: "bg-[color-mix(in_srgb,var(--purple)_15%,transparent)] text-purple",
};

export function Badge({ tone = "gray", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center rounded-full px-2.5 text-[12px] font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof tones {
  switch (status) {
    case "confirmed":
      return "blue";
    case "completed":
      return "green";
    case "pending_payment":
    case "pending_approval":
      return "orange";
    case "cancelled":
    case "no_show":
      return "red";
    default:
      return "gray";
  }
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-label-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[18px] bg-surface px-6 py-14 text-center shadow-sm hairline">
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-[16px] bg-accent-soft text-accent">{icon}</div>}
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[14px] text-label-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[18px] bg-surface p-5 shadow-sm hairline", className)}>{children}</div>;
}

/**
 * A message box. With `live` it is a live region, so a screen reader announces it when it appears: errors (red) as an alert,
 * everything else (blue, green) politely as a status. Opt in with `live` for a message that appears after something happened
 * (a failed button, a result banner); a note that is simply part of the page stays a plain box.
 */
export function Notice({ tone = "red", children, live }: { tone?: "red" | "blue" | "green"; children: ReactNode; live?: boolean }) {
  const t = { red: tones.red, blue: tones.blue, green: tones.green }[tone];
  // Error (red) boxes are announced by default, so every form error reaches screen readers; pass live={false} for a static one.
  const isLive = live ?? tone === "red";
  const role = isLive ? (tone === "red" ? "alert" : "status") : undefined;
  return <div role={role} className={cn("rounded-[12px] px-3.5 py-2.5 text-[14px] font-medium", t)}>{children}</div>;
}
