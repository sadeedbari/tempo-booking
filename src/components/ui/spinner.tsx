import { cn } from "@/lib/utils";

/** iOS-style activity indicator. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("animate-spin [animation-duration:0.9s]", className)} aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <rect
          key={i}
          x="11"
          y="2"
          width="2"
          height="6"
          rx="1"
          fill="currentColor"
          opacity={0.2 + (i / 8) * 0.8}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}
