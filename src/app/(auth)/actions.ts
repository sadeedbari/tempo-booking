"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { friendlyAuthError } from "@/lib/auth-errors";

export type AuthState = { error?: string; message?: string } | undefined;

function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/app";
}

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
  });
  if (error) return { error: friendlyAuthError(error) };
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!name) return { error: "Please enter your name." };
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };

  const origin = (await headers()).get("origin") || env.appUrl;
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: friendlyAuthError(error) };
  if (!data.session) return { message: `We sent a confirmation link to ${email}. Open it to continue.` };
  redirect(next);
}

/** Sends a password-reset email. Always answers the same way so nobody can use it to find out who has an account. */
export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Please enter the email address you signed up with." };
  const origin = (await headers()).get("origin") || env.appUrl;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset")}` });
  if (error && (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" || /rate limit/i.test(error.message))) {
    return { error: friendlyAuthError(error) };
  }
  if (error) console.error("[auth] password reset failed:", error.code, error.message);
  return { message: `If there's an account for ${email}, we've sent a link to reset the password. It can take a minute to arrive.` };
}

/** Sets a new password for the person who followed the emailed link (they're signed in by it). */
export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  if (password !== confirm) return { error: "The two passwords don't match." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "That reset link has expired. Please ask for a new one." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.code === "same_password" ? "Choose a password you haven't used before." : friendlyAuthError(error) };
  redirect("/app");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
