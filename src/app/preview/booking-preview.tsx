"use client";
import { BookingFlow } from "@/components/booking/booking-flow";
import { publicData } from "./fixtures";
export function BookingPreview({ service, embed }: { service?: string; embed?: boolean }) {
  return <BookingFlow data={publicData} initialService={service} embed={embed} fetchWindow={async () => ({ busy: [], shifts: [] })} />;
}
