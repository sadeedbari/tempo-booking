"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { cancelBooking } from "./actions";

export function CancelBooking({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return <Button variant="destructive" size="lg" pill className="w-full" onClick={() => setOpen(true)}>Cancel booking</Button>;
  }
  return (
    <form
      className="space-y-3 rounded-[18px] bg-surface p-4 shadow-sm hairline animate-pop"
      action={(fd) => start(async () => { const r = await cancelBooking(token, String(fd.get("reason") || "")); if (r?.error) setError(r.error); })}
    >
      <div className="text-[15px] font-semibold">Cancel this booking?</div>
      <Textarea name="reason" placeholder="Reason (optional)" className="min-h-16" />
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <Button type="button" variant="gray" className="flex-1" onClick={() => setOpen(false)}>Keep it</Button>
        <Button type="submit" variant="destructive" className="flex-1" loading={pending}>Yes, cancel</Button>
      </div>
    </form>
  );
}
