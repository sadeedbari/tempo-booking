"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Input, Field } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { signIn, signUp, type AuthState } from "./actions";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [state, action] = useActionState<AuthState, FormData>(mode === "login" ? signIn : signUp, undefined);
  const nextQs = next ? `?next=${encodeURIComponent(next)}` : "";

  if (state?.message) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-[26px]">✉️</div>
        <p className="text-[15px] text-label-2">{state.message}</p>
        {mode === "signup" && (
          <p className="text-[14px] text-label-2" data-testid="signup-existing-account">
            No email after a few minutes? Check your spam folder. If you already have an account,{" "}
            <Link href={`/login${nextQs}`} className="inline-block py-2 font-medium text-accent">sign in</Link>
            {" or "}
            <Link href="/forgot" className="inline-block py-2 font-medium text-accent">reset your password</Link>.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      {mode === "signup" && (
        <Field label="Your name">
          <Input name="name" autoComplete="name" placeholder="Jane Appleseed" required autoFocus />
        </Field>
      )}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" placeholder="you@company.com" required autoFocus={mode === "login"} />
      </Field>
      <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
        <Input
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder="••••••••"
          required
          minLength={mode === "signup" ? 8 : undefined}
        />
      </Field>
      {mode === "login" && (
        <div className="-mt-1 text-right">
          <Link href="/forgot" className="inline-block py-2 text-[14px] font-medium text-accent">Forgot password?</Link>
        </div>
      )}
      {state?.error && <Notice>{state.error}</Notice>}
      <SubmitButton size="lg" className="w-full">
        {mode === "login" ? "Sign in" : "Create account"}
      </SubmitButton>
      <p className="pt-2 text-center text-[14px] text-label-2">
        {mode === "login" ? (
          <>New to Tempo? <Link href={`/signup${nextQs}`} className="inline-block py-3 font-medium text-accent">Create an account</Link></>
        ) : (
          <>Already have an account? <Link href={`/login${nextQs}`} className="inline-block py-3 font-medium text-accent">Sign in</Link></>
        )}
      </p>
    </form>
  );
}
