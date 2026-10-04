import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id="tempo-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3D9BFF" />
          <stop offset="1" stopColor="#0062E0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill="url(#tempo-g)" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2.4" opacity="0.95" />
      <path d="M16 11.2V16l3.2 2.2" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight", className)}>
      <LogoMark />
      Tempo
    </span>
  );
}
