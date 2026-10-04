import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Inset grouped list, like iOS Settings. */
export function List({
  header,
  footer,
  children,
  className,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {header && <h3 className="px-4 text-[13px] font-medium uppercase tracking-wide text-label-3">{header}</h3>}
      <div className="overflow-hidden rounded-[14px] bg-surface shadow-sm hairline divide-y divide-separator">
        {children}
      </div>
      {footer && <p className="px-4 text-[13px] text-label-3">{footer}</p>}
    </section>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  detail,
  href,
  onClick,
  children,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  detail?: ReactNode;
  href?: string;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {icon && <div className="shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <div className="truncate text-[15px] text-label">{title}</div>}
        {subtitle && <div className="truncate text-[13px] text-label-2">{subtitle}</div>}
        {children}
      </div>
      {detail && <div className="shrink-0 text-[15px] text-label-2">{detail}</div>}
      {(href || onClick) && <ChevronRight className="size-4 shrink-0 text-label-4" strokeWidth={2.5} />}
    </>
  );
  const base = cn("flex min-h-[52px] items-center gap-3 px-4 py-2.5", className);
  if (href)
    return (
      <Link href={href} className={cn(base, "transition-colors hover:bg-surface-2 active:bg-surface-3")}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button onClick={onClick} className={cn(base, "w-full text-left transition-colors hover:bg-surface-2 active:bg-surface-3")}>
        {inner}
      </button>
    );
  return <div className={base}>{inner}</div>;
}
