import { TZDate } from "@date-fns/tz";
import { admin, anonClient, readState, signedIn } from "../lib.mjs";

export const st = readState();
export const TZ = "America/Toronto";

/** ISO instant for a local time on a local date in the business time zone. */
export function at(dateKey, hhmm, tz = TZ) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new TZDate(y, m - 1, d, h, mi, 0, tz).toISOString();
}

const days = new Map();
const used = new Set();
/** A Mon-Fri date key. The same key always gives the same day; different keys give different days, so tests never share a day. */
export function weekday(key = 8) {
  if (!days.has(key)) {
    const d = new Date(Date.now() + (8 + days.size) * 86400_000);
    for (;;) {
      const k = d.toISOString().slice(0, 10);
      if (![0, 6].includes(d.getUTCDay()) && !used.has(k)) { used.add(k); days.set(key, k); break; }
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return days.get(key);
}
export const saturday = (daysAhead = 8) => {
  const d = new Date(Date.now() + daysAhead * 86400_000);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export const pub = anonClient();
let n = 0;
export const unique = (p = "c") => `${p}${Date.now().toString(36)}${++n}`;

/** Books through the same public function the booking page uses. */
export function book(o = {}) {
  return pub.rpc("create_public_booking", {
    p_org: st.orgA.id,
    p_service: st.orgA.services.haircut,
    p_member: st.orgA.members.sara,
    p_starts_at: o.at,
    p_name: o.name ?? "Test Customer",
    p_email: o.email ?? `${unique()}@customers.tempo-e2e.test`,
    p_phone: o.phone ?? "",
    p_notes: o.notes ?? "",
    p_location: o.location ?? st.orgA.locations.qw,
    p_address: o.address ?? "",
    ...(o.params ?? {}),
  });
}

/** The technical words that must never reach a customer. */
export const TECHNICAL = /violates|constraint|duplicate key|null value|syntax error|relation "|function public|permission denied|row-level security|pg_|schema|uuid/i;

export { admin, signedIn };

export const MOCK = "http://127.0.0.1:4010";
export const APP = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const mock = {
  async sent() { return await (await fetch(`${MOCK}/__sent`)).json(); },
  async clear() { await fetch(`${MOCK}/__sent`, { method: "DELETE" }); },
  async mode(m) { await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify(m) }); },
};
