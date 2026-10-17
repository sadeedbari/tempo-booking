import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarPlus, Clock, MapPin, Phone, Repeat, User, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button-class";
import { Badge, Notice, statusTone } from "@/components/ui/misc";
import { LogoMark } from "@/components/app/logo";
import { formatDate, formatMoney, formatTime, STATUS_LABEL, timeZoneLabel } from "@/lib/format";
import { CancelBooking } from "./cancel";
import { CancelSeries } from "./cancel-series";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };

type PublicBooking = {
  id: string; status: string; starts_at: string; ends_at: string; service_name: string;
  price_cents: number; deposit_cents: number; currency: string; payment_status: string; notes: string | null;
  customer_name: string; customer_email: string; staff_name: string | null;
  location_type: string | null; location_detail: string | null; location_name: string | null; location_address: string | null; customer_address: string | null;
  org: { name: string; slug: string; timezone: string; address: string | null; phone: string | null; accent_color: string; cancellation_window_hours: number };
};

export default async function ManageBookingPage(props: PageProps<"/booking/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_booking_by_token", { p_token: token });
  const b = data as PublicBooking | null;
  if (!b) notFound();
  const { data: seriesData } = await supabase.rpc("get_series_by_token", { p_token: token });
  const series = seriesData as { interval_weeks: number; index: number; total: number; items: { starts_at: string; status: string; current: boolean }[] } | null;
  const skipped = Number(sp.skipped) || 0;

  const tz = b.org.timezone;
  const accent = b.org.accent_color || "#007AFF";
  const fresh = sp.new === "1" || sp.paid === "1";
  const cancelled = b.status === "cancelled";
  const pendingPay = b.status === "pending_payment";
  const awaiting = b.status === "pending_approval";
  const canCancel = isCancellable(b);

  const where =
    b.customer_address
      ? { icon: MapPin, text: b.customer_address }
      : b.location_type === "video"
      ? { icon: Video, text: b.location_detail || "Video call — link to follow" }
      : b.location_type === "phone"
        ? { icon: Phone, text: "Phone call" }
        : { icon: MapPin, text: [b.location_name, b.location_address || b.location_detail || b.org.address].filter(Boolean).join(" — ") };

  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-12" style={{ ["--accent" as string]: accent, ["--accent-soft" as string]: `${accent}1a` }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[380px] opacity-60 blur-3xl"
        style={{ background: `radial-gradient(40% 60% at 50% 20%, ${accent}33, transparent)` }} />
      <div className="w-full max-w-md animate-pop">
        <div className="mb-6 text-center">
          {fresh && !cancelled ? (
            <>
              <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full text-white shadow-lg" style={{ background: pendingPay || awaiting ? "var(--orange)" : "var(--green)" }}>
                <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: "draw .5s .15s ease forwards" }} />
                </svg>
                <style>{`@keyframes draw{to{stroke-dashoffset:0}}`}</style>
              </div>
              <h1 className="text-[28px] font-bold">{pendingPay ? "Almost there" : awaiting ? "Request sent" : "You're booked!"}</h1>
              <p className="mt-1 text-[15px] text-label-2">
                {pendingPay
                  ? "We're confirming your payment. This page will update shortly."
                  : awaiting
                    ? `${b.org.name} will review your request and email ${b.customer_email} once it's confirmed.`
                    : `A confirmation is on its way to ${b.customer_email}.`}
              </p>
            </>
          ) : (
            <>
              {sp.moved === "1" && !cancelled && <div className="mx-auto mb-3 max-w-xs"><Notice tone="green">Your booking has been moved.</Notice></div>}
              <h1 className="text-[28px] font-bold">{cancelled ? "Booking cancelled" : awaiting ? "Awaiting confirmation" : "Your booking"}</h1>
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

        {series && series.total > 1 && (
          <div className="mt-5 rounded-[22px] bg-surface p-5 shadow-sm hairline" data-testid="series-card">
            <div className="flex items-center gap-2 text-[15px] font-semibold"><Repeat className="size-4 text-accent" /> Repeating appointment</div>
            <p className="mt-0.5 text-[13px] text-label-2">
              {series.index} of {series.total} · {series.interval_weeks === 1 ? "every week" : `every ${series.interval_weeks} weeks`}
            </p>
            {fresh && skipped > 0 && (
              <div className="mt-3"><Notice tone="blue">{skipped === 1 ? "1 date wasn't available and was skipped." : `${skipped} dates weren't available and were skipped.`} You can book those separately.</Notice></div>
            )}
            <ul className="mt-3 divide-y divide-separator">
              {series.items.map((it) => (
                <li key={it.starts_at} className={`flex items-center justify-between gap-3 py-2 text-[14px] ${it.current ? "font-semibold" : ""}`}>
                  <span className={it.status === "cancelled" ? "text-label-3 line-through" : ""}>
                    {formatDate(it.starts_at, tz)} · {formatTime(it.starts_at, tz)}
                  </span>
                  {it.current ? <Badge tone="blue">This one</Badge> : it.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 space-y-2.5">
          {!cancelled && !awaiting && (
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
          {canCancel && series && laterActive(series) > 1 && <CancelSeries token={token} count={laterActive(series)} />}
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
          <Link href="/" className="inline-flex min-h-10 items-center gap-1.5 text-[12px] font-medium text-label-3"><LogoMark className="size-4" /> Powered by Tempo</Link>
        </div>
      </div>
      {pendingPay && <meta httpEquiv="refresh" content="4" />}
    </div>
  );
}

/** How many appointments "cancel this and all later ones" would cancel, this one included. */
function laterActive(series: { items: { starts_at: string; status: string; current: boolean }[] }) {
  const here = series.items.find((i) => i.current);
  if (!here) return 0;
  return series.items.filter((i) => i.starts_at >= here.starts_at && ["confirmed", "pending_payment", "pending_approval"].includes(i.status)).length;
}

function isCancellable(b: PublicBooking) {
  if (b.status === "pending_approval") return true; // a request can always be withdrawn
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
