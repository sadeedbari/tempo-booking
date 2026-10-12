import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { change } from "@/lib/dashboard";

/** Presentational building blocks for the dashboard. Server-rendered SVG, no chart library. */

export function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(cents / 100);
}
export const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export function Card({
  title, subtitle, action, children, className,
}: {
  title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-[18px] bg-surface p-5 shadow-sm hairline", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[16px] font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-label-3">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Up/down badge comparing against the previous period. `lowerIsBetter` flips the colours (e.g. no-shows). */
export function Delta({ value, prev, lowerIsBetter = false, ratio = false }: { value: number | null; prev: number | null; lowerIsBetter?: boolean; ratio?: boolean }) {
  if (value === null || prev === null) return <span className="text-[12px] text-label-3">vs. previous: n/a</span>;
  // For rates (already 0..1) compare in percentage points; for amounts compare relatively.
  const diff = ratio ? value - prev : change(value, prev);
  if (diff === null) return <span className="text-[12px] font-medium text-accent">New</span>;
  if (Math.abs(diff) < 0.005) return <span className="text-[12px] text-label-3">No change</span>;
  const up = diff > 0;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-semibold", good ? "text-green" : "text-red")}>
      <Icon className="size-3.5" strokeWidth={2.5} />
      {ratio ? `${Math.abs(Math.round(diff * 100))} pts` : `${Math.abs(Math.round(diff * 100))}%`}
      <span className="ml-1 font-normal text-label-3">vs. previous</span>
    </span>
  );
}

export function Kpi({
  label, value, sub, spark, href,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; spark?: number[]; href?: string;
}) {
  const body = (
    <div className="flex h-full flex-col rounded-[18px] bg-surface p-4 shadow-sm hairline transition hover:shadow-md">
      <div className="text-[13px] font-medium text-label-2">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="text-[28px] font-bold leading-tight tracking-tight">{value}</div>
        {spark && <Sparkline values={spark} />}
      </div>
      {sub && <div className="mt-1.5 min-h-[18px]">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || Math.max(...values) === 0) return null;
  const w = 84, h = 32, max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - (v / max) * (h - 6)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-[84px] shrink-0 text-accent" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Vertical bars, one per day. The last bar (today) is drawn solid. */
export function BarChart({
  values, labels, format, className,
}: {
  values: number[]; labels: string[]; format: (v: number) => string; className?: string;
}) {
  const W = 600, H = 150, pad = 4, base = H - 22;
  const max = Math.max(1, ...values);
  const gap = values.length > 40 ? 1 : 3;
  const bw = (W - pad * 2 - gap * (values.length - 1)) / values.length;
  const tick = (i: number) => i === 0 || i === values.length - 1 || i === Math.floor((values.length - 1) / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-40 w-full text-accent", className)} role="img" aria-label="Daily chart">
      <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="currentColor" opacity="0.15" />
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 3 : 0, (v / max) * (base - 8));
        const x = pad + i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={base - h} width={bw} height={h} rx={Math.min(3, bw / 2)} fill="currentColor" opacity={i === values.length - 1 ? 1 : 0.55}>
              <title>{`${labels[i]}: ${format(v)}`}</title>
            </rect>
            {tick(i) && (
              <text x={x + bw / 2} y={H - 6} textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"} className="fill-label-3 text-[11px]">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

/** Weekday x hour grid of how many appointments start then. */
export function Heatmap({ cells, max, minHour, maxHour }: { cells: number[][]; max: number; minHour: number; maxHour: number }) {
  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[420px]">
        <div className="grid items-center gap-1" style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))` }}>
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-[10px] text-label-3">{h % 2 === 0 || hours.length < 9 ? hourLabel(h) : ""}</span>
          ))}
          {DAY_ORDER.map((d) => (
            <div key={d} className="contents">
              <span className="text-[11px] font-medium text-label-3">{DAY_NAME[d]}</span>
              {hours.map((h) => {
                const n = cells[d][h];
                return (
                  <span
                    key={h}
                    title={`${DAY_NAME[d]} ${hourLabel(h)}: ${n} appointment${n === 1 ? "" : "s"}`}
                    className="h-6 rounded-[5px] bg-surface-2"
                    style={n > 0 ? { background: `color-mix(in srgb, var(--accent) ${Math.round(18 + (n / max) * 82)}%, transparent)` } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Label + proportional bar + right-aligned value. */
export function BarRow({ label, value, max, right, color }: { label: React.ReactNode; value: number; max: number; right: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[14px]">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 text-label-2">{right}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%`, ...(color ? { background: color } : {}) }} />
      </div>
    </div>
  );
}

/** One stacked bar split into labelled segments. */
export function StackedBar({ parts }: { parts: { label: string; value: number; className: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return <p className="text-[14px] text-label-3">No bookings in this period yet.</p>;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", p.className)} />
            <span className="text-label-2">{p.label}</span>
            <span className="ml-auto font-medium">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[14px] text-label-3">{children}</p>;
}
