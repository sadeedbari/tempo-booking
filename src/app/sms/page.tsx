import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPage, UL } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Text message terms",
  description: "How booking text messages work: what you receive, how often, how to stop, and how your number is used.",
};

/** The terms of the booking text messages (the page the consent box on the booking form links to). Change the wording here. */
export default function SmsTermsPage() {
  const email = <a className="text-accent underline" href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
  return (
    <LegalPage title="Text message terms">
      <p>
        These terms explain the text messages you can choose to receive when you book with a business that uses {LEGAL.product}, an online booking service
        operated by {LEGAL.operator}. The messages come from the business you booked with, and every text starts with that business&apos;s name.{" "}
        {LEGAL.product} delivers them for the business.
      </p>

      <H2>What you will receive</H2>
      <p>Only messages about a booking you made:</p>
      <UL>
        <li>A confirmation when your booking is confirmed.</li>
        <li>A reminder before your appointment or class.</li>
        <li>A notice if your booking changes or is cancelled.</li>
      </UL>
      <p>We do not send marketing or promotional text messages.</p>

      <H2>How you agree</H2>
      <p>
        You agree by ticking the box next to the phone number field on the booking form. The box is never ticked for you. Agreeing is not required to book: if
        you leave it unticked, you still get your booking and your emails, and no text messages are sent.
      </p>

      <H2>How often</H2>
      <p>Message frequency varies with your bookings. Usually it is one confirmation and one reminder for each booking you make.</p>

      <H2>Cost</H2>
      <p>Message and data rates may apply, according to your mobile plan. Neither the business nor {LEGAL.product} charges you for the texts.</p>

      <H2>Stop or get help</H2>
      <UL>
        <li>
          <strong className="text-label">To stop:</strong> reply STOP to any text. You will get one message confirming that you have been unsubscribed and
          no more booking texts after that. Your booking emails continue.
        </li>
        <li>
          <strong className="text-label">For help:</strong> reply HELP to any text, or email {email}. You can also contact the business directly using the
          details on its booking page.
        </li>
        <li>To start again, book again and tick the box, or reply START.</li>
      </UL>

      <H2>Your mobile number</H2>
      <p>
        We use your mobile number only to send you the booking messages described above. We do not sell it. We do not share your mobile number, or the fact
        that you agreed to receive texts, with third parties or affiliates for marketing or promotional purposes. Text messages are delivered through a
        messaging provider that handles them only to send them to you. More about how we handle personal information is in our{" "}
        <Link className="text-accent underline" href="/privacy">Privacy Policy</Link>.
      </p>

      <H2>Carriers</H2>
      <p>Mobile carriers are not liable for delayed or undelivered messages.</p>

      <H2>Contact</H2>
      <p>
        Questions about these terms: {email}. {LEGAL.operator} operates {LEGAL.product}. The general{" "}
        <Link className="text-accent underline" href="/terms">Terms of Service</Link> also apply.
      </p>
    </LegalPage>
  );
}
