import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicContact } from "@/lib/types";
import { ContactForm } from "@/components/contact/contact-form";
import { BookingPaused } from "@/components/booking/paused";

async function load(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_contact", { p_slug: slug });
  return data as PublicContact | null;
}

export async function generateMetadata(props: PageProps<"/[slug]/contact">): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await load(slug);
  return data ? { title: `Contact ${data.org.name}`, description: `Send ${data.org.name} a message.` } : { title: "Not found" };
}

export default async function ContactPage(props: PageProps<"/[slug]/contact">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const data = await load(slug);
  if (!data) notFound();
  // A business with no active plan doesn't take messages either.
  const { data: open } = await (await createClient()).rpc("org_accepts_bookings", { p_org: data.org.id });
  if (open === false) return <BookingPaused name={data.org.name} phone={data.org.phone} />;
  return <ContactForm data={data} initialService={typeof sp.service === "string" ? sp.service : undefined} />;
}
