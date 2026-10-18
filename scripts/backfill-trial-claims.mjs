// One-time step after applying the subscription-billing migration: records (as keyed hashes only) that the owners of the
// businesses that already existed have used their one free trial. Safe to run again: existing records are kept.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TRIAL_CLAIM_SECRET=... node scripts/backfill-trial-claims.mjs
//
// Everything is read from the environment and nothing is written to disk. TRIAL_CLAIM_SECRET must be the SAME value the app
// uses (changing it later would make every existing record useless). Run it BEFORE opening the app to new sign-ups.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.TRIAL_CLAIM_SECRET;
if (!url || !service || !secret) { console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TRIAL_CLAIM_SECRET in the environment first."); process.exit(2); }
if (secret.length < 16) { console.error("TRIAL_CLAIM_SECRET is too short (use at least 16 characters, e.g. `openssl rand -base64 32`)."); process.exit(2); }

const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/backfill_trial_claims`, {
  method: "POST",
  headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_secret: secret }),
});
const body = await res.text();
if (!res.ok) { console.error(`Failed (${res.status}): ${body.slice(0, 300)}`); process.exit(1); }
console.log(`Done. ${body} new trial record(s) written (hashes only).`);
