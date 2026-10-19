/**
 * Calling a server action from a button can fail in ways the action itself never gets to answer: the connection drops,
 * the server answers 500, or the session ended (the sign-in guard then replies with a redirect page instead of the
 * action's result). The browser throws in all three cases, and a throw that nobody catches replaces the whole page
 * with the generic error screen. runAction turns such a throw into a value, so the caller can show an inline message
 * and keep the page usable. Next.js's own control-flow errors (redirect(), notFound()) are NOT failures and are re-thrown.
 */
export const REQUEST_FAILED = "Something went wrong. Please check your connection and try again.";
export const SESSION_ENDED = "Your session has ended. Please sign in again.";

export type ActionOutcome<T> = { ok: true; value: T } | { ok: false; error: string; sessionEnded: boolean };

/** redirect(), notFound(), unauthorized() and friends are thrown as errors with a well-known digest: they must pass through. */
export function isControlFlowError(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest);
}

/**
 * Runs `fn` (a server action call). `sessionEnded` is asked only after a failure, to tell "the person was signed out" from
 * "the request failed"; if it throws, the failure counts as a plain request failure.
 */
export async function runAction<T>(fn: () => Promise<T>, sessionEnded?: () => Promise<boolean>): Promise<ActionOutcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isControlFlowError(e)) throw e;
    let ended = false;
    try { ended = sessionEnded ? await sessionEnded() : false; } catch { ended = false; }
    return { ok: false, error: ended ? SESSION_ENDED : REQUEST_FAILED, sessionEnded: ended };
  }
}

/**
 * Only signed-in surfaces (the dashboard and onboarding) have a session that can "end". On every other page (booking,
 * cancel, reschedule, waitlist, contact, embeds, invite) the visitor is anonymous BY DESIGN, so a failed request is just a
 * failed request and must never send them to the staff sign-in page (D-029).
 */
export function isSignedInSurface(pathname: string): boolean {
  return /^\/(o|onboarding|app)(\/|$)/.test(pathname);
}

/** Whether a failed call should ask "has the session ended?". An explicit option wins; otherwise decided by the page. */
export function shouldCheckSession(requireSession: boolean | undefined, pathname: string): boolean {
  return requireSession ?? isSignedInSurface(pathname);
}
