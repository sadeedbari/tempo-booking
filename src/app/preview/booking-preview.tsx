"use client";
import { BookingFlow } from "@/components/booking/booking-flow";
import { publicData } from "./fixtures";
export function BookingPreview({ service }: { service?: string }) {
  return <BookingFlow data={publicData} initialService={service} fetchBusy={async () => []} />;
}
