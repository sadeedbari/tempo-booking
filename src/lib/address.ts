/**
 * Puts an optional unit/apartment in front of a street address: "Unit 4B, 12 Main St, Toronto".
 * If the person already wrote the kind of unit ("Apt 4B", "Suite 200", "#12"), it's used as typed.
 * With no address, the unit alone is meaningless, so it's dropped.
 */
export function withUnit(address: string | null | undefined, unit?: string | null): string {
  const a = (address ?? "").trim();
  const u = (unit ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  if (!a || !u) return a;
  const labelled = /^(apt|apartment|unit|suite|ste|floor|fl|room|rm|bldg|building|#)/i.test(u);
  return `${labelled ? u : `Unit ${u}`}, ${a}`;
}
