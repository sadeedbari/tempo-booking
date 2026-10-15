import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicContact } from "@/lib/types";
import { ContactForm } from "@/components/contact/contact-form";

// The contact form shown on another website (pop-up or inline; see public/embed.js).
export const metadata: Metadata = { title: "Contact", robots: { index: false } };

export default async function EmbeddedContactPage(props: PageProps<"/embed/[slug]/contact">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_contact", { p_slug: slug });
  const contact = data as PublicContact | null;
  if (!contact) notFound();
  return (
    <>
      {/* Let the host page show through the rounded corners. */}
      <style>{`html,body{background:transparent!important}`}</style>
      <ContactForm data={contact} embed initialService={typeof sp.service === "string" ? sp.service : undefined} />
    </>
  );
}
