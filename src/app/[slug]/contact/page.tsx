import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicContact } from "@/lib/types";
import { ContactForm } from "@/components/contact/contact-form";

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
  return <ContactForm data={data} initialService={typeof sp.service === "string" ? sp.service : undefined} />;
}
