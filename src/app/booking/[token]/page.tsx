import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarPlus, Clock, MapPin, Phone, User, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Notice, statusTone } from "@/components/ui/misc";
import { LogoMark } from "@/components/app/logo";
import { formatDate, formatMoney, formatTime, STATUS_LABEL, timeZoneLabel } from "@/lib/format";
import { CancelBooking } from "./cancel";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };

type PublicBooking = {
  id: string; status: string; starts_at: string; ends_at: string; service_name: string;
  price_cents: number; deposit_cents: number; currency: string; payment_status: string; notes: string | null;
  customer_name: string; customer_email: string; staff_name: string | null;
  location_type: string | null; location_detail: string | null;
  org: { name: string; slug: string; timezone: string; address: string | null; phone: string | null; accent_color: string; cancellation_window_hours: number };
};

export default async function ManageBookingPage(props: PageProps<"/booking/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_booking_by_token", { p_token: token });
  const b = data as PublicBooking | null;
  if (!b) notFound();

  const tz = b.org.timezone;
  const accent = b.org.accent_color || "#007AFF";
  const fresh = sp.new === "1" || sp.paid === "1";
  const cancelled = b.status === "cancelled";
  const pendingPay = b.status === "pending_payment";
  const canCancel = isCancellable(b);

  const where =
    b.location_type === "video"
      ? { icon: Video, text: b.location_detail || "Video call — link to follow" }
      : b.location_type === "phone"
        ? { icon: Phone, text: "Phone call" }
        : { icon: MapPin, text: b.location_detail || b.org.address || "" };

  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-12" style={{ ["--accent" as string]: accent, ["--accent-soft" as string]: `${accent}1a` }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[380px] opacity-60 blur-3xl"
        style={{ background: `radial-gradient(40% 60% at 50% 20%, ${accent}33, transparent)` }} />
      <div className="w-full max-w-md animate-pop">
        <div className="mb-6 text-center">
          {fresh && !cancelled ? (
            <>
              <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full text-white shadow-lg" style={{ background: pendingPay ? "var(--orange)" : "var(--green)" }}>
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: "draw .5s .15s ease forwards" }} />
                </svg>
                <style>{`@keyframes draw{to{stroke-dashoffset:0}}`}</style>
              </div>
              <h1 className="text-[28px] font-bold">{pendingPay ? "Almost there" : "You're booked!"}</h1>
              <p className="mt-1 text-[15px] text-label-2">
                {pendingPay ? "We're confirming your payment. This page will update shortly." : `A confirmation is on its way to ${b.customer_email}.`}
              </p>
            </>
          ) : (
            <>
              {sp.moved === "1" && !cancelled && <div className="mx-auto mb-3 max-w-xs"><Notice tone="green">Your booking has been moved.</Notice></div>}
              <h1 className="text-[28px] font-bold">{cancelled ? "Booking cancelled" : "Your booking"}</h1>
              <p className="mt-1 text-[15px] text-label-2">with {b.org.name}</p>
            </>
          )}
        </div>

        <div className="overflow-hidden rounded-[22px] bg-surface shadow-md hairline">
          <div className="flex items-center justify-between border-b border-separator px-5 py-4">
            <div>
              <div className="text-[18px] font-semibold">{b.service_name}</div>
              <div className="text-[14px] text-label-2">{b.org.name}</div>
            </div>
            <Badge tone={statusTone(b.status)}>{STATUS_LABEL[b.status]}</Badge>
          </div>
          <div className={`space-y-3.5 px-5 py-4 text-[15px] ${cancelled ? "opacity-50" : ""}`}>
            <Row icon={Clock}>
              <div className="font-medium">{formatDate(b.starts_at, tz)}</div>
              <div className="text-label-2">{formatTime(b.starts_at, tz)} – {formatTime(b.ends_at, tz)} {timeZoneLabel(tz)}</div>
            </Row>
            {b.staff_name && <Row icon={User}>{b.staff_name}</Row>}
            {where.text && <Row icon={where.icon}>{where.text}</Row>}
            {b.price_cents > 0 && (
              <div className="flex items-center justify-between border-t border-separator pt-3.5 text-[14px]">
                <span className="text-label-2">{b.payment_status === "paid" ? `Deposit paid · balance due` : "Total"}</span>
                <span className="font-semibold">
                  {b.payment_status === "paid" ? formatMoney(b.price_cents - b.deposit_cents, b.currency) : formatMoney(b.price_cents, b.currency)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          {!cancelled && (
            <a href={`/booking/${token}/ics`} className={buttonClass("glass", "lg", true, "w-full")}>
              <CalendarPlus className="size-5 text-accent" /> Add to Calendar
            </a>
          )}
          {canCancel && b.status === "confirmed" && (
            <Link href={`/booking/${token}/reschedule`} className={buttonClass("glass", "lg", true, "w-full")}>
              <CalendarClock className="size-5 text-accent" /> Reschedule
            </Link>
          )}
          {canCancel && <CancelBooking token={token} />}
          {!canCancel && !cancelled && b.status === "confirmed" && (
            <p className="px-4 text-center text-[13px] text-label-3">
              Need to change something? {b.org.phone ? <>Call {b.org.name} at <a className="text-accent" href={`tel:${b.org.phone}`}>{b.org.phone}</a>.</> : `Contact ${b.org.name}.`}
            </p>
          )}
          <Link href={`/${b.org.slug}`} className={buttonClass("plain", "lg", true, "w-full")}>
            {cancelled ? "Book a new time" : `Book another with ${b.org.name}`}
          </Link>
        </div>
        <div className="mt-10 text-center">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-label-3"><LogoMark className="size-4" /> Powered by Tempo</Link>
        </div>
      </div>
      {pendingPay && <meta httpEquiv="refresh" content="4" />}
    </div>
  );
}

function isCancellable(b: PublicBooking) {
  if (b.status !== "confirmed" && b.status !== "pending_payment") return false;
  return new Date(b.starts_at).getTime() - Date.now() > b.org.cancellation_window_hours * 3600_000;
}

function Row({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-[18px] shrink-0 text-label-3" />
      <div>{children}</div>
    </div>
  );
}
