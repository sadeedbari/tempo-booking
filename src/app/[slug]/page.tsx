import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicOrg } from "@/lib/types";
import { BookingFlow } from "@/components/booking/booking-flow";
import { BookingPaused } from "@/components/booking/paused";

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
  // No active plan (trial over, cancelled, unpaid): a neutral notice instead of the booking flow. The database also
  // refuses any booking, so this is only the friendly face of it.
  const supabase = await createClient();
  const { data: open } = await supabase.rpc("org_accepts_bookings", { p_org: data.org.id });
  if (open === false) return <BookingPaused name={data.org.name} phone={data.org.phone} website={data.org.website} />;
  return (
    <BookingFlow
      data={data}
      initialService={typeof sp.service === "string" ? sp.service : undefined}
      paymentCancelled={sp.cancelled === "1"}
    />
  );
}
