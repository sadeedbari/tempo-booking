import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicContact } from "@/lib/types";
import { ContactForm } from "@/components/contact/contact-form";
import { BookingPaused } from "@/components/booking/paused";

// The contact form shown on another website (pop-up or inline; see public/embed.js).
export const metadata: Metadata = { title: "Contact", robots: { index: false } };

export default async function EmbeddedContactPage(props: PageProps<"/embed/[slug]/contact">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_contact", { p_slug: slug });
  const contact = data as PublicContact | null;
  if (!contact) notFound();
  const { data: open } = await supabase.rpc("org_accepts_bookings", { p_org: contact.org.id });
  if (open === false) return <BookingPaused name={contact.org.name} phone={contact.org.phone} embed />;
  return (
    <>
      {/* Let the host page show through the rounded corners. */}
      <style>{`html,body{background:transparent!important}`}</style>
      <ContactForm data={contact} embed initialService={typeof sp.service === "string" ? sp.service : undefined} />
    </>
  );
}
