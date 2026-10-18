// Round-2 adversarial checks for the billing migration (QA). Same harness idea as billing-migration.test.mjs:
//   PGLITE_DIR=<folder where `npm i @electric-sql/pglite` was run> node tests/sql/billing-retest.test.mjs
// Part A applies the billing migration to a database that ALREADY holds legacy teams (backfill of trial_claims).
// Part B covers trial farming, the 3-team cap, every read-only table and the two definer RPCs on a plan and off it.
// In-memory only; nothing remote is touched.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PGDIR = process.env.PGLITE_DIR;
if (!PGDIR) { console.error('Set PGLITE_DIR'); process.exit(2); }
const req = createRequire(path.join(PGDIR, 'x.js'));
const imp = (s) => import(pathToFileURL(req.resolve(s)).href);
const { PGlite } = await imp('@electric-sql/pglite');
const { btree_gist } = await imp('@electric-sql/pglite/contrib/btree_gist');
const { pgcrypto } = await imp('@electric-sql/pglite/contrib/pgcrypto');
const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const BILLING = '20261101000000_subscription_billing.sql';

async function boot(applyBilling) {
  const db = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await db.exec(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema extensions; create extension pgcrypto with schema extensions; create extension btree_gist with schema extensions;
 create schema auth;
 create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
 set search_path = public, extensions;
 grant usage on schema auth, extensions to anon, authenticated, service_role;
 grant select on auth.users to authenticated, service_role;
 alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
 alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
 alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
 grant usage on schema public to anon, authenticated, service_role;`);
  for (const f of files.filter((f) => (applyBilling ? f <= BILLING : f < BILLING))) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  const as = async (role, uid, sql, p) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid || ''}',false), set_config('request.jwt.claim.role','${role}',false)`);
    try { return await db.query(sql, p); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)`); }
  };
  return { db, q: (s, p) => db.query(s, p), as, asUser: (id, s, p) => as('authenticated', id, s, p), anon: (s, p) => as('anon', '', s, p), asService: (s, p) => as('service_role', '', s, p) };
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(c ? '  PASS' : '  FAIL', m); };
const throws = async (p, rx, m) => { try { await p; fail++; console.log('  FAIL (no error)', m); } catch (e) { const g = !rx || rx.test(e.message); if (g) pass++; else fail++; console.log(g ? '  PASS' : '  FAIL', m, '->', e.message.slice(0, 110)); } };
const allowed = async (p, m) => { try { await p; pass++; console.log('  PASS', m); } catch (e) { fail++; console.log('  FAIL', m, '->', e.message.slice(0, 140)); } };
// S-012: teams are created by the server (service role) with the secret key for the trial hashes: create_organization_as.
const SECRET = 'test-trial-secret-0123456789';
const claimsOf = async (q, kind, val) => (await q(`select count(*)::int c from public.trial_claims where claim_hash = private.claim_hash($1,$2,$3)`, [kind, val, SECRET])).rows[0].c;
const G = (n) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

/* ───────────── Part A: backfill against pre-existing teams ───────────── */
console.log('A. backfill of trial_claims from legacy teams');
{
  const { db, q, asUser, asService: svc } = await boot(false);
  const users = [
    [1, 'Ann.Lee@gmail.com', true], [2, 'annlee+shop@googlemail.com', true], [3, 'Bob@Corp.com', true], [4, null, true],
    [5, 'carol@x.test', true], [6, 'dave@x.test', true], [7, 'old@x.test', false], [8, 'erin@x.test', true],
  ];
  for (const [i, e, c] of users) await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,${c ? 'now()' : 'null'})`, [G(i), e]);
  // before the migration the old browser-callable function is what created teams
  const mkOld = async (n, slug) => (await asUser(G(n), `select public.create_organization('T',$1,'America/Toronto','O') as id`, [slug])).rows[0].id;
  const mk = async (n, slug) => (await svc(`select public.create_organization_as($1,$2,'T',$3,'America/Toronto','O') as id`, [G(n), SECRET, slug])).rows[0].id;
  await mkOld(1, 'l1a'); await mkOld(1, 'l1b'); await mkOld(2, 'l2a');
  await mkOld(3, 'l3a'); await mkOld(3, 'l3b'); await mkOld(3, 'l3c');
  await mkOld(7, 'l7a');
  const l3a = (await q(`select id from public.organizations where slug='l3a'`)).rows[0].id;
  await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'admin','Carol')`, [l3a, G(5)]);
  // an owner row with no login (legacy imports) must not break the backfill
  const l1a = (await q(`select id from public.organizations where slug='l1a'`)).rows[0].id;
  await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,null,'owner','Ghost owner')`, [l1a]).catch(() => {});
  // Without the operator's key the migration cannot backfill: it says so, and the script / RPC does it afterwards (S-012).
  await db.exec(fs.readFileSync(path.join(MIG, BILLING), 'utf8'));
  ok((await q(`select count(*)::int c from public.trial_claims`)).rows[0].c === 0, 'no key supplied: the migration backfills nothing (and never hashes with an empty key)');
  await throws(svc(`select public.backfill_trial_claims('')`), /not available/, 'backfill with an empty key fails closed');
  ok((await svc(`select public.backfill_trial_claims($1) n`, [SECRET])).rows[0].n === 3 + 4, 'backfill through the service-role function writes 3 email hashes + 4 owner hashes');
  ok((await q(`select count(*)::int c from public.trial_claims`)).rows[0].c === 7, 'backfill: one email record per normalised owner (dots/+tag/googlemail merged, null email skipped, admin-only not claimed) and one user record per owner');
  for (const e of ['annlee@gmail.com', 'bob@corp.com', 'old@x.test']) ok(await claimsOf(q, 'email', e) === 1, `backfill: ${e} recorded as a hash`);
  for (const n of [1, 2, 3, 7]) ok(await claimsOf(q, 'user', G(n)) === 1, `backfill: owner ${n} recorded as a hashed user id`);
  ok(await claimsOf(q, 'user', G(5)) === 0, 'backfill: an admin who never owned anything is not recorded');
  ok(!/@|1000000/.test(JSON.stringify((await q(`select * from public.trial_claims`)).rows)), 'the table holds no readable email or id');
  ok((await q(`select count(*)::int c from public.subscriptions where status='trial'`)).rows[0].c === 7, 'every legacy team got a trial row');
  const nt = async (n, slug) => (await q(`select status from public.subscriptions where org_id=$1`, [await mk(n, slug)])).rows[0].status;
  ok(await nt(1, 'new1') === 'expired', 'legacy owner (dotted gmail): new team has no trial');
  ok((await q(`select count(*)::int c from public.memberships where user_id=$1 and role='owner'`, [G(1)])).rows[0].c === 3, 'legacy owner now owns 3 teams');
  await throws(mk(1, 'new1b'), /own up to 3 teams/, 'legacy owner at 3: the 4th is refused');
  ok(await nt(2, 'new2') === 'expired', 'googlemail +tag spelling of the same person: no trial');
  await throws(mk(3, 'new3'), /own up to 3 teams/, 'legacy owner with 3 existing teams cannot create a 4th');
  ok(await nt(5, 'new5') === 'trial', 'a legacy ADMIN (never an owner) still earns a first trial');
  ok(await nt(6, 'new6') === 'trial', 'brand-new person: trial');
  ok(await nt(7, 'new7') === 'expired', 'unconfirmed legacy owner: no trial');
  ok(await nt(8, 'new8') === 'trial', 'another new person: trial');
  // no signed-in id: the server / service role / SQL editor
  const before = (await q(`select count(*)::int c from public.trial_claims`)).rows[0].c;
  const org = (await q(`insert into public.organizations(name,slug) values('Imported','imported') returning id`)).rows[0].id;
  ok((await q(`select status from public.subscriptions where org_id=$1`, [org])).rows[0].status === 'trial', 'insert without a signed-in user: gets a trial');
  ok((await q(`select count(*)::int c from public.trial_claims`)).rows[0].c === before, 'insert without a signed-in user: claims nothing');
}

