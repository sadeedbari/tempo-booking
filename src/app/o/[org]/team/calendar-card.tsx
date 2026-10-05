"use client";
import { useState, useTransition } from "react";
import { CalendarCheck, CalendarX2 } from "lucide-react";
import { Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-class";
import { useToast } from "@/components/ui/toast";
import { disconnectCalendar } from "../actions";

export function CalendarCard({
  slug, available, connection, result,
}: {
  slug: string;
  available: boolean;
  connection: { email: string | null; needsReauth: boolean } | null;
  result?: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const connectHref = `/api/google/connect?org=${encodeURIComponent(slug)}`;

  return (
    <section className="max-w-3xl">
      <h2 className="text-[20px] font-semibold">Your calendar</h2>
      <p className="mt-0.5 mb-4 text-[14px] text-label-2">
        Two-way sync with your Google Calendar. Tempo bookings appear on your calendar, and anything already on it blocks those times from online booking.
      </p>
      {result === "connected" && <div className="mb-3"><Notice tone="green">Google Calendar connected.</Notice></div>}
      {result === "denied" && <div className="mb-3"><Notice tone="blue">Calendar access wasn&apos;t granted, so nothing was connected.</Notice></div>}
      {result === "error" && <div className="mb-3"><Notice>Couldn&apos;t connect your calendar. Please try again.</Notice></div>}

      <div className="flex flex-wrap items-center gap-4 rounded-[16px] bg-surface p-5 shadow-sm hairline">
        <div className="grid size-12 place-items-center rounded-[13px] bg-accent-soft text-accent">
          {connection && !connection.needsReauth ? <CalendarCheck className="size-6" /> : <CalendarX2 className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[16px] font-semibold">
            Google Calendar
            {connection && (connection.needsReauth ? <Badge tone="orange">Reconnect needed</Badge> : <Badge tone="green">Connected</Badge>)}
          </div>
          <div className="truncate text-[14px] text-label-2">
            {!available
              ? "Calendar sync isn't set up on this server yet."
              : connection
                ? connection.needsReauth ? "Access was revoked or expired. Reconnect to resume syncing." : connection.email ?? "Your primary calendar"
                : "Connect to keep your personal calendar and Tempo in step."}
          </div>
        </div>
        {available && (!connection || connection.needsReauth) && (
          // A full navigation: the OAuth flow leaves the app.
          <a href={connectHref} className={buttonClass("filled", "md", true)}>{connection ? "Reconnect" : "Connect"}</a>
        )}
        {available && connection && !connection.needsReauth && (
          <Button
            variant="gray"
            pill
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await disconnectCalendar(slug);
                if (r.error) setError(r.error); else toast("Calendar disconnected");
              })
            }
          >
            Disconnect
          </Button>
        )}
      </div>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </section>
  );
}
