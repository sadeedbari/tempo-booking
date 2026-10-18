import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison (for secrets such as the cron bearer token). Both values are hashed first so the
 * buffers always have equal length and the comparison time doesn't reveal the secret's length or a matching prefix.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** True when `header` is exactly `Bearer <secret>`. Fails closed when no secret is configured. */
export function bearerMatches(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  return safeEqual(header, `Bearer ${secret}`);
}