/* ───────────── Part B ───────────── */
const { db, q, asUser, anon, asService } = await boot(true);
const U = (n) => G(n);
const addUser = (n, email, confirmed = true) => db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,${confirmed ? 'now()' : 'null'})`, [U(n), email]);
const mk = async (n, slug) => (await asService(`select public.create_organization_as($1,$2,'T',$3,'America/Toronto','O') as id`, [U(n), SECRET, slug])).rows[0].id;
const status = async (id) => (await q(`select status, trial_ended_email_sent_at is not null as noemail from public.subscriptions where org_id=$1`, [id])).rows[0];

console.log('B1. trial farming, adversarial');
await addUser(1, 'Farm@Example.com');
const f1 = await mk(1, 'farm-1');
ok((await status(f1)).status === 'trial', 'first team of a verified person: trial');
const variants = [[2, 'FARM@EXAMPLE.COM', 'upper case'], [3, 'farm+promo@example.com', '+tag'], [4, 'farm+a+b@Example.com', 'two +tags'], [5, ' farm@example.com ', 'padded with spaces']];
for (const [n, e, label] of variants) { await addUser(n, e); ok((await status(await mk(n, 'v-' + n))).status === 'expired', `variant "${e}" (${label}): no second trial`); }
await addUser(6, 'f.arm@example.com');
ok((await status(await mk(6, 'v-6'))).status === 'trial', 'dots on a NON-gmail domain are a different mailbox: trial (documented behaviour)');
await addUser(7, 'Jo.Hn+x@Gmail.com'); await addUser(8, 'john@googlemail.com'); await addUser(9, 'j.o.h.n+zzz@GMAIL.COM');
ok((await status(await mk(7, 'g-7'))).status === 'trial', 'gmail: first');
ok((await status(await mk(8, 'g-8'))).status === 'expired', 'gmail: googlemail spelling blocked');
ok((await status(await mk(9, 'g-9'))).status === 'expired', 'gmail: extra dots + tag + upper-case blocked');
await addUser(10, '+only@gmail.com');
const k10 = await mk(10, 'g-10');
ok((await status(k10)).status === 'expired', 'degenerate address (empty local part): no trial');
ok(await claimsOf(q, 'user', U(10)) === 0, 'degenerate address: nothing claimed');
await addUser(11, null);
ok((await status(await mk(11, 'g-11'))).status === 'expired', 'user with no email at all: no trial, no crash');
await addUser(12, 'unverified@example.org', false);
ok((await status(await mk(12, 'u-12'))).status === 'expired', 'unverified: no trial');
await db.query(`update auth.users set email_confirmed_at=now() where id=$1`, [U(12)]);
ok((await status(await mk(12, 'u-12b'))).status === 'trial', 'after verifying, the next team earns the trial (nothing was burned)');
// delete and recreate
const f1b = await mk(1, 'farm-1b');
ok((await status(f1b)).status === 'expired', 'second team of the same person: no trial');
await q(`delete from public.organizations where id in ($1,$2)`, [f1, f1b]);
ok((await status(await mk(1, 'farm-1c'))).status === 'expired', 'delete every team and recreate: still no trial');
// a failed creation must not burn the claim
await addUser(13, 'newbie@example.net'); await addUser(14, 'other@example.net');
await mk(14, 'taken-slug');
await throws(mk(13, 'taken-slug'), /duplicate|unique|slug/i, 'duplicate slug is refused');
ok(await claimsOf(q, 'email', 'newbie@example.net') === 0 && await claimsOf(q, 'user', U(13)) === 0, 'a failed creation does not consume the trial');
ok((await status(await mk(13, 'fresh-13'))).status === 'trial', '...so the retry still gets it');
ok(await claimsOf(q, 'email', 'farm@example.com') === 1, 'record survives team deletion');
await throws(asUser(U(1), `insert into public.trial_claims(claim_hash) values('x')`), /permission denied/, 'trial_claims not writable by users');
await throws(asUser(U(1), `insert into public.organizations(name,slug) values('direct','direct-1')`), /row-level security|permission/, 'users cannot insert organizations directly (cap/trial bypass)');
await throws(asUser(U(1), `insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'owner','x')`, [f1b, U(1)]), /./, 'users cannot insert memberships directly');
await throws(asUser(U(1), `select private.email_key('a@b.c')`), /permission denied|schema/, 'private.email_key is not callable by users');
await throws(anon(`select private.organizations_start_trial()`), /permission denied|schema/, 'trigger function not callable by anon');

console.log('B2. 3-team cap');
await addUser(20, 'cap@example.com'); await addUser(21, 'host@example.com');
const c1 = await mk(20, 'cap-1'); await mk(20, 'cap-2'); await mk(20, 'cap-3');
await throws(mk(20, 'cap-4'), /own up to 3 teams/, '4th team refused');
ok((await q(`select count(*)::int c from public.organizations where slug='cap-4'`)).rows[0].c === 0, 'nothing was created by the refused call');
const host = await mk(21, 'host-1');
await asUser(U(21), `insert into public.invitations(org_id,email,role,invited_by) values($1,'cap@example.com','member',$2)`, [host, U(21)]);
const tk = (await q(`select token from public.invitations where org_id=$1`, [host])).rows[0].token;
await allowed(asUser(U(20), `select public.accept_invitation($1,'Cap')`, [tk]), 'a person at the cap can still join another team as a member');
await q(`delete from public.organizations where id=$1`, [c1]);
await allowed(mk(20, 'cap-5'), 'after deleting one team another can be created');
ok((await status((await q(`select id from public.organizations where slug='cap-5'`)).rows[0].id)).status === 'expired', '...without a new trial');
await throws(anon(`select public.create_organization_as($1,$2,'x','x-anon','America/Toronto','x')`, [U(20), SECRET]), /permission denied/, 'anon cannot create teams');
await throws(asUser(U(20), `select public.create_organization_as($1,$2,'x','x-user','America/Toronto','x')`, [U(20), SECRET]), /permission denied/, 'a signed-in browser cannot create teams or choose the key itself');

console.log('B3. no-trial team: subscribe and legit flows');
const nt = (await q(`select id from public.organizations where slug='cap-5'`)).rows[0].id;
await throws(asUser(U(20), `insert into public.services(org_id,name,slug) values($1,'S','s')`, [nt]), /row-level security/, 'no-trial team: owner cannot add a service');
await allowed(q(`insert into public.services(org_id,name,slug,duration_minutes) values($1,'Starter','starter',30)`, [nt]), 'server (service role / postgres) can add the starter services');
ok((await asUser(U(20), `select count(*)::int c from public.services where org_id=$1`, [nt])).rows[0].c === 1, 'owner can read them');
ok((await asUser(U(20), `select (public.billing_status($1))->>'entitled' e`, [nt])).rows[0].e === 'false', 'billing_status says not entitled');
ok((await anon(`select public.org_accepts_bookings($1) a`, [nt])).rows[0].a === false, 'booking page paused');
await q(`update public.subscriptions set status='active', stripe_customer_id='cus_nt', stripe_subscription_id='sub_nt', current_period_end=now()+interval '30 days' where org_id=$1`, [nt]);
await allowed(asUser(U(20), `insert into public.services(org_id,name,slug) values($1,'Paid','paid')`, [nt]), 'after subscribing the owner can write');
ok((await anon(`select public.org_accepts_bookings($1) a`, [nt])).rows[0].a === true, '...and the page is live');
const lim = (await q(`select * from private.billing_limits($1)`, [nt])).rows[0];
ok(lim.max_locations === 1 && lim.max_staff === 5, 'paid base plan on a no-trial team: 1 location / 5 staff');

console.log('B4. read-only: every table, plus definer RPCs, on a plan and off it');
await addUser(30, 'ro@example.com'); await addUser(31, 'member@example.com');
const ro = await mk(30, 'ro-org');
const mem = (await q(`select id from public.memberships where org_id=$1 and user_id=$2`, [ro, U(30)])).rows[0].id;
await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'member','Mem')`, [ro, U(31)]);
const mem2 = (await q(`select id from public.memberships where org_id=$1 and user_id=$2`, [ro, U(31)])).rows[0].id;
const loc = (await q(`insert into public.locations(org_id,name) values($1,'Main') returning id`, [ro])).rows[0].id;
const svc = (await q(`insert into public.services(org_id,name,slug,duration_minutes) values($1,'Cut','cut',30) returning id`, [ro])).rows[0].id;
const cls = (await q(`insert into public.services(org_id,name,slug,is_class,class_capacity,duration_minutes) values($1,'Yoga','yoga',true,5,60) returning id`, [ro])).rows[0].id;
const wf = (await q(`insert into public.workflows(org_id,name,trigger) values($1,'W','booking_confirmed') returning id`, [ro])).rows[0].id;
const step = (await q(`insert into public.workflow_steps(workflow_id,org_id,channel,subject,body,position) values($1,$2,'email','s','b',0) returning id`, [wf, ro])).rows[0].id;
const sA = (await q(`insert into public.class_sessions(org_id,service_id,member_id,starts_at,ends_at,blocked_until,capacity) values($1,$2,$3,'2026-11-10T15:00Z','2026-11-10T16:00Z','2026-11-10T16:00Z',5) returning id`, [ro, cls, mem])).rows[0].id;
const sB = (await q(`insert into public.class_sessions(org_id,service_id,member_id,starts_at,ends_at,blocked_until,capacity) values($1,$2,$3,'2026-11-11T15:00Z','2026-11-11T16:00Z','2026-11-11T16:00Z',5) returning id`, [ro, cls, mem])).rows[0].id;
await anon(`select public.create_public_session_booking($1,$2,'M','m@x.test','','',null,1,null)`, [ro, sA]);
const bk = (await q(`select id from public.bookings where session_id=$1`, [sA])).rows[0].id;
await q(`insert into public.calendar_connections(org_id,member_id,provider,refresh_token_enc) values($1,$2,'google','enc')`, [ro, mem]);

