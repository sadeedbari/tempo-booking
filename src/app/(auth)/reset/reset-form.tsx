"use client";
import { useActionState } from "react";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { updatePassword, type AuthState } from "../actions";

export function ResetForm() {
  const [state, action] = useActionState<AuthState, FormData>(updatePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password" hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus />
      </Field>
      <Field label="Type it again">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state?.error && <Notice>{state.error}</Notice>}
      <SubmitButton size="lg" className="w-full">Save password</SubmitButton>
    </form>
  );
}
