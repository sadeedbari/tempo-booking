import type { Metadata } from "next";
import { H2, LegalPage, UL } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Tempo handles account, booking and calendar information.",
};

export default function PrivacyPage() {
  const email = <a className="inline-block py-1.5 text-accent underline" href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
  return (
    <LegalPage title="Privacy Policy" updated="October 15, 2026">
      <p>
        {LEGAL.product} is an online scheduling service operated by {LEGAL.operator} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). It lets
        businesses take bookings from their customers and manage their team&apos;s schedule. This policy explains what
        information {LEGAL.product} handles, why, and the choices you have. Questions or requests: {email}.
      </p>

      <H2>Who this covers</H2>
      <UL>
        <li><strong>Business users</strong>: people who sign up for {LEGAL.product} to run a business and its team.</li>
        <li><strong>Customers</strong>: people who book an appointment through a business&apos;s {LEGAL.product} booking page.</li>
      </UL>
      <p>
        When a customer books with a business, that business decides what is collected and how it is used, and {LEGAL.product}
        processes the information on the business&apos;s behalf. For questions about a specific booking, contact the business first.
      </p>

      <H2>Information we handle</H2>
      <UL>
        <li><strong>Account information</strong>: name, email address and a password (stored only as a secure hash) for business users.</li>
        <li><strong>Business information</strong>: business name, address, services, prices, team members, working hours, schedules and settings.</li>
        <li><strong>Booking information</strong>: the customer&apos;s name, email address, optional phone number and optional notes, plus the service, time and staff member booked.</li>
        <li><strong>Answers to a business&apos;s booking questions</strong>: a business can ask questions when you book a service (for example about allergies or preferences). The answers you give are stored with that booking and are visible to the business and its team. Answer only what you are comfortable sharing with the business.</li>
        <li><strong>Website contact-form messages</strong>: when a business adds the {LEGAL.product} contact form to its website, a visitor who uses it sends their name, email address, optional phone number, the service they are interested in and their message. These go to that business, are stored in its {LEGAL.product} account, and create or update a customer record for that visitor.</li>
        <li><strong>Payment information</strong>: deposits are paid on Stripe&apos;s secure page. We never see or store card numbers; we keep only the payment status and a reference.</li>
        <li><strong>Calendar information</strong>: only if a team member chooses to connect a Google or Microsoft calendar (see below).</li>
        <li><strong>Technical information</strong>: basic logs such as IP address and browser type, used to keep the service secure and working.</li>
      </UL>

      <H2>How we use it</H2>
      <UL>
        <li>To provide the service: show open times, create and manage bookings, and show businesses their schedules.</li>
        <li>To send confirmations, reminders, change notices and approval requests by email and, where enabled, by text message.</li>
        <li>To pass a contact-form message to the business and its team (by email and app notification), and to send the visitor an automatic email confirming it was received, if the business has that message turned on. We use a contact-form visitor&apos;s details only to answer them, and never for our own marketing.</li>
        <li>To take deposits and process refunds through Stripe.</li>
        <li>To secure the service, prevent abuse and fix problems.</li>
      </UL>
      <p>We do not sell personal information, and we do not use it for advertising.</p>

      <H2>Google and Microsoft calendar data</H2>
      <p>
        A team member can connect their own Google Calendar or Outlook calendar from the Team page. This is optional and can be
        removed at any time.
      </p>
      <p><strong>What we access.</strong> We ask for permission to view and edit events on the calendar the person connects. We use that access for exactly two things:</p>
      <UL>
        <li><strong>Add bookings to your calendar.</strong> When a booking is confirmed, changed or cancelled, {LEGAL.product} creates, updates or removes the matching event on your calendar. The event includes the service, time, the customer&apos;s name and contact details, and any notes the customer entered.</li>
        <li><strong>Avoid double-booking.</strong> {LEGAL.product} reads the start and end times of the events already on your calendar so those times are not offered to customers. For this we keep only each event&apos;s identifier and its start and end times. We do not store the titles, descriptions, locations or attendees of your existing events.</li>
      </UL>
      <p>
        <strong>How it is protected.</strong> Access tokens are encrypted before they are stored, and only our servers can read them.
        We never use your calendar data for anything other than the two purposes above.
      </p>
      <p>
        <strong>Disconnecting.</strong> Disconnect any time from the Team page in {LEGAL.product}. We then revoke our access, delete your stored
        tokens and delete the saved copies of your event times. Events {LEGAL.product} already added to your calendar stay there until you delete them.
        You can also remove access from your Google Account (Security, then Third-party access) or your Microsoft account&apos;s app permissions.
      </p>
      <p>
        {LEGAL.product}&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
        <a className="text-accent underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. In particular, we do not sell Google user data, do not use it for advertising,
        do not allow humans to read it except with your consent, for security purposes or to comply with law, and do not use it to develop,
        improve or train generalized artificial-intelligence or machine-learning models.
      </p>

      <H2>Who we share information with</H2>
      <p>We use a small number of service providers to run {LEGAL.product}. They handle information only to provide their service to us:</p>
      <UL>
        <li>Supabase: database and sign-in.</li>
        <li>Vercel: hosting.</li>
        <li>Stripe: payments and deposits.</li>
        <li>Resend: sending email.</li>
        <li>Twilio: sending text messages, when a business turns this on.</li>
        <li>Google and Microsoft: calendar sync, only for people who connect a calendar.</li>
      </UL>
      <p>
        A booking&apos;s details (including answers to its booking questions), and any contact-form message, are visible to the business they were sent to and to that business&apos;s team members, according to their roles.
        We may also disclose information if the law requires it.
      </p>

      <H2>How long we keep it</H2>
      <p>
        We keep information for as long as the account or booking record is needed to provide the service. A business can delete its data,
        and anyone can ask us to delete information about them (see below). Calendar tokens and copied event times are deleted when a calendar is disconnected.
      </p>

      <H2>Your choices and rights</H2>
      <p>
        You can ask to see, correct or delete personal information we hold about you, or withdraw a permission you gave, by emailing {email}.
        Customers should also contact the business they booked with, which controls their booking records. We will respond within a reasonable time.
      </p>

      <H2>Security</H2>
      <p>
        Connections to {LEGAL.product} use HTTPS. Each business&apos;s data is separated from others by database-level access rules, and sensitive tokens are
        encrypted at rest. No system is perfectly secure, but we work to protect your information and will tell affected users if a breach puts them at risk.
      </p>

      <H2>Children</H2>
      <p>{LEGAL.product} is not directed at children under 13, and we do not knowingly collect their information.</p>

      <H2>Changes to this policy</H2>
      <p>If we make a significant change we will update the date above and, where appropriate, tell users in the app or by email.</p>

      <H2>Contact</H2>
      <p>{LEGAL.operator} · {email}</p>
    </LegalPage>
  );
}