// on a plan, the legitimate versions of each write succeed
await allowed(asUser(U(30), `insert into public.service_staff(service_id,member_id) values($1,$2)`, [svc, mem]), 'plan: service_staff insert');
await allowed(asUser(U(30), `insert into public.member_locations(location_id,member_id) values($1,$2)`, [loc, mem]), 'plan: member_locations insert');
await allowed(asUser(U(30), `insert into public.workflow_services(workflow_id,service_id) values($1,$2)`, [wf, svc]), 'plan: workflow_services insert');
ok((await asUser(U(30), `update public.workflow_steps set body='x' where id=$1 returning 1`, [step])).rows.length === 1, 'plan: workflow_steps update');
ok((await asUser(U(30), `update public.memberships set title='Lead' where id=$1 returning 1`, [mem2])).rows.length === 1, 'plan: owner edits a member');
await allowed(asUser(U(30), `select public.move_class_booking($1,$2)`, [bk, sB]), 'plan: move_class_booking works');
ok((await q(`select session_id from public.bookings where id=$1`, [bk])).rows[0].session_id === sB, 'plan: booking really moved');
await allowed(asUser(U(31), `select public.move_class_session($1,'2026-11-20T15:00Z')`, [sB]), 'plan: move_class_session works (even for a plain member, as before)');
ok(new Date((await q(`select starts_at from public.bookings where id=$1`, [bk])).rows[0].starts_at).toISOString() === '2026-11-20T15:00:00.000Z', 'plan: the people in the session moved with it');

