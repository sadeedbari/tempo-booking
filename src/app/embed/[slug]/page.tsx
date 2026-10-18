import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicOrg } from "@/lib/types";
import { BookingFlow } from "@/components/booking/booking-flow";
import { BookingPaused } from "@/components/booking/paused";
import { BookingPreview } from "@/app/preview/booking-preview";

// The booking flow for a pop-up on another website (see public/embed.js).
export const metadata: Metadata = { title: "Book", robots: { index: false } };

export default async function EmbeddedBookingPage(props: PageProps<"/embed/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  // Development only: sample data so the pop-up can be tried without a real business.
  if (process.env.NODE_ENV !== "production" && slug === "preview") {
    return <BookingPreview embed service={typeof sp.service === "string" ? sp.service : undefined} />;
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_org", { p_slug: slug });
  const orgData = data as PublicOrg | null;
  if (!orgData) notFound();
  const { data: open } = await supabase.rpc("org_accepts_bookings", { p_org: orgData.org.id });
  if (open === false) return <BookingPaused name={orgData.org.name} phone={orgData.org.phone} website={orgData.org.website} embed />;
  return (
    <BookingFlow
      data={orgData}
      embed
      initialService={typeof sp.service === "string" ? sp.service : undefined}
      paymentCancelled={sp.cancelled === "1"}
    />
  );
}
