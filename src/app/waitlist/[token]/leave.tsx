"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { leaveWaitlist } from "./actions";

/** "Leave the waitlist", with a second tap to confirm. */
export function LeaveWaitlist({ token }: { token: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {error && <Notice>{error}</Notice>}
      <Button
        variant={confirm ? "destructive" : "glass"}
        size="lg"
        pill
        className="w-full"
        loading={pending}
        onClick={() =>
          confirm
            ? start(async () => {
                const r = await leaveWaitlist(token);
                if ("error" in r) setError(r.error);
              })
            : setConfirm(true)
        }
      >
        {confirm ? "Tap again to leave the waitlist" : "Leave the waitlist"}
      </Button>
    </div>
  );
}
