export type OrgRole = "owner" | "admin" | "member";
export type ServiceKind = "appointment" | "meeting";
export type LocationType = "in_person" | "video" | "phone";
export type BookingStatus = "pending_payment" | "confirmed" | "cancelled" | "completed" | "no_show";
export type PaymentStatus = "none" | "pending" | "paid" | "refunded";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  currency: string;
  accent_color: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  min_notice_minutes: number;
  max_advance_days: number;
  slot_interval_minutes: number;
  cancellation_window_hours: number;
  reminder_hours_before: number;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
}

export interface Location {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
  position: number;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  display_name: string;
  title: string | null;
  color: string;
  bookable: boolean;
  created_at: string;
}

export interface Service {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: ServiceKind;
  duration_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  deposit_cents: number;
  color: string;
  location_type: LocationType;
  location_detail: string | null;
  active: boolean;
  position: number;
}

export interface AvailabilityRule {
  id?: string;
  member_id: string;
  weekday: number;
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
}

export interface TimeOff {
  id: string;
  member_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface Customer {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  org_id: string;
  service_id: string | null;
  member_id: string;
  location_id: string | null;
  customer_id: string | null;
  starts_at: string;
  ends_at: string;
  blocked_until: string;
  status: BookingStatus;
  service_name: string;
  notes: string | null;
  price_cents: number;
  deposit_cents: number;
  currency: string;
  payment_status: PaymentStatus;
  source: "online" | "manual";
  created_at: string;
  cancel_reason: string | null;
  customer?: Pick<Customer, "id" | "name" | "email" | "phone"> | null;
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

/* Public booking page payload (get_public_org RPC) */
export interface PublicService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: ServiceKind;
  duration_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  deposit_cents: number;
  color: string;
  location_type: LocationType;
  staff_ids: string[];
}

export interface PublicStaff {
  id: string;
  display_name: string;
  title: string | null;
  color: string;
  avatar_url: string | null;
}

export interface PublicLocation {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  /** Staff who work here; empty = everyone. */
  staff_ids: string[];
}

export interface PublicOrg {
  org: Pick<
    Organization,
    | "id" | "name" | "slug" | "description" | "timezone" | "currency" | "accent_color" | "logo_url"
    | "address" | "phone" | "website" | "min_notice_minutes" | "max_advance_days"
    | "slot_interval_minutes" | "cancellation_window_hours"
  > & { payments_enabled: boolean };
  services: PublicService[];
  staff: PublicStaff[];
  locations: PublicLocation[];
  availability: AvailabilityRule[];
}

export interface BusyInterval {
  member_id: string;
  starts_at: string;
  ends_at: string;
}
