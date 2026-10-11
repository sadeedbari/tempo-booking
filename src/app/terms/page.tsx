import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPage, UL } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Tempo.",
};

export default function TermsPage() {
  const email = <a className="text-accent underline" href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms apply when you use {LEGAL.product}, an online scheduling service operated by {LEGAL.operator}. By creating an account or using a{" "}
        {LEGAL.product} booking page you agree to them. If you don&apos;t agree, please don&apos;t use the service.
      </p>

      <H2>The service</H2>
      <p>
        {LEGAL.product} lets businesses publish a booking page, take appointments, manage their team&apos;s schedule and, optionally, collect deposits,
        send reminders and sync calendars. We may improve, change or remove features over time.
      </p>

      <H2>Accounts</H2>
      <UL>
        <li>You must give accurate information and keep your sign-in details secure. You are responsible for activity under your account.</li>
        <li>The person who creates a business is its owner and decides who else can join and with what role.</li>
        <li>Tell us promptly at {email} if you think your account has been accessed without permission.</li>
      </UL>

      <H2>Businesses and their customers</H2>
      <p>
        Businesses are responsible for their services, prices, availability, cancellation and refund policies, and for how they treat their customers&apos;
        information. A booking is an agreement between the customer and the business, not with {LEGAL.operator}. If a business uses {LEGAL.product} to
        collect personal information, it is responsible for doing so lawfully and for having any consents it needs.
      </p>

      <H2>Payments</H2>
      <p>
        Deposits are processed by Stripe and paid to the business&apos;s own Stripe account. Stripe&apos;s terms apply to payments. Refunds are the business&apos;s
        decision, except where {LEGAL.product} refunds a deposit automatically (for example, when a booking request is declined, withdrawn or not answered in time).
        We may charge a platform fee on deposits where a business has been told so in advance.
      </p>

      <H2>Calendar connections</H2>
      <p>
        Connecting a Google or Microsoft calendar is optional. You are authorising {LEGAL.product} to add bookings to your calendar and to read event times to avoid double-booking,
        as described in our <Link className="text-accent underline" href="/privacy">Privacy Policy</Link>. You can disconnect at any time.
      </p>

      <H2>Acceptable use</H2>
      <p>You agree not to:</p>
      <UL>
        <li>break the law or use {LEGAL.product} to deceive, harass or harm others;</li>
        <li>send spam or unsolicited messages through {LEGAL.product};</li>
        <li>attempt to access other people&apos;s data, disrupt the service, or probe it for weaknesses without permission;</li>
        <li>copy, resell or reverse-engineer the service, except where the law allows.</li>
      </UL>

      <H2>Your content</H2>
      <p>
        You keep ownership of the information you put into {LEGAL.product}. You give us permission to store and process it so we can run the service for you.
      </p>

      <H2>Availability and changes</H2>
      <p>
        We work to keep {LEGAL.product} available, but we can&apos;t promise it will be uninterrupted or error-free. Emails, texts and calendar syncs depend on
        third-party services and may be delayed or fail. Businesses should not rely on {LEGAL.product} alone for time-critical or safety-critical scheduling.
      </p>

      <H2>Ending your use</H2>
      <p>
        You can stop using {LEGAL.product} at any time and ask us to delete your account. We may suspend or end access if these terms are broken or if needed to
        protect the service or other users.
      </p>

      <H2>Liability</H2>
      <p>
        The service is provided &ldquo;as is&rdquo;. To the extent the law allows, {LEGAL.operator} is not liable for indirect or consequential losses, lost profits or lost
        bookings arising from use of the service, and our total liability for any claim is limited to the amount you paid us for the service in the three months before it arose.
        Nothing in these terms limits rights you have under law that can&apos;t be excluded.
      </p>

      <H2>Changes to these terms</H2>
      <p>We may update these terms. If a change is significant we will update the date above and, where appropriate, notify you. Continuing to use {LEGAL.product} after a change means you accept it.</p>

      <H2>Contact</H2>
      <p>{LEGAL.operator} · {email}</p>
    </LegalPage>
  );
}
