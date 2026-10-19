import {
  AlertTriangle, ArrowRightLeft, Bell, BellRing, Building2, CalendarDays, CalendarPlus, CalendarRange, CalendarSync, CircleCheck, ClipboardList,
  Contact, CreditCard, Download, Globe, Hourglass, House, Inbox, Link2, MapPin, MessageSquareText, Repeat, ShieldCheck, Smartphone, SunMoon,
  UserPlus, Users, Users2, Workflow, type LucideIcon,
} from "lucide-react";

type Tone = "blue" | "orange" | "green" | "purple" | "teal";
// Static class strings so Tailwind can see them. Icons are decorative, so the tinted tiles carry no meaning on their own.
const TONES: Record<Tone, string> = {
  blue: "bg-accent-soft text-accent-text",
  orange: "bg-[color-mix(in_srgb,var(--orange)_16%,transparent)] text-orange-text",
  green: "bg-[color-mix(in_srgb,var(--green)_16%,transparent)] text-green-text",
  purple: "bg-[color-mix(in_srgb,var(--purple)_16%,transparent)] text-purple",
  teal: "bg-[color-mix(in_srgb,var(--teal)_18%,transparent)] text-teal",
};

interface Feature { icon: LucideIcon; title: string; body: string }
interface Group { id: string; title: string; intro: string; tone: Tone; items: Feature[] }

// Every line is traceable to code (see project/marketing/landing-page-copy.md section 4).
const GROUPS: Group[] = [
  {
    id: "book", title: "Online booking for appointments", intro: "A calendar for you and a page for your customers.", tone: "blue",
    items: [
      { icon: CalendarDays, title: "A calendar you'll enjoy", body: "Day and week views with a column for each person. Tap an empty slot to add a booking." },
      { icon: Link2, title: "Your booking page", body: "One link where customers pick a service, a person and a time. Share it anywhere." },
      { icon: Repeat, title: "Repeat appointments", body: "Customers book every 1 to 4 weeks in one go. One confirmation lists every date." },
      { icon: ClipboardList, title: "Questions per service", body: "Ask what you need to know before the visit. Answers appear with the booking." },
      { icon: MapPin, title: "Customer addresses", body: "For mobile services. Ask for an address, optional or required, with a unit or apartment field." },
      { icon: CircleCheck, title: "Approve requests", body: "Choose which services need your OK. Online bookings wait until you confirm them." },
      { icon: CalendarPlus, title: "Self-service links", body: "Customers can view, add to their calendar, or cancel their booking from a link." },
    ],
  },
  {
    id: "classes", title: "Class booking with a waitlist", intro: "For yoga, workshops, lessons and anything people book together.", tone: "orange",
    items: [
      { icon: Users, title: "Classes with spots", body: "Set how many spots each session has. Customers book one or more, with guest names." },
      { icon: Repeat, title: "Weekly classes", body: "Add a class every week in one step. Change or cancel one session or all later ones." },
      { icon: ClipboardList, title: "Roster and walk-ins", body: "See who is coming, add walk-ins and mark who showed up." },
      { icon: ArrowRightLeft, title: "Move or cancel", body: "Move one person or a whole session. Customers are told about the change." },
      { icon: Hourglass, title: "Automatic waitlist", body: "When a class is full, customers join the waitlist. A free spot books them in automatically." },
    ],
  },
  {
    id: "team", title: "Grow your team", intro: "Add people and places when you are ready.", tone: "green",
    items: [
      { icon: Users2, title: "Roles for your team", body: "Owners, admins and staff each see and change only what they should." },
      { icon: UserPlus, title: "Staff without a login", body: "Add people who never sign in. You manage their hours. Invite them later if you like." },
      { icon: CalendarRange, title: "Weekly hours and shifts", body: "Set weekly hours or plan shifts by week or month. Copy last week in one tap." },
      { icon: Building2, title: "Multiple locations", body: "Each location gets its own schedule and team. Customers choose where to book." },
      { icon: AlertTriangle, title: "Two-places warning", body: "Get a warning when someone is scheduled at two locations at the same time." },
    ],
  },
  {
    id: "money", title: "Deposits and reminders", intro: "Deposits, reminders and messages in your own words.", tone: "purple",
    items: [
      { icon: CreditCard, title: "Deposits with Stripe", body: "Take a deposit when customers book. It goes straight to your own Stripe account." },
      { icon: BellRing, title: "Reminders", body: "Confirmations and reminders by email, and by text for customers who agree to texts." },
      { icon: Workflow, title: "Your own wording", body: "Write your own customer emails and texts. Choose when each one sends." },
      { icon: Bell, title: "Booking alerts", body: "Get a phone or computer alert when a booking is made, requested, changed or cancelled." },
    ],
  },
  {
    id: "website", title: "A booking page for your website", intro: "Let visitors book or ask a question without leaving your site.", tone: "teal",
    items: [
      { icon: Globe, title: "Book from your site", body: "Add a pop-up or floating Book now button with one line of code." },
      { icon: MessageSquareText, title: "Website contact form", body: "Use a hosted page, a pop-up or a form right on your page." },
      { icon: Inbox, title: "One inbox", body: "Messages arrive in Inquiries. You get a notice, and the sender becomes a customer." },
      { icon: CalendarPlus, title: "Message to booking", body: "Turn a message into a booking in one tap. Senders can get an automatic thank-you." },
    ],
  },
  {
    id: "run", title: "Run the business", intro: "Know how the week is going, then get back to work.", tone: "blue",
    items: [
      { icon: House, title: "Home dashboard", body: "See today, key numbers and a setup checklist with a progress ring." },
      { icon: Download, title: "Excel export", body: "Download Home, Customers and Schedule as Excel files." },
      { icon: Contact, title: "Customer records", body: "Customers are added from bookings, with visit history and private notes." },
      { icon: CalendarSync, title: "Calendar sync", body: "Connect your own Google or Outlook calendar. Bookings appear there and busy times are not offered." },
      { icon: Smartphone, title: "Install on your phone", body: "Add Tempo to your iPhone or Android home screen. It opens like an app." },
      { icon: SunMoon, title: "Light or dark", body: "Choose light, dark, or follow your device." },
      { icon: ShieldCheck, title: "Private by design", body: "Each team's data is kept separate by database-level rules." },
    ],
  },
];

export function FeatureGroups() {
  return (
    <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-4 md:scroll-mt-20 px-4 py-14 sm:px-5 sm:py-20">
      <h2 id="features-title" className="text-balance text-center text-[clamp(1.875rem,6vw,2.75rem)] font-bold leading-tight tracking-tight">Everything you need to run your day.</h2>
      <p className="mx-auto mt-3 max-w-lg text-center text-lg text-label-2">Simple tools for booking, teams, classes and getting paid.</p>

      <div className="mt-12 space-y-14">
        {GROUPS.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`group-${g.id}`}>
            <h3 id={`group-${g.id}`} className="text-2xl font-bold tracking-tight">{g.title}</h3>
            <p className="mt-1 text-base text-label-2">{g.intro}</p>
            <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((f) => (
                <li key={f.title} className="min-w-0 rounded-[22px] bg-surface p-5 shadow-sm hairline sm:p-6">
                  <div className={`grid size-11 place-items-center rounded-[12px] ${TONES[g.tone]}`}>
                    <f.icon className="size-5" strokeWidth={2.2} aria-hidden />
                  </div>
                  <h4 className="mt-4 text-lg font-semibold">{f.title}</h4>
                  <p className="mt-1.5 text-base leading-relaxed text-label-2">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
