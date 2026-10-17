import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PublicOrg } from "@/lib/types";
import { ReschedulePicker } from "./picker";

export const metadata: Metadata = { title: "Reschedule your booking", robots: { index: false } };

type Booking = {
  session_id: string | null; status: string; starts_at: string; service_id: string | null; member_id: string | null; location_id: string | null; service_name: string;
  org: { slug: string; cancellation_window_hours: number };
};

export default async function ReschedulePage(props: PageProps<"/booking/[token]/reschedule">) {
  const { token } = await props.params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_booking_by_token", { p_token: token });
  const b = data as Booking | null;
  if (!b) notFound();

  if (!canReschedule(b)) redirect(`/booking/${token}`);

  const { data: pub } = await supabase.rpc("get_public_org", { p_slug: b.org.slug });
  const orgData = pub as PublicOrg | null;
  const service = orgData?.services.find((s) => s.id === b.service_id);
  if (!orgData || !service) redirect(`/booking/${token}`);

  return <ReschedulePicker token={token} data={orgData} service={service} currentStart={b.starts_at} currentMemberId={b.member_id} locationId={b.location_id} />;
}

function canReschedule(b: Booking) {
  return !b.session_id && b.status === "confirmed" && new Date(b.starts_at).getTime() - Date.now() > b.org.cancellation_window_hours * 3600_000;
}
