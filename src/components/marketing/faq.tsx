import { ChevronDown } from "lucide-react";
import { BASE_CENTS, GRACE_DAYS, LOCATION_CENTS, PACK_CENTS, STAFF_PER_LOCATION, STAFF_PER_PACK, TRIAL_DAYS, TRIAL_LIMITS, money } from "@/lib/billing";
import { LEGAL } from "@/lib/legal";

const FAQS: { q: string; a: string }[] = [
  {
    q: "How does the free trial work?",
    a: `You get ${TRIAL_DAYS} days from the day you create your team. The trial includes ${TRIAL_LIMITS.locations} location and ${TRIAL_LIMITS.staff} staff. There is one free trial per person.`,
  },
  {
    q: "Do I need a credit card to start?",
    a: "No. You only add payment details when you choose to subscribe. Card details are handled by Stripe and never stored by Tempo.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Cancel from your billing page. You keep access until the end of the period you paid for, and you can change your mind before then.",
  },
  {
    q: "What happens when my trial ends or a payment fails?",
    a: `Your dashboard becomes view-only and your booking page pauses, so no new bookings come in. Nothing is deleted. If a payment fails, you have ${GRACE_DAYS} days to fix it first. Subscribe or update your card and everything returns right away. Customers can still change or cancel a booking they already made.`,
  },
  {
    q: "Can I add locations or staff later?",
    a: `Yes. Add an extra location for ${money(LOCATION_CENTS)}/month (it includes ${STAFF_PER_LOCATION} more staff) or a staff pack for ${money(PACK_CENTS)}/month (${STAFF_PER_PACK} more staff). If you reach your limit, Tempo shows you what to add. Upgrades are charged pro rata. The base plan is ${money(BASE_CENTS)}/month, in Canadian dollars, plus applicable taxes where required.`,
  },
  {
    q: "Who can see billing?",
    a: "Only the owner. Admins and staff see whether the plan is active and who to ask, but not prices, dates or payment details.",
  },
  {
    q: "What happens to my data and my customers' data?",
    a: `Each business's data is kept separate from every other business. Tempo does not sell personal information or use it for advertising. Deposits are paid on Stripe's secure page, and Tempo never sees or stores card numbers. You can ask to see, correct or delete information by emailing ${LEGAL.contactEmail}. Read the full Privacy Policy for the service providers Tempo uses.`,
  },
  {
    q: "Which kinds of businesses use Tempo?",
    a: "Tempo is a booking system and scheduling tool built for salons, clinics, studios, classes, consultants and mobile services. It is not a medical records system, so please do not store clinical notes in it.",
  },
];

/** Native <details>/<summary>: keyboard (Enter/Space), screen readers and no-JS all work without extra code. */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-3xl scroll-mt-4 md:scroll-mt-20 px-4 py-14 sm:px-5 sm:py-20">
      <h2 id="faq-title" className="text-balance text-center text-[clamp(1.875rem,6vw,2.75rem)] font-bold leading-tight tracking-tight">Questions, answered.</h2>
      <div className="mt-10 overflow-hidden rounded-[22px] bg-surface shadow-sm hairline">
        {FAQS.map((f) => (
          <details key={f.q} className="group border-b border-separator last:border-b-0">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 sm:px-5 py-3 text-base font-semibold hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{f.q}</span>
              <ChevronDown className="size-5 flex-none shrink-0 text-label-2 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="px-5 pb-5 text-base leading-relaxed text-label-2">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-6 text-center text-base text-label-2">
        Still unsure? Email us at{" "}
        <a href={`mailto:${LEGAL.contactEmail}`} className="inline-block max-w-full py-2.5 font-medium text-accent-text underline [overflow-wrap:anywhere]">{LEGAL.contactEmail}</a>.
      </p>
    </section>
  );
}
