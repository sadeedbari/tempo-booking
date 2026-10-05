"use client";
import { useState, useTransition } from "react";
import { CalendarCheck, CalendarX2 } from "lucide-react";
import { Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-class";
import { useToast } from "@/components/ui/toast";
import { disconnectCalendar } from "../actions";

type Conn = { email: string | null; needsReauth: boolean };

export function CalendarCard({
  slug, providers, connections, result,
}: {
  slug: string;
  providers: { id: string; label: string }[];
  connections: Record<string, Conn>;
  result?: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="max-w-3xl">
      <h2 className="text-[20px] font-semibold">Your calendar</h2>
      <p className="mt-0.5 mb-4 text-[14px] text-label-2">
        Two-way sync with your Google or Outlook calendar. Tempo bookings appear on your calendar, and anything already on it blocks those times from online booking.
      </p>
      {result === "connected" && <div className="mb-3"><Notice tone="green">Calendar connected.</Notice></div>}
      {result === "denied" && <div className="mb-3"><Notice tone="blue">Calendar access wasn&apos;t granted, so nothing was connected.</Notice></div>}
      {result === "error" && <div className="mb-3"><Notice>Couldn&apos;t connect your calendar. Please try again.</Notice></div>}

      {providers.length === 0 ? (
        <div className="rounded-[16px] bg-surface p-5 text-[14px] text-label-2 shadow-sm hairline">Calendar sync isn&apos;t set up on this server yet.</div>
      ) : (
        <div className="divide-y divide-separator overflow-hidden rounded-[16px] bg-surface shadow-sm hairline">
          {providers.map((p) => {
            const conn = connections[p.id];
            const ok = conn && !conn.needsReauth;
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-4 p-5">
                <div className="grid size-12 place-items-center rounded-[13px] bg-accent-soft text-accent">
                  {ok ? <CalendarCheck className="size-6" /> : <CalendarX2 className="size-6" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[16px] font-semibold">
                    {p.label}
                    {conn && (conn.needsReauth ? <Badge tone="orange">Reconnect needed</Badge> : <Badge tone="green">Connected</Badge>)}
                  </div>
                  <div className="truncate text-[14px] text-label-2">
                    {conn
                      ? conn.needsReauth ? "Access was revoked or expired. Reconnect to resume syncing." : conn.email ?? "Your primary calendar"
                      : "Connect to keep your calendar and Tempo in step."}
                  </div>
                </div>
                {!ok ? (
                  // A full navigation: the OAuth flow leaves the app.
                  <a href={`/api/${p.id}/connect?org=${encodeURIComponent(slug)}`} className={buttonClass("filled", "md", true)}>{conn ? "Reconnect" : "Connect"}</a>
                ) : (
                  <Button
                    variant="gray"
                    pill
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await disconnectCalendar(slug, p.id);
                        if (r.error) setError(r.error); else toast("Calendar disconnected");
                      })
                    }
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </section>
  );
}
