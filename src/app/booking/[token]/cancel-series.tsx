"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { cancelSeriesFollowing } from "./actions";

/** "Cancel this and all later appointments" for a repeating appointment. */
export function CancelSeries({ token, count }: { token: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return <Button variant="destructive" size="lg" pill className="w-full" onClick={() => setOpen(true)}>Cancel this and all later ones ({count})</Button>;
  }
  return (
    <form
      className="space-y-3 rounded-[18px] bg-surface p-4 shadow-sm hairline animate-pop"
      action={(fd) => start(async () => { const r = await cancelSeriesFollowing(token, String(fd.get("reason") || "")); if (r?.error) setError(r.error); })}
    >
      <div className="text-[15px] font-semibold">Cancel {count} appointments?</div>
      <p className="text-[13px] text-label-2">This appointment and every later one in the series will be cancelled. Earlier ones stay as they are.</p>
      <Textarea name="reason" placeholder="Reason (optional)" className="min-h-16" />
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <Button type="button" variant="gray" className="flex-1" onClick={() => setOpen(false)}>Keep them</Button>
        <Button type="submit" variant="destructive" className="flex-1" loading={pending}>Yes, cancel all</Button>
      </div>
    </form>
  );
}
