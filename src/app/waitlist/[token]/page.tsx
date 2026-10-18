import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button-class";
import { formatDate, formatTime } from "@/lib/format";
import { LeaveWaitlist } from "./leave";

export const metadata: Metadata = { title: "Your waitlist spot", robots: { index: false } };

type Entry = {
  status: "waiting" | "booked" | "left" | "removed" | "closed";
  spots: number;
  position: number | null;
  starts_at: string;
  ends_at: string;
  session_status: string;
  service_name: string;
  name: string;
  booking_token: string | null;
  org: { name: string; slug: string; timezone: string; accent_color: string; phone: string | null };
};

export default async function WaitlistPage(props: PageProps<"/waitlist/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_waitlist_by_token", { p_token: token });
  const w = data as Entry | null;
  if (!w) notFound();
  const tz = w.org.timezone;
  const accent = w.org.accent_color || "#007AFF";
  const when = `${formatDate(w.starts_at, tz)} · ${formatTime(w.starts_at, tz)} – ${formatTime(w.ends_at, tz)}`;

  const title =
    w.status === "waiting" ? (sp.new === "1" ? "You're on the waitlist" : "You're on the waitlist")
    : w.status === "booked" ? "You're booked in"
    : w.status === "left" ? "You left the waitlist"
    : w.status === "removed" ? "You're no longer on the waitlist"
    : w.session_status === "cancelled" ? "This session was cancelled"
    : "This waitlist has closed";

  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-12" style={{ ["--accent" as string]: accent, ["--accent-soft" as string]: `${accent}1a` }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[380px] opacity-60 blur-3xl" style={{ background: `radial-gradient(40% 60% at 50% 20%, ${accent}33, transparent)` }} />
      <div className="w-full max-w-md animate-pop">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full text-white shadow-lg" style={{ background: w.status === "booked" ? "var(--green)" : accent }}>
            {w.status === "booked" ? <CheckCircle2 className="size-8" /> : <Clock className="size-8" />}
          </div>
          <h1 className="text-[28px] font-bold" data-testid="waitlist-title">{title}</h1>
          <p className="mt-1 text-[15px] text-label-2">{w.org.name}</p>
        </div>

        <div className="space-y-3 rounded-[20px] bg-surface p-5 shadow-md hairline">
          <div className="text-[18px] font-semibold">{w.service_name}</div>
          <div className="flex items-start gap-3 text-[15px] text-label-2"><CalendarClock className="mt-0.5 size-4 shrink-0" /> {when}</div>
          {w.spots > 1 && <div className="text-[14px] text-label-2">{w.spots} spots</div>}
          {w.status === "waiting" && (
            <p className="rounded-[12px] bg-surface-2 px-4 py-3 text-[15px]" data-testid="waitlist-position">
              Place in line: <strong>{w.position}</strong>. If a spot opens, you&apos;re booked in automatically and we email you straight away.
            </p>
          )}
          {w.status === "booked" && <p className="text-[15px] text-label-2">A spot opened up and you&apos;ve been booked in. Your confirmation is on its way.</p>}
          {w.status === "closed" && w.session_status === "cancelled" && <p className="text-[15px] text-label-2">The session was cancelled, so your place on the waitlist was released.</p>}
        </div>

        <div className="mt-5 space-y-2.5">
          {w.status === "booked" && w.booking_token && (
            <Link href={`/booking/${w.booking_token}`} className={buttonClass("glass", "lg", true, "w-full")}>View my booking</Link>
          )}
          {w.status === "waiting" && <LeaveWaitlist token={token} />}
          <Link href={`/${w.org.slug}`} className={buttonClass("glass", "lg", true, "w-full")}>See other sessions</Link>
        </div>
      </div>
    </div>
  );
}