// now expire
await q(`update public.subscriptions set status='expired' where org_id=$1`, [ro]);
await throws(asUser(U(30), `insert into public.service_staff(service_id,member_id) values($1,$2)`, [cls, mem]), /row-level/, 'expired: service_staff insert refused');
await throws(asUser(U(30), `insert into public.member_locations(location_id,member_id) values($1,$2)`, [loc, mem2]), /row-level/, 'expired: member_locations insert refused');
await throws(asUser(U(30), `insert into public.workflow_services(workflow_id,service_id) values($1,$2)`, [wf, cls]), /row-level/, 'expired: workflow_services insert refused');
ok((await asUser(U(30), `delete from public.service_staff where service_id=$1 returning 1`, [svc])).rows.length === 0, 'expired: service_staff delete affects nothing');
ok((await asUser(U(30), `delete from public.member_locations where location_id=$1 returning 1`, [loc])).rows.length === 0, 'expired: member_locations delete affects nothing');
ok((await asUser(U(30), `delete from public.workflow_services where workflow_id=$1 returning 1`, [wf])).rows.length === 0, 'expired: workflow_services delete affects nothing');
await throws(asUser(U(30), `insert into public.workflow_steps(workflow_id,org_id,channel,subject,body,position) values($1,$2,'email','s','b',5)`, [wf, ro]), /row-level/, 'expired: workflow_steps insert refused');
ok((await asUser(U(30), `delete from public.workflow_steps where id=$1 returning 1`, [step])).rows.length === 0, 'expired: workflow_steps delete affects nothing');
ok((await asUser(U(30), `update public.calendar_connections set status='active' where member_id=$1 returning 1`, [mem])).rows.length === 0, 'expired: calendar_connections update affects nothing');
ok((await asUser(U(30), `delete from public.calendar_connections where member_id=$1 returning 1`, [mem])).rows.length === 0, 'expired: calendar_connections delete affects nothing');
await throws(asUser(U(30), `insert into public.calendar_connections(org_id,member_id,provider,refresh_token_enc) values($1,$2,'microsoft','e')`, [ro, mem]), /row-level/, 'expired: calendar_connections insert refused');
ok((await asUser(U(30), `update public.memberships set display_name='Hax' where id=$1 returning 1`, [mem2])).rows.length === 0, 'expired: owner cannot rename a member');
ok((await asUser(U(31), `update public.memberships set display_name='Self' where id=$1 returning 1`, [mem2])).rows.length === 0, 'expired: a member cannot edit their own row either (read-only)');
await throws(asUser(U(31), `select public.move_class_booking($1,$2)`, [bk, sA]), /subscription/, 'expired: move_class_booking refused for a plain member with the clear message');
await throws(asUser(U(30), `select public.move_class_session($1,'2026-12-01T15:00Z')`, [sB]), /subscription/, 'expired: move_class_session refused for the owner');
await throws(asUser(U(31), `select public.add_team_member($1,'X',null,null,null)`, [ro]), /./, 'expired: add_team_member refused');
await throws(asUser(U(30), `select public.add_team_member($1,'X',null,null,null)`, [ro]), /not active/, 'expired: add_team_member refused for the owner (plan not active)');
await throws(asUser(U(30), `insert into public.invitations(org_id,email,role,invited_by) values($1,'z@x.test','member',$2)`, [ro, U(30)]), /./, 'expired: cannot invite');
ok((await asUser(U(31), `delete from public.memberships where id=$1 returning 1`, [mem2])).rows.length === 1, 'expired: a member can still leave on their own');
ok((await asUser(U(30), `select count(*)::int c from public.bookings where org_id=$1`, [ro])).rows[0].c === 1, 'expired: reads still work');
await allowed(asUser(U(30), `delete from public.organizations where id=$1`, [ro]), 'expired: the owner can still delete the whole team');

