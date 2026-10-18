import { CalendarOff } from "lucide-react";

/**
 * Shown on the public booking page and the website pop-up when the business has no active plan. Deliberately neutral:
 * a customer needs to know they can't book here right now, not why.
 */
export function BookingPaused({ name, phone, website, embed = false }: { name: string; phone?: string | null; website?: string | null; embed?: boolean }) {
  return (
    <main className={embed ? "grid place-items-center p-6" : "grid min-h-dvh place-items-center p-6"}>
      <div role="status" className="w-full max-w-md rounded-[20px] bg-surface p-8 text-center shadow-sm hairline">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-[16px] bg-surface-2 text-label-2"><CalendarOff className="size-7" aria-hidden /></div>
        <h1 className="text-[22px] font-semibold">{name} isn&apos;t accepting bookings right now</h1>
        <p className="mt-2 text-[15px] text-label-2">Online booking is paused. Please check back later{phone || website ? ", or contact them directly" : ""}.</p>
        {(phone || website) && (
          <p className="mt-3 text-[15px] text-label-2">
            {phone && <span>{phone}</span>}
            {phone && website && <span> · </span>}
            {website && /^https?:\/\//i.test(website) && <a href={website} className="text-accent underline" rel="noopener noreferrer">{website.replace(/^https?:\/\//i, "")}</a>}
          </p>
        )}
      </div>
    </main>
  );
}
