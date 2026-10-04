import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicOrg } from "@/lib/types";
import { BookingFlow } from "@/components/booking/booking-flow";

async function load(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_org", { p_slug: slug });
  return data as PublicOrg | null;
}

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await load(slug);
  if (!data) return { title: "Not found" };
  return {
    title: `Book with ${data.org.name}`,
    description: data.org.description ?? `Book an appointment with ${data.org.name}.`,
  };
}

export default async function PublicBookingPage(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const data = await load(slug);
  if (!data) notFound();
  return (
    <BookingFlow
      data={data}
      initialService={typeof sp.service === "string" ? sp.service : undefined}
      paymentCancelled={sp.cancelled === "1"}
    />
  );
}
