import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase sends people after they click an email link (and after social sign-in). Exchanges the one-time
 * code for a session. If that can't be done, the person is told what to do next instead of seeing a dead end.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/app";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/app";
  const recovery = next === "/reset";
  const fail = (reason: string) => NextResponse.redirect(`${origin}${recovery ? "/forgot" : "/login"}?error=${reason}`);

  // Supabase reports a used or expired link in the address (for example error_code=otp_expired).
  const problem = searchParams.get("error_code") ?? searchParams.get("error");
  if (problem) {
    console.error("[auth] email link problem:", problem, searchParams.get("error_description"));
    return fail("link");
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    // Most often the link was opened in a different browser than the one that asked for it, so there is no
    // matching session to finish. For a confirmation the email is usually already confirmed at this point.
    console.error("[auth] code exchange failed:", error.code, error.message);
    return fail(/verifier|code_verifier|pkce/i.test(error.message) ? "browser" : "link");
  }
  return fail("link");
}
