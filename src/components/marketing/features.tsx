import { Bell, CalendarDays, Check, CreditCard, Hourglass, MessageSquareText, Repeat, Users } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Four big benefits, each with a picture and a few plain bullets, then one compact list for everything else.
 * Every line is traceable to code (see project/marketing/landing-page-copy.md section 4). The pictures are
 * stylised and use example names. Each is one described image (like the hero's), and the text beside it says it all.
 */

/* ───────────────────────── The four big benefits ───────────────────────── */

interface Bullet { title: string; body: string }
interface Benefit { id: string; title: string; intro: string; bullets: Bullet[]; picture: ReactNode; alt: string }

const SHELL = "rounded-[22px] glass-strong hairline p-1.5 shadow-lg sm:rounded-[26px] sm:p-2";
const INNER = "rounded-[18px] bg-surface p-4 text-left sm:rounded-[20px] sm:p-5";

function Avatar({ name, color }: { name: string; color: string }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white" style={{ background: color }}>{name[0]}</span>;
}

/** The customer's booking page: pick a time, repeat it. */
function BookingPicture() {
  const times = ["9:00", "10:00", "11:30", "1:00", "2:30", "4:00"];
  return (
    <div className={SHELL}>
      <div className={INNER}>
        <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="size-6 rounded-[7px] bg-gradient-to-b from-[#3D9BFF] to-[#0062E0]" /> Lumen Studio</div>
        <div className="mt-4 flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px]">
          <span className="size-2.5 rounded-full bg-[#007AFF]" /> <span className="font-medium">Haircut &amp; style</span> <span className="ml-auto text-label-2">45 min</span>
        </div>
        <div className="mt-4 text-[12px] font-semibold text-label-2">Wednesday, 15</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {times.map((t, i) => (
            <span key={t} className={`rounded-[10px] py-2 text-center text-[13px] font-semibold ${i === 1 ? "bg-accent-fill text-white" : "bg-surface-2 text-label"}`}>{t}</span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-[13px]">
          <Avatar name="Maya" color="#007AFF" /> <span className="text-label-2">With Maya</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium"><Repeat className="size-3.5" aria-hidden /> Every week</span>
        </div>
      </div>
    </div>
  );
}

/** A class roster with a waitlist that has just booked someone in. */
function ClassPicture() {
  const going = [["Ann Lee", "#34C759", "Attended"], ["Bo Chen", "#007AFF", "2 spots"], ["Cy Ruiz", "#AF52DE", ""]] as const;
  return (
    <div className={SHELL}>
      <div className={INNER}>
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold">Morning flow</div>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-text">7 of 8 booked</span>
        </div>
        <div className="mt-1 text-[12px] text-label-2">Wednesday, 15 · 9:00 AM</div>
        <ul className="mt-3 divide-y divide-separator">
          {going.map(([n, c, tag]) => (
            <li key={n} className="flex items-center gap-2.5 py-2.5 text-[13px]">
              <Avatar name={n} color={c} /> <span className="font-medium">{n}</span>
              {tag && <span className="ml-auto rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-label-2">{tag}</span>}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-start gap-2.5 rounded-[12px] bg-accent-soft px-3 py-2.5 text-[13px]">
          <Hourglass className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
          <span><span className="font-semibold text-accent-text">A spot opened up.</span> <span className="text-label">Wendy was next in line and is booked in.</span></span>
        </div>
      </div>
    </div>
  );
}

/** A deposit, a reminder email and a text. */
function MessagesPicture() {
  return (
    <div className={SHELL}>
      <div className={`${INNER} space-y-3`}>
        <div className="flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px]">
          <CreditCard className="size-4 text-label-2" aria-hidden /> <span className="font-medium">Deposit paid</span> <span className="ml-auto font-semibold">$25.00</span>
        </div>
        <div className="rounded-[14px] border border-separator p-3.5">
          <div className="text-[12px] text-label-2">Email · 24 hours before</div>
          <div className="mt-1 text-[14px] font-semibold">Reminder: Haircut tomorrow at 10:00 AM</div>
          <div className="mt-2 space-y-1.5" aria-hidden>
            <div className="h-2 w-11/12 rounded-full bg-surface-3" /><div className="h-2 w-9/12 rounded-full bg-surface-3" />
          </div>
        </div>
        <div className="flex">
          <div className="max-w-[85%] rounded-[16px] rounded-bl-[5px] bg-accent-fill px-3.5 py-2.5 text-[13px] text-white">Hi Ada, see you tomorrow at 10:00. Reply STOP to opt out.</div>
        </div>
      </div>
    </div>
  );
}

/** A visitor's browser with a booking button on a business's own site. */
function WebsitePicture() {
  return (
    <div className={SHELL}>
      <div className="overflow-hidden rounded-[18px] bg-surface sm:rounded-[20px]">
        <div className="flex items-center gap-1.5 border-b border-separator bg-surface-2 px-3.5 py-2.5">
          <span className="size-2.5 rounded-full bg-surface-3" /><span className="size-2.5 rounded-full bg-surface-3" /><span className="size-2.5 rounded-full bg-surface-3" />
          <span className="ml-3 flex-1 rounded-full bg-surface px-3 py-1 text-[12px] text-label-2">yourbusiness.com</span>
        </div>
        <div className="relative p-5 text-left sm:p-6">
          <div className="text-[18px] font-bold leading-tight">Your studio, your site</div>
          <div className="mt-3 space-y-2" aria-hidden>
            <div className="h-2 w-11/12 rounded-full bg-surface-3" /><div className="h-2 w-10/12 rounded-full bg-surface-3" /><div className="h-2 w-7/12 rounded-full bg-surface-3" />
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px] text-label-2"><MessageSquareText className="size-4" aria-hidden /> Ask us a question</div>
          <span className="mt-10 ml-auto flex w-fit items-center gap-1.5 rounded-full bg-accent-fill px-4 py-2.5 text-[13px] font-semibold text-white shadow-md"><CalendarDays className="size-4" aria-hidden /> Book now</span>
        </div>
      </div>
    </div>
  );
}

const BENEFITS: Benefit[] = [
  {
    id: "book", title: "Online booking for appointments", picture: <BookingPicture />,
    alt: "Illustration of a booking page with a service and times to choose from, and an option to repeat every week.",
    intro: "A calendar for you and one link for your customers: pick a service, a person and a time.",
    bullets: [
      { title: "Your booking page", body: "Share one link anywhere." },
      { title: "Repeat appointments", body: "Customers book every 1 to 4 weeks in one go. One confirmation lists every date." },
      { title: "Questions per service", body: "Ask what you need to know before the visit. Answers appear with the booking." },
      { title: "Approve requests", body: "Choose which services need your OK before a booking is confirmed." },
      { title: "Self-service links", body: "Customers can view, add to their calendar, or cancel their booking." },
    ],
  },
  {
    id: "classes", title: "Class booking with a waitlist", picture: <ClassPicture />,
    alt: "Illustration of a class roster showing who is coming, and a note that a waitlisted person was booked in when a spot opened.",
    intro: "For yoga, workshops, lessons and anything people book together.",
    bullets: [
      { title: "Classes with spots", body: "Set how many spots each session has. Customers book one or more, with guest names." },
      { title: "Weekly classes", body: "Add a class every week in one step. Change or cancel one session or all later ones." },
      { title: "Roster and walk-ins", body: "See who is coming, add walk-ins and mark who showed up." },
      { title: "Move or cancel", body: "Move one person or a whole session. Customers are told about the change." },
      { title: "Automatic waitlist", body: "When a class is full, customers join the waitlist. A free spot books them in automatically." },
    ],
  },
  {
    id: "money", title: "Deposits and reminders", picture: <MessagesPicture />,
    alt: "Illustration of a paid deposit, a reminder email and a text message.",
    intro: "Deposits, reminders and messages in your own words.",
    bullets: [
      { title: "Deposits with Stripe", body: "Take a deposit when customers book. It goes straight to your own Stripe account." },
      { title: "Reminders", body: "Confirmations and reminders by email, and by text for customers who agree to texts." },
      { title: "Your own wording", body: "Write your own customer emails and texts. Choose when each one sends." },
      { title: "Booking alerts", body: "Get a phone or computer alert when a booking is made, requested, changed or cancelled." },
    ],
  },
  {
    id: "website", title: "A booking page for your website", picture: <WebsitePicture />,
    alt: "Illustration of a business website with a Book now button.",
    intro: "Let visitors book or ask a question without leaving your site.",
    bullets: [
      { title: "Book from your site", body: "Add a pop-up or floating Book now button with one line of code." },
      { title: "Website contact form", body: "Use a hosted page, a pop-up or a form right on your page." },
      { title: "One inbox", body: "Messages arrive in Inquiries. You get a notice, and the sender becomes a customer." },
      { title: "Message to booking", body: "Turn a message into a booking in one tap. Senders can get an automatic thank-you." },
    ],
  },
];

/* ───────────────────────── Everything else ───────────────────────── */

interface Extra { title: string; body: string }
interface ExtraGroup { id: string; title: string; items: Extra[] }

const EXTRAS: ExtraGroup[] = [
  {
    id: "team", title: "Grow your team",
    items: [
      { title: "Roles for your team", body: "Owners, admins and staff each see what they should." },
      { title: "Staff without a login", body: "You manage their hours. Invite them later if you like." },
      { title: "Weekly hours and shifts", body: "Plan by week or month. Copy last week in one tap." },
      { title: "Multiple locations", body: "Each has its own schedule and team." },
      { title: "Two-places warning", body: "A warning if someone is scheduled at two locations at once." },
    ],
  },
  {
    id: "run", title: "Run the business",
    items: [
      { title: "A calendar you'll enjoy", body: "Day and week views, a column for each person." },
      { title: "Customer addresses", body: "For mobile services, optional or required." },
      { title: "Home dashboard", body: "Today, key numbers and a setup checklist." },
      { title: "Customer records", body: "Visit history and private notes." },
      { title: "Calendar sync", body: "Connect Google or Outlook. Busy times are not offered." },
      { title: "Excel export", body: "Home, Customers and Schedule." },
      { title: "Install on your phone", body: "It opens like an app." },
      { title: "Light or dark", body: "Or follow your device." },
      { title: "Private by design", body: "Each team's data is kept separate by database-level rules." },
    ],
  },
];

export function FeatureGroups() {
  return (
    <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-4 md:scroll-mt-20 px-4 py-14 sm:px-5 sm:py-20">
      <h2 id="features-title" className="text-balance text-center text-[clamp(1.875rem,6vw,2.75rem)] font-bold leading-tight tracking-tight">Everything you need to run your day.</h2>
      <p className="mx-auto mt-3 max-w-lg text-center text-lg text-label-2">Simple tools for booking, teams, classes and getting paid.</p>

      <div className="mt-14 space-y-16 sm:mt-16 sm:space-y-24">
        {BENEFITS.map((b, i) => (
          <div key={b.id} role="group" aria-labelledby={`group-${b.id}`} data-benefit={b.id} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <div className={i % 2 === 1 ? "lg:order-2" : ""}>
              <h3 id={`group-${b.id}`} className="text-balance text-[clamp(1.5rem,4.5vw,2rem)] font-bold leading-tight tracking-tight">{b.title}</h3>
              <p className="mt-2 text-lg leading-relaxed text-label-2">{b.intro}</p>
              <ul className="mt-6 space-y-3.5">
                {b.bullets.map((x) => (
                  <li key={x.title} className="flex gap-3">
                    <Check className="mt-1 size-5 shrink-0 text-accent-text" strokeWidth={2.6} aria-hidden />
                    <p className="min-w-0 text-base leading-relaxed text-label-2"><span className="font-semibold text-label">{x.title}.</span> {x.body}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div role="img" aria-label={b.alt} className={`min-w-0 ${i % 2 === 1 ? "lg:order-1" : ""}`}>{b.picture}</div>
          </div>
        ))}

        <div role="group" aria-labelledby="group-more" className="border-t border-separator pt-12 sm:pt-16">
          <h3 id="group-more" className="text-balance text-center text-[clamp(1.5rem,4.5vw,2rem)] font-bold leading-tight tracking-tight">And everything else</h3>
          <p className="mx-auto mt-2 max-w-lg text-center text-lg text-label-2">The small things that keep a busy day running.</p>
          <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-14">
            {EXTRAS.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`group-${g.id}`}>
                <h4 id={`group-${g.id}`} className="flex items-center gap-2 text-lg font-bold">
                  {g.id === "team" ? <Users className="size-5 text-accent-text" aria-hidden /> : <Bell className="size-5 text-accent-text" aria-hidden />}
                  {g.title}
                </h4>
                <ul className="mt-4 divide-y divide-separator">
                  {g.items.map((x) => (
                    <li key={x.title} className="flex gap-3 py-3">
                      <Check className="mt-1 size-4 shrink-0 text-accent-text" strokeWidth={2.6} aria-hidden />
                      <p className="min-w-0 text-base leading-relaxed text-label-2"><span className="font-semibold text-label">{x.title}.</span> {x.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-12 text-center text-base text-label-2">Pictures are illustrations. Names and bookings are examples.</p>
    </section>
  );
}
