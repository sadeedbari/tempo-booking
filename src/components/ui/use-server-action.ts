"use client";
import { useCallback, useState, useTransition, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { runAction, shouldCheckSession } from "@/lib/run-action";

/** True when the browser has no signed-in user any more (cleared cookies, expired refresh token). False on any doubt, e.g. offline. */
async function sessionHasEnded(): Promise<boolean> {
  const { data, error } = await createClient().auth.getUser();
  if (data.user) return false;
  // A lost connection is a retryable fetch error, not a missing session.
  return !error || error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403;
}

/** Sends the person to the sign-in page (with a message there) and brings them back to this page afterwards. */
function goToSignIn() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full page load on purpose: the session is gone, so drop client state
  window.location.href = `/login?error=session&next=${encodeURIComponent(window.location.pathname)}`; // full load: drops any stale client state
}

export type SafeOptions = {
  /** true: a failed call checks for an ended session and goes to /login. false: never (public pages). Unset: only on /o, /onboarding, /app. */
  requireSession?: boolean;
};

/**
 * Drop-in for `useTransition` around a server action call. Same `[pending, start]` shape, but when the call itself fails
 * (connection lost, HTTP 500, session ended) the failure is passed to `onError` as a friendly sentence instead of being
 * thrown, which would replace the whole page with the generic error screen. An ended session also leads to the sign-in
 * page. redirect() / notFound() still work (see runAction).
 */
export function useSafeTransition(onError: (message: string) => void, options: SafeOptions = {}) {
  const [pending, start] = useTransition();
  const { requireSession } = options;
  const safeStart = useCallback((fn: () => Promise<void>) =>
    start(async () => {
      // Public pages pass requireSession:false and never touch supabase auth. Default: only on dashboard-type paths.
      const check = shouldCheckSession(requireSession, window.location.pathname) ? sessionHasEnded : undefined;
      const r = await runAction(fn, check);
      if (r.ok) return;
      onError(r.error);
      if (r.sessionEnded) goToSignIn();
    }), [onError, requireSession]);
  return [pending, safeStart] as const;
}

/**
 * For buttons whose result is handled in the caller. `run(call, onResult)` waits for the server action in a transition
 * (so `pending` can disable the button) and passes its result to `onResult`. If the call fails, `error` holds a friendly
 * sentence for a live region; the page stays as it is and the button works again.
 */
export function useServerAction(options: SafeOptions = {}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useSafeTransition(setError, options);
  const run = useCallback(<T,>(call: () => Promise<T>, onResult: (value: T) => void) =>
    start(async () => {
      const value = await call();
      setError(null);
      onResult(value);
    }), [start]);
  return { run, pending, error };
}

/**
 * Use as `<form onSubmit={submitForm(fn)}>` instead of `<form action={fn}>`. React empties an uncontrolled form as soon as
 * its `action` function finishes, and a failed Save (request error or a validation message from the server) finishes
 * normally, so the person's typing would vanish. Handling the submit ourselves keeps every field as typed; the browser's
 * own required/type checks still run first. On success the form is usually closed or re-keyed by the caller.
 */
export function submitForm(fn: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    fn(new FormData(e.currentTarget));
  };
}
