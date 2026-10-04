"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { acceptInvite } from "./actions";

export function AcceptInvite({ token, defaultName }: { token: string; defaultName: string }) {
  const [state, action] = useActionState(acceptInvite, undefined);
  return (
    <form action={action} className="space-y-3 text-left">
      <input type="hidden" name="token" value={token} />
      <label className="block space-y-1.5">
        <span className="px-1 text-[13px] font-medium text-label-2">Your name, as customers see it</span>
        <Input name="display_name" defaultValue={defaultName} required />
      </label>
      {state?.error && <Notice>{state.error}</Notice>}
      <SubmitButton size="lg" pill className="w-full">Accept invitation</SubmitButton>
    </form>
  );
}
