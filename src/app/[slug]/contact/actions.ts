"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { notifyInquiry } from "@/lib/inquiries";
import { normalizePhone } from "@/lib/phone";
import type { PublicContact } from "@/lib/types";

export type InquiryResult = { ok: true } | { ok: false; error: string };

/**
 * The website contact form. The visitor's words go to the database function create_public_inquiry, which
 * checks them, creates or updates the customer and stores the message; the team is told afterwards.
 */
export async function sendInquiry(input: {
  slug: string;
  serviceId: string | null;
  name: string;
  email: string;
  phone: string;
  message: string;
  /** A field real people never see; bots fill it in. */
  website: string;
  /** How long the form was open, in milliseconds. A form filled in under two seconds is a bot. */
  openedMs: number;
}): Promise<InquiryResult> {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const slug = str(input.slug, 60);

  // Bots: pretend it worked, store nothing.
  if (str(input.website, 200).trim() !== "" || !(input.openedMs >= 2000)) return { ok: true };

  const supabase = await createClient();
  const { data: pub } = await supabase.rpc("get_public_contact", { p_slug: slug });
  const contact = pub as PublicContact | null;
  if (!contact) return { ok: false, error: "We couldn't find this business. Please reload the page and try again." };

  let phone = str(input.phone, 60).trim();
  if (phone) {
    const normalized = normalizePhone(phone, contact.org.currency);
    if (!normalized) return { ok: false, error: "That phone number doesn't look right. Include the area code, or leave it blank." };
    phone = normalized;
  }

  // A one-way fingerprint of the sender's network address, only used to slow down spam.
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const ipHash = ip ? createHash("sha256").update(`${ip}:${env.tokenEncryptionKey ?? "tempo"}`).digest("hex").slice(0, 32) : null;

  const serviceId = typeof input.serviceId === "string" && /^[0-9a-f-]{36}$/i.test(input.serviceId) ? input.serviceId : null;
  const { data, error } = await supabase.rpc("create_public_inquiry", {
    p_org: contact.org.id,
    p_service: serviceId,
    p_name: str(input.name, 200),
    p_email: str(input.email, 300),
    p_phone: phone,
    p_message: str(input.message, 3000),
    p_ip_hash: ipHash,
  });
  if (error) {
    // The function words its own rules for people ("please enter a valid email"); anything else is a fault.
    if (error.code === "P0001") return { ok: false, error: error.message };
    console.error("[inquiry] unexpected database error:", error.code, error.message);
    return { ok: false, error: "Something went wrong while sending your message. Please try again in a moment." };
  }

  const row = data as { id: string; duplicate: boolean };
  if (!row.duplicate && env.supabaseServiceKey) after(() => notifyInquiry(row.id));
  return { ok: true };
}