console.log('B6. D-006: limit/plan refusals carry hint "billing" so the invite page can use invitee wording');
{
  await addUser(40, 'hostb@example.com'); await addUser(41, 'inv@example.com');
  const h = await mk(40, 'hint-org');
  await q(`insert into public.memberships(org_id,user_id,role,display_name) select $1, null, 'member', 'p'||g from generate_series(1,4) g`, [h]);
  await q(`alter table public.invitations disable trigger invitations_limit_guard`);
  await q(`insert into public.invitations(org_id,email,role,invited_by) values($1,'inv@example.com','member',$2)`, [h, U(40)]);
  await q(`insert into public.invitations(org_id,email,role,invited_by) values($1,'inv2@example.com','member',$2)`, [h, U(40)]);
  await q(`alter table public.invitations enable trigger invitations_limit_guard`);
  const tok = (await q(`select token from public.invitations where email='inv@example.com' and org_id=$1`, [h])).rows[0].token;
  // 5 members, 1 other pending invitation reserved: the invitee has no room
  let err = null;
  try { await asUser(U(41), `select public.accept_invitation($1,'I')`, [tok]); } catch (e) { err = e; }
  ok(err && err.hint === 'billing', 'staff limit on accept: error hint is billing (' + (err && err.message.slice(0, 50)) + ')');
  await q(`update public.subscriptions set status='expired' where org_id=$1`, [h]);
  err = null;
  try { await asUser(U(41), `select public.accept_invitation($1,'I')`, [tok]); } catch (e) { err = e; }
  ok(err && err.hint === 'billing', 'inactive plan on accept: error hint is billing');
  err = null;
  try { await asUser(U(40), `select public.move_class_session('${G(99)}','2026-12-01T10:00Z')`); } catch (e) { err = e; }
  ok(err && /not found/i.test(err.message), 'move_class_session on a missing session says not found (no plan leak)');
  err = null;
  try { await anon(`select public.create_public_booking('${h}','${G(98)}',null,'2026-11-02T15:00:00Z','A','a@x.test','','n')`); } catch (e) { err = e; }
  ok(err !== null, 'expired: public booking refused');
}

