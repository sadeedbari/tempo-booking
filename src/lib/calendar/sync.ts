import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, features } from "@/lib/env";
import { startOfDayInZone } from "@/lib/format";
import { decrypt, encrypt } from "./crypto";
import { deleteEvent, insertEvent, listEvents, patchEvent, refreshAccess, type EventInput, type GoogleEvent } from "./google";

interface Connection {
  id: string;
  org_id: string;
  member_id: string;
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
  try {
    const t = await refreshAccess(decrypt(c.refresh_token_enc));
    await db()
      .from("calendar_connections")
      .update({ access_token_enc: encrypt(t.access_token), access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() })
      .eq("id", c.id);
    return t.access_token;
  } catch (e) {
    if ((e as { code?: string }).code === "invalid_grant") {
      await db().from("calendar_connections").update({ status: "needs_reauth" }).eq("id", c.id);
    } else {
      console.error("[calendar] token refresh failed", (e as Error).message);
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

function eventRange(ev: GoogleEvent, tz: string): [string, string] | null {
  if (ev.status === "cancelled" || ev.transparency === "transparent") return null;
  if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  if (ev.extendedProperties?.private?.tempoBookingId) return null; // our own booking events
  if (ev.start?.dateTime && ev.end?.dateTime) {
    return [new Date(ev.start.dateTime).toISOString(), new Date(ev.end.dateTime).toISOString()];
  }
  if (ev.start?.date && ev.end?.date) {
    // All-day events block whole days in the business time zone.
    return [startOfDayInZone(ev.start.date, tz).toISOString(), startOfDayInZone(ev.end.date, tz).toISOString()];
  }
  return null;
}

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
        const throttleKey = `${c.id}|${from}|${to}`;
        if ((recent.get(throttleKey) ?? 0) > Date.now() - 30_000) return;
        recent.set(throttleKey, Date.now());
        if (recent.size > 500) recent.clear();
        try {
          const token = await accessToken(c);
          if (!token) return;
          const events = await listEvents(token, c.calendar_id, from, to);
          const rows = events.flatMap((ev) => {
            const r = eventRange(ev, tz);
            return r && r[1] > r[0]
              ? [{ connection_id: c.id, org_id: c.org_id, member_id: c.member_id, event_id: ev.id, starts_at: r[0], ends_at: r[1] }]
              : [];
          });
          // Replace everything overlapping the window with what Google reports now.
          await db().from("external_busy").delete().eq("connection_id", c.id).lt("starts_at", to).gt("ends_at", from);
          if (rows.length) await db().from("external_busy").upsert(rows, { onConflict: "connection_id,event_id" });
          await db().from("calendar_connections").update({ busy_synced_at: new Date().toISOString() }).eq("id", c.id);
        } catch (e) {
          console.error("[calendar] busy sync failed", (e as Error).message);
        }
      }),
    );
  } catch (e) {
    console.error("[calendar] busy sync failed", (e as Error).message);
  }
}

/* ───────────── Push: Tempo bookings → personal calendar ───────────── */

interface BookingRow {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  service_name: string;
  notes: string | null;
  member_id: string;
  calendar_connection_id: string | null;
  calendar_event_id: string | null;
  customer: { name: string; email: string; phone: string | null } | null;
  location: { name: string; address: string | null } | null;
  service: { location_type: string; location_detail: string | null } | null;
  org: { slug: string; name: string; timezone: string; address: string | null };
}

/**
 * Makes the staff member's calendar match the booking: confirmed → event
 * exists at the right time; cancelled (or reassigned) → event removed.
 * Idempotent; never throws.
 */
export async function syncBookingCalendar(bookingId: string) {
  if (!features.calendar || !env.supabaseServiceKey) return;
  try {
    const { data } = await db()
      .from("bookings")
      .select(
        "id, status, starts_at, ends_at, service_name, notes, member_id, calendar_connection_id, calendar_event_id, customer:customers(name, email, phone), location:locations(name, address), service:services(location_type, location_detail), org:organizations(slug, name, timezone, address)",
      )
      .eq("id", bookingId)
      .single();
    const b = data as unknown as BookingRow | null;
    if (!b) return;

    const current = (await activeConnections({ memberId: b.member_id }))[0] ?? null;
    const wantEvent = b.status === "confirmed" || b.status === "completed" || b.status === "no_show";

    // Remove the old event if it's now stale (cancelled, or moved to another person/calendar).
    if (b.calendar_event_id && b.calendar_connection_id && (!wantEvent || b.calendar_connection_id !== current?.id)) {
      const { data: old } = await db().from("calendar_connections").select("*").eq("id", b.calendar_connection_id).maybeSingle();
      const oldConn = old as Connection | null;
      const tok = oldConn && oldConn.status === "active" ? await accessToken(oldConn) : null;
      if (oldConn && tok) await deleteEvent(tok, oldConn.calendar_id, b.calendar_event_id).catch((e) => console.error("[calendar] delete failed", e.message));
      await db().from("bookings").update({ calendar_connection_id: null, calendar_event_id: null }).eq("id", b.id);
      b.calendar_event_id = null;
      b.calendar_connection_id = null;
    }
    if (!wantEvent || !current) return;

    const token = await accessToken(current);
    if (!token) return;
    const tz = b.org.timezone;
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
      start: { dateTime: new Date(b.starts_at).toISOString(), timeZone: tz },
      end: { dateTime: new Date(b.ends_at).toISOString(), timeZone: tz },
      extendedProperties: { private: { tempoBookingId: b.id } },
    };

    let eventId = b.calendar_event_id;
    if (eventId) {
      const patched = await patchEvent(token, current.calendar_id, eventId, event);
      if (!patched) eventId = null; // deleted by the user on their side — recreate
    }
    if (!eventId) eventId = (await insertEvent(token, current.calendar_id, event))?.id ?? null;
    if (eventId) await db().from("bookings").update({ calendar_connection_id: current.id, calendar_event_id: eventId }).eq("id", b.id);
  } catch (e) {
    console.error("[calendar] booking sync failed", (e as Error).message);
  }
}
