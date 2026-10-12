import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safePath = (p: string | null) => (p && p.startsWith("/") && !p.startsWith("//") ? p : null);

/**
 * Links in confirmation and password-reset emails point here.
 *
 * GET only shows a "Continue" button. The one-time code is used when the button is pressed (POST). That way
 * the automatic link scanners some mail apps run (which fetch every link but never click) can't use up the code
 * before the person does, and the link also works on a different phone or computer than the one that asked for it.
 */
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type");
  if (!tokenHash || !type || !TYPES.includes(type as EmailOtpType)) {
    return NextResponse.redirect(new URL(type === "recovery" ? "/forgot?error=link" : "/login?error=link", request.url));
  }
  const recovery = type === "recovery";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${recovery ? "Reset your password" : "Confirm your email"} · Tempo</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;background:#f5f5f7;color:#1d1d1f;padding:24px">
<main style="width:100%;max-width:400px;background:#fff;border-radius:24px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center">
<div style="font-size:18px;font-weight:600;margin-bottom:20px">Tempo</div>
<h1 style="font-size:24px;margin:0 0 8px">${recovery ? "Reset your password" : "Confirm your email"}</h1>
<p style="color:#6e6e73;font-size:15px;margin:0 0 24px">${recovery ? "Press continue to choose a new password." : "Press continue to finish setting up your account."}</p>
<form method="post" action="/auth/confirm">
<input type="hidden" name="token_hash" value="${esc(tokenHash)}"><input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="next" value="${esc(safePath(sp.get("next")) ?? "")}">
<button type="submit" style="width:100%;font:600 17px system-ui;padding:14px 22px;border:0;border-radius:999px;background:#007aff;color:#fff;cursor:pointer">Continue</button>
</form></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") as EmailOtpType;
  const next = safePath(String(form.get("next") ?? ""));
  const origin = new URL(request.url).origin;
  const recovery = type === "recovery";

  if (tokenHash && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next ?? (recovery ? "/reset" : "/app")}`, 303);
    console.error("[auth] email link rejected:", error.code, error.message);
  }
  return NextResponse.redirect(`${origin}${recovery ? "/forgot?error=link" : "/login?error=link"}`, 303);
}
