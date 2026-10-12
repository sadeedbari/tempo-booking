"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { requestPasswordReset, type AuthState } from "../actions";

export function ForgotForm() {
  const [state, action] = useActionState<AuthState, FormData>(requestPasswordReset, undefined);

  if (state?.message) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-[26px]">✉️</div>
        <p className="text-[15px] text-label-2">{state.message}</p>
        <Link href="/login" className="inline-block py-3 text-[14px] font-medium text-accent">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" placeholder="you@company.com" required autoFocus />
      </Field>
      {state?.error && <Notice>{state.error}</Notice>}
      <SubmitButton size="lg" className="w-full">Send reset link</SubmitButton>
      <p className="pt-2 text-center text-[14px] text-label-2">
        <Link href="/login" className="inline-block py-3 font-medium text-accent">Back to sign in</Link>
      </p>
    </form>
  );
}
