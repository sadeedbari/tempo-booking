import { addDaysToKey, weekdayOfKey } from "@/lib/format";
import type { DBooking } from "@/lib/dashboard";
import { TZDate } from "@date-fns/tz";
import type { Booking, Membership, Organization, Service, AvailabilityRule, Customer, PublicOrg } from "@/lib/types";
export const tz = "America/Toronto";
export const org: Organization = { id: "o1", name: "Lumen Studio", slug: "lumen", description: "Hair, skin and wellness in the heart of Toronto. Book with any of our specialists.", timezone: tz, currency: "CAD", accent_color: "#007AFF", logo_url: null, address: "214 Queen St W, Toronto", phone: "416-555-0199", website: null, min_notice_minutes: 60, max_advance_days: 60, slot_interval_minutes: 15, cancellation_window_hours: 24, reminder_hours_before: 24, schedule_mode: "availability", notify_push: true, inquiries_enabled: true, inquiry_notify_email: null, inquiry_success_message: null, stripe_account_id: null, stripe_charges_enabled: true };
const m = (id: string, name: string, color: string, role: Membership["role"], title: string): Membership => ({ id, org_id: "o1", user_id: id, email: null, role, display_name: name, title, color, bookable: true, created_at: "" });
export const members = [m("m1", "Maya Chen", "#007AFF", "owner", "Senior Stylist"), m("m2", "Jordan Lee", "#34C759", "admin", "Massage Therapist"), m("m3", "Aisha Khan", "#AF52DE", "member", "Esthetician")];
const s = (id: string, name: string, dur: number, price: number, color: string, desc: string, dep = 0, loc: Service["location_type"] = "in_person"): Service => ({ id, org_id: "o1", name, slug: id, description: desc, kind: "appointment", duration_minutes: dur, buffer_after_minutes: 10, price_cents: price, deposit_cents: dep, color, location_type: loc, location_detail: null, address_mode: id === "colour" ? "required" : "off", auto_approve: id !== "colour", active: true, contact_form: true, position: 0 });
export const services = [s("haircut", "Haircut & style", 60, 8500, "#007AFF", "Consultation, wash, precision cut and blow-dry."), s("colour", "Colour & gloss", 120, 18000, "#FF9500", "Full colour with a glossing treatment.", 5000), s("massage", "Deep tissue massage", 90, 14000, "#34C759", "Targeted pressure for tension relief."), s("facial", "Signature facial", 60, 11000, "#AF52DE", "Cleanse, exfoliate, mask and massage."), s("consult", "Virtual consultation", 20, 0, "#30B0C7", "A quick video call to plan your visit.", 0, "video")];
export const rules: AvailabilityRule[] = members.flatMap((mm) => [1, 2, 3, 4, 5].map((d) => ({ member_id: mm.id, weekday: d, start_time: "09:00", end_time: "18:00" })));
export function at(day: string, hh: number, mm = 0) { const [y, mo, d] = day.split("-").map(Number); return new Date(new TZDate(y, mo - 1, d, hh, mm, 0, tz).getTime()).toISOString(); }
export const customers: Customer[] = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Tim Berners-Lee", "Hedy Lamarr"].map((n, i) => ({ id: `c${i}`, org_id: "o1", name: n, email: n.toLowerCase().replace(/ /g, ".") + "@example.com", phone: null, notes: null, sms_consent_at: null, created_at: "" }));
export function bookings(day: string): Booking[] {
  const b = (id: string, mid: string, svc: Service, h: number, mi: number, ci: number, status: Booking["status"] = "confirmed"): Booking => ({ id, org_id: "o1", service_id: svc.id, member_id: mid, location_id: null, customer_address: null, customer_address_place_id: null, customer_address_lat: null, customer_address_lng: null, customer_id: `c${ci}`, starts_at: at(day, h, mi), ends_at: new Date(new Date(at(day, h, mi)).getTime() + svc.duration_minutes * 60000).toISOString(), blocked_until: "", status, service_name: svc.name, notes: null, price_cents: svc.price_cents, deposit_cents: svc.deposit_cents, currency: "CAD", payment_status: "none", source: "online", created_at: "", cancel_reason: null, customer: customers[ci] });
  return [b("b1", "m1", services[0], 9, 0, 0), b("b2", "m1", services[1], 11, 30, 1), b("b3", "m1", services[0], 15, 0, 2), b("b4", "m2", services[2], 9, 30, 3), b("b5", "m2", services[2], 13, 0, 4), b("b6", "m3", services[3], 10, 0, 5), b("b7", "m3", services[4], 12, 0, 0, "pending_payment"), b("b8", "m3", services[3], 14, 30, 2)];
}
export const publicData: PublicOrg = { org: { ...org, payments_enabled: true }, services: services.map((x) => ({ ...x, staff_ids: [] })), locations: [{ id: "l1", name: "Queen West", address: "214 Queen St W, Toronto", phone: null, staff_ids: [] }, { id: "l2", name: "Leslieville", address: "1120 Queen St E, Toronto", phone: null, staff_ids: [] }], staff: members.map((x) => ({ id: x.id, display_name: x.display_name, title: x.title, color: x.color, avatar_url: null })), availability: rules };

/** ~70 days of history plus the coming week for the dashboard preview, generated deterministically. */
export function dashboardSample(day: string) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const custs = customers.map((c, i) => ({ id: c.id, name: c.name, created_at: at(addDaysToKey(day, -(75 - i * 12)), 9) }));
  const list: DBooking[] = [];
  for (let off = -70; off <= 6; off++) {
    const d = addDaysToKey(day, off);
    if (weekdayOfKey(d) === 0) continue;
    const n = 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const hour = 9 + Math.floor(rnd() * 8);
      const svc = services[Math.floor(rnd() * 4)];
      const mem = members[Math.floor(rnd() * members.length)];
      const cust = custs[Math.floor(rnd() * custs.length)];
      const r = rnd();
      const status: DBooking["status"] = off < 0 ? (r < 0.84 ? "completed" : r < 0.92 ? "no_show" : "cancelled") : r < 0.88 ? "confirmed" : "pending_approval";
      const startsAt = at(d, hour, rnd() < 0.5 ? 0 : 30);
      list.push({
        id: `d${off}-${k}`, starts_at: startsAt, ends_at: new Date(new Date(startsAt).getTime() + svc.duration_minutes * 60000).toISOString(),
        status, price_cents: svc.price_cents, deposit_cents: 0, payment_status: "none", service_id: svc.id, service_name: svc.name,
        member_id: mem.id, customer_id: cust.id, customer_name: cust.name, source: rnd() < 0.7 ? "online" : "manual",
      });
    }
  }
  return { list, custs };
}