console.log('B7. regression: recurring series and class waitlist on a plan, refused off it');
{
  await addUser(50, 'ser@example.com');
  const s = await mk(50, 'series-org');
  await q(`update public.subscriptions set status='active', current_period_end=now()+interval '20 days' where org_id=$1`, [s]);
  const m = (await q(`select id from public.memberships where org_id=$1`, [s])).rows[0].id;
  const sv = (await q(`insert into public.services(org_id,name,slug,duration_minutes,allow_series) values($1,'Cut','cut',30,true) returning id`, [s])).rows[0].id;
  const r1 = await anon(`select public.create_public_booking_series($1,$2,$3,'2026-11-02T15:00:00Z','Ser','ser@x.test','','n',null,null,null,1,3,false) j`, [s, sv, m]);
  ok(r1.rows[0].j !== null, 'plan: a 3-week recurring series books');
  ok((await q(`select count(*)::int c from public.bookings where org_id=$1`, [s])).rows[0].c === 3, 'plan: three bookings exist');
  const cl = (await q(`insert into public.services(org_id,name,slug,is_class,class_capacity,duration_minutes) values($1,'Yoga','yoga',true,1,60) returning id`, [s])).rows[0].id;
  const se = (await q(`insert into public.class_sessions(org_id,service_id,member_id,starts_at,ends_at,blocked_until,capacity) values($1,$2,$3,'2026-11-12T15:00Z','2026-11-12T16:00Z','2026-11-12T16:00Z',1) returning id`, [s, cl, m])).rows[0].id;
  await anon(`select public.create_public_session_booking($1,$2,'A','a@x.test','','',null,1,null)`, [s, se]);
  await allowed(anon(`select public.join_class_waitlist($1,$2,'B','b@x.test','','',null,1,null)`, [s, se]), 'plan: join waitlist');
  const tokA = (await q(`select manage_token t from public.bookings where session_id=$1`, [se])).rows[0].t;
  await anon(`select public.cancel_booking_by_token($1,'x')`, [tokA]);
  ok((await q(`select status from public.class_waitlist where email='b@x.test'`)).rows[0].status === 'booked', 'plan: cancel auto-promotes the waitlist');
  await q(`update public.subscriptions set status='expired' where org_id=$1`, [s]);
  await throws(anon(`select public.create_public_booking_series($1,$2,$3,'2026-12-07T15:00:00Z','Ser','ser2@x.test','','n',null,null,null,1,3,false)`, [s, sv, m]), /not accepting/, 'expired: recurring series refused');
  ok((await q(`select count(*)::int c from public.bookings where org_id=$1 and customer_id in (select id from public.customers where email='ser2@x.test')`, [s])).rows[0].c === 0, 'expired: nothing partially created');
  const tok1 = (await q(`select manage_token t from public.bookings where org_id=$1 and session_id is null order by starts_at limit 1`, [s])).rows[0].t;
  await allowed(anon(`select public.cancel_series_following_by_token($1,'x')`, [tok1]), 'expired: customer can still cancel their series');
}

console.log('B5. generic audit: write policies without a billing policy (informational)');
const unc = await q(`select distinct p.tablename t, p.cmd from pg_policies p
  where p.schemaname='public' and p.permissive='PERMISSIVE' and p.cmd in ('INSERT','UPDATE','DELETE','ALL')
  and not exists (select 1 from pg_policies b where b.schemaname='public' and b.tablename=p.tablename and b.permissive='RESTRICTIVE' and b.policyname like 'billing:%'
      and (b.cmd = p.cmd or p.cmd='ALL' and b.cmd in ('INSERT','UPDATE','DELETE')))
  order by 1,2`);
console.log('   uncovered:', unc.rows.map((r) => `${r.t}(${r.cmd})`).join(', ') || 'none');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
