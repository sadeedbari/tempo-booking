import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, features } from "@/lib/env";
import { startOfDayInZone } from "@/lib/format";
import { decrypt, encrypt } from "./crypto";
import { getProvider } from "./providers";
import type { EventInput } from "./provider";

interface Connection {
  id: string;
  org_id: string;
  member_id: string;
  provider: string;
  calendar_id: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  status: string;
}

const db = () => createAdminClient();

/** A valid access token, refreshed (and persisted) when close to expiry. Null if the grant was revoked. */
async function accessToken(c: Connection): Promise<string | null> {
  if (c.access_token_enc && c.access_expires_at && new Date(c.access_expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(c.access_token_enc);
  }
  const provider = getProvider(c.provider);
  if (!provider) return null;
  try {
    const t = await provider.refresh(decrypt(c.refresh_token_enc));
    const patch: Record<string, string> = {
      access_token_enc: encrypt(t.accessToken),
      access_expires_at: new Date(Date.now() + t.expiresIn * 1000).toISOString(),
    };
    if (t.refreshToken) patch.refresh_token_enc = encrypt(t.refreshToken); // Microsoft rotates it
    await db().from("calendar_connections").update(patch).eq("id", c.id);
    return t.accessToken;
  } catch (e) {
    if ((e as { code?: string }).code === "invalid_grant") {
      await db().from("calendar_connections").update({ status: "needs_reauth" }).eq("id", c.id);
    } else {
      console.error(`[calendar:${c.provider}] token refresh failed`, (e as Error).message);
    }
    return null;
  }
}

async function activeConnections(filter: { orgId?: string; memberId?: string }) {
  let q = db().from("calendar_connections").select("*").eq("status", "active");
  if (filter.orgId) q = q.eq("org_id", filter.orgId);
  if (filter.memberId) q = q.eq("member_id", filter.memberId);
  const { data } = await q;
  return (data ?? []) as Connection[];
}

/* ───────────── Pull: personal-calendar events → external_busy ───────────── */

const recent = new Map<string, number>();

/**
 * Refreshes the mirror of connected calendars for [from, to]. Never throws:
 * an unreachable calendar must not stop customers from booking.
 */
export async function refreshExternalBusy(orgId: string, from: string, to: string, opts: { memberId?: string } = {}) {
  if (!features.calendar || !env.supabaseServiceKey) return;
  try {
    const conns = await activeConnections({ orgId, memberId: opts.memberId });
    if (!conns.length) return;
    const { data: org } = await db().from("organizations").select("timezone").eq("id", orgId).single();
    const tz = org?.timezone ?? "UTC";

    await Promise.all(
      conns.map(async (c) => {
        const provider = getProvider(c.provider);
        if (!provider) return;
        const throttleKey = `${c.id}|${from}|${to}`;
        if ((recent.get(throttleKey) ?? 0) > Date.now() - 30_000) return;
        recent.set(throttleKey, Date.now());
        if (recent.size > 500) recent.clear();
        try {
          const token = await accessToken(c);
          if (!token) return;
          const [events, { data: own }] = await Promise.all([
            provider.listBusy(token, c.calendar_id, from, to),
            db().from("booking_calendar_events").select("event_id").eq("connection_id", c.id),
          ]);
          const ownIds = new Set((own ?? []).map((r) => r.event_id as string));
          const rows = events.flatMap((ev) => {
            if (ev.ownedByTempo || ownIds.has(ev.id)) return []; // Tempo's own events must not block slots
            // All-day events block whole days in the business time zone.
            const start = ev.allDay ? startOfDayInZone(ev.start, tz).toISOString() : ev.start;
            const end = ev.allDay ? startOfDayInZone(ev.end, tz).toISOString() : ev.end;
            return end > start ? [{ connection_id: c.id, org_id: c.org_id, member_id: c.member_id, event_id: ev.id, starts_at: start, ends_at: end }] : [];
          });
          // Replace everything overlapping the window with what the provider reports now.
          await db().from("external_busy").delete().eq("connection_id", c.id).lt("starts_at", to).gt("ends_at", from);
          if (rows.length) await db().from("external_busy").upsert(rows, { onConflict: "connection_id,event_id" });
          await db().from("calendar_connections").update({ busy_synced_at: new Date().toISOString() }).eq("id", c.id);
        } catch (e) {
          console.error(`[calendar:${c.provider}] busy sync failed`, (e as Error).message);
        }
      }),
    );
  } catch (e) {
    console.error("[calendar] busy sync failed", (e as Error).message);
  }
}

/* ───────────── Push: Tempo bookings → personal calendars ───────────── */

interface BookingRow {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  service_name: string;
  notes: string | null;
  member_id: string;
  customer: { name: string; email: string; phone: string | null } | null;
  location: { name: string; address: string | null } | null;
  service: { location_type: string; location_detail: string | null } | null;
  org: { slug: string; name: string; timezone: string; address: string | null };
}

/**
 * Makes the staff member's calendars match the booking: confirmed → an event
 * exists at the right time on each connected calendar; cancelled (or
 * reassigned to someone else) → events removed. Idempotent; never throws.
 */
export async function syncBookingCalendar(bookingId: string) {
  if (!features.calendar || !env.supabaseServiceKey) return;
  try {
    const { data } = await db()
      .from("bookings")
      .select(
        "id, status, starts_at, ends_at, service_name, notes, member_id, customer:customers(name, email, phone), location:locations(name, address), service:services(location_type, location_detail), org:organizations(slug, name, timezone, address)",
      )
      .eq("id", bookingId)
      .single();
    const b = data as unknown as BookingRow | null;
    if (!b) return;

    const wantEvent = b.status === "confirmed" || b.status === "completed" || b.status === "no_show";
    const current = wantEvent ? await activeConnections({ memberId: b.member_id }) : [];
    const currentIds = new Set(current.map((c) => c.id));

    const { data: existing } = await db().from("booking_calendar_events").select("connection_id, event_id").eq("booking_id", b.id);
    const eventByConn = new Map((existing ?? []).map((r) => [r.connection_id as string, r.event_id as string]));

    // Remove events that are stale: booking cancelled, or now belongs to another person's calendar.
    for (const [connId, eventId] of eventByConn) {
      if (currentIds.has(connId)) continue;
      const { data: old } = await db().from("calendar_connections").select("*").eq("id", connId).maybeSingle();
      const oldConn = old as Connection | null;
      const provider = oldConn && oldConn.status === "active" ? getProvider(oldConn.provider) : null;
      const tok = oldConn && provider ? await accessToken(oldConn) : null;
      if (oldConn && provider && tok) await provider.deleteEvent(tok, oldConn.calendar_id, eventId).catch((e) => console.error(`[calendar:${oldConn.provider}] delete failed`, e.message));
      await db().from("booking_calendar_events").delete().eq("booking_id", b.id).eq("connection_id", connId);
    }
    if (!wantEvent) return;

    const where = b.location
      ? [b.location.name, b.location.address].filter(Boolean).join(", ")
      : b.service?.location_type === "video"
        ? b.service.location_detail || "Video call"
        : b.service?.location_type === "phone"
          ? "Phone call"
          : b.org.address || undefined;
    const event: EventInput = {
      summary: `${b.service_name}${b.customer ? ` — ${b.customer.name}` : ""}`,
      description: [
        b.customer ? `${b.customer.name}\n${b.customer.email}${b.customer.phone ? `\n${b.customer.phone}` : ""}` : "",
        b.notes ? `Notes: ${b.notes}` : "",
        `Booked through Tempo: ${env.appUrl}/o/${b.org.slug}/calendar`,
      ].filter(Boolean).join("\n\n"),
      location: where,
      start: new Date(b.starts_at).toISOString(),
      end: new Date(b.ends_at).toISOString(),
      timeZone: b.org.timezone,
      bookingId: b.id,
    };

    for (const c of current) {
      try {
        const provider = getProvider(c.provider);
        const token = provider ? await accessToken(c) : null;
        if (!provider || !token) continue;
        let eventId: string | null = eventByConn.get(c.id) ?? null;
        if (eventId) eventId = await provider.patchEvent(token, c.calendar_id, eventId, event); // null → deleted on their side
        if (!eventId) eventId = await provider.insertEvent(token, c.calendar_id, event);
        if (eventId) await db().from("booking_calendar_events").upsert({ booking_id: b.id, connection_id: c.id, event_id: eventId }, { onConflict: "booking_id,connection_id" });
      } catch (e) {
        console.error(`[calendar:${c.provider}] booking sync failed`, (e as Error).message);
      }
    }
  } catch (e) {
    console.error("[calendar] booking sync failed", (e as Error).message);
  }
}
