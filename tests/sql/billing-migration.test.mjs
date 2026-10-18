// Runs the billing migration (and every migration before it) against an in-memory Postgres (PGlite, no network,
// never touches Supabase) and checks the plan rules at the database level.
//
//   mkdir <somewhere> && cd <somewhere> && npm i @electric-sql/pglite
//   PGLITE_DIR=<somewhere> node tests/sql/billing-migration.test.mjs
//
// Supabase pieces that PGlite lacks (roles, auth.uid(), auth.users) are stubbed below.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PGDIR = process.env.PGLITE_DIR;
if (!PGDIR) { console.error('Set PGLITE_DIR to a folder where `npm i @electric-sql/pglite` was run.'); process.exit(2); }
const req = createRequire(path.join(PGDIR, 'x.js'));
const imp = (s) => import(pathToFileURL(req.resolve(s)).href);
const { PGlite } = await imp('@electric-sql/pglite');
const { btree_gist } = await imp('@electric-sql/pglite/contrib/btree_gist');
const { pgcrypto } = await imp('@electric-sql/pglite/contrib/pgcrypto');
const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();

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
for (const f of files.filter((f) => f < '20261101')) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
for (let i = 1; i <= 5; i++) await db.exec(`insert into auth.users(id,email) values('${U(i)}','u${i}@x.test')`);
const as = async (role, uid, sql, p) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid || ''}',false), set_config('request.jwt.claim.role','${role}',false)`);
  try { return await db.query(sql, p); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)`); }
};
const user = (n, sql, p) => as('authenticated', U(n), sql, p);
const anon = (sql, p) => as('anon', '', sql, p);
const q = (sql, p) => db.query(sql, p);
// S-012: teams are created by the server (service role) on behalf of a person, with the secret key for the trial hashes.
// (The browser-callable create_organization was replaced by create_organization_as in the billing migration.)
const SECRET = 'test-trial-secret-0123456789';
const createOrg = (n, name, slug, disp) => as('service_role', '', `select public.create_organization_as($1,$2,$3,$4,'America/Toronto',$5) as id`, [U(n), SECRET, name, slug, disp]).then((r) => r.rows[0].id);
const claimCount = async (kind, val) => (await q(`select count(*)::int c from public.trial_claims where claim_hash = private.claim_hash($1,$2,$3)`, [kind, val, SECRET])).rows[0].c;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(c ? '  PASS' : '  FAIL', m); };
const throws = async (p, rx, m) => { try { await p; fail++; console.log('  FAIL (no error)', m); } catch (e) { const g = !rx || rx.test(e.message); if (g) pass++; else fail++; console.log(g ? '  PASS' : '  FAIL', m, '->', e.message.slice(0, 100)); } };
const allowed = async (p, m) => { try { await p; pass++; console.log('  PASS', m); } catch (e) { fail++; console.log('  FAIL', m, '->', e.message.slice(0, 120)); } };

// Legacy business that exists BEFORE the migration: 8 people, 3 locations.
const legacy = (await user(1, `select public.create_organization('Legacy','legacy-org','America/Toronto','Owner1') as id`)).rows[0].id;
await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'admin','A'),($1,null,'member','x1'),($1,null,'member','x2'),($1,null,'member','x3'),($1,null,'member','x4'),($1,null,'member','x5'),($1,null,'member','x6')`, [legacy, U(2)]);
await q(`insert into public.locations(org_id,name) values($1,'L1'),($1,'L2'),($1,'L3')`, [legacy]);
// the operator-supplied key lets the migration itself hash-backfill the legacy owners' trial records (S-012)
await db.exec(`select set_config('tempo.trial_claim_secret', '${SECRET}', false)`);
await db.exec(fs.readFileSync(path.join(MIG, '20261101000000_subscription_billing.sql'), 'utf8'));
console.log('migration applied');

console.log('F1 trial');
let r = (await q(`select status, extract(epoch from trial_ends_at - now())/86400 as d from public.subscriptions where org_id=$1`, [legacy])).rows[0];
ok(r.status === 'trial' && Math.abs(r.d - 14) < 0.01, 'existing org backfilled with a 14-day trial');
const org = await createOrg(3, 'Fresh', 'fresh-org', 'Owner3');
r = (await q(`select status, stripe_customer_id, extract(epoch from trial_ends_at - now())/86400 as d from public.subscriptions where org_id=$1`, [org])).rows[0];
ok(r.status === 'trial' && Math.abs(r.d - 14) < 0.01 && r.stripe_customer_id === null, 'new org gets trial, no Stripe customer');

console.log('F5 limits in trial');
for (let i = 1; i <= 4; i++) await user(3, `select public.add_team_member($1,$2,null,null,null)`, [org, 'S' + i]);
await throws(user(3, `select public.add_team_member($1,'S6',null,null,null)`, [org]), /5 staff/, '6th staff refused in trial');
await throws(user(1, `select public.add_team_member($1,'Z',null,null,null)`, [legacy]), /staff/, 'legacy over-limit org cannot add more');
ok((await q(`select count(*)::int c from public.memberships where org_id=$1`, [legacy])).rows[0].c === 8, 'legacy members untouched');
await user(3, `insert into public.locations(org_id,name) values($1,'Main')`, [org]);
await throws(user(3, `insert into public.locations(org_id,name) values($1,'Second')`, [org]), /location/, '2nd active location refused');
await allowed(user(3, `insert into public.locations(org_id,name,active) values($1,'Closed',false)`, [org]), 'inactive location not counted');
await throws(user(3, `update public.locations set active=true where org_id=$1 and name='Closed'`, [org]), /location/, 'reactivation beyond limit refused');
await throws(q(`insert into public.locations(org_id,name) values($1,'svc')`, [org]), /location/, 'postgres/service role also blocked by trigger');

console.log('F2 price/limits (3 loc + 2 packs)');
await q(`update public.subscriptions set status='active', extra_locations=2, staff_packs=2, current_period_end=now()+interval '20 days' where org_id=$1`, [org]);
r = (await q(`select * from private.billing_limits($1)`, [org])).rows[0];
ok(r.max_locations === 3 && r.max_staff === 25, 'limits 3 locations / 25 staff');
await allowed(user(3, `update public.locations set active=false where org_id=$1 and name='Main'`, [org]), 'deactivate');
await allowed(user(3, `insert into public.locations(org_id,name) values($1,'A'),($1,'B'),($1,'C')`, [org]), '3 active locations ok');
await throws(user(3, `insert into public.locations(org_id,name) values($1,'D')`, [org]), /3 location/, '4th refused');
for (let i = 6; i <= 24; i++) await user(3, `select public.add_team_member($1,$2,null,null,null)`, [org, 'S' + i]);
ok((await q(`select count(*)::int c from public.memberships where org_id=$1`, [org])).rows[0].c === 24, '24 members');
// D-007: a pending invitation reserves a seat in the database
await user(3, `insert into public.invitations(org_id,email,role,invited_by) values($1,'u4@x.test','member',$2)`, [org, U(3)]);
const invTok = (await q(`select token from public.invitations where org_id=$1 and email='u4@x.test'`, [org])).rows[0].token;
await throws(user(3, `select public.add_team_member($1,'S25',null,null,null)`, [org]), /25 staff/, '25th seat is reserved by the pending invitation');
await throws(user(3, `insert into public.invitations(org_id,email,role,invited_by) values($1,'other@x.test','member',$2)`, [org, U(3)]), /25 staff/, 'a second invitation is refused (no seat left)');
await allowed(user(3, `insert into public.invitations(org_id,email,role,invited_by,member_id) values($1,'login@x.test','member',$2,$3)`, [org, U(3), (await q(`select id from public.memberships where org_id=$1 and display_name='S6'`, [org])).rows[0].id]), 'an invitation that links an existing team member needs no seat');
await allowed(user(4, `select public.accept_invitation($1, 'Four')`, [invTok]), 'the invited person can accept (their own reservation is not counted twice)');
ok((await q(`select count(*)::int c from public.memberships where org_id=$1`, [org])).rows[0].c === 25, '25 members');
await throws(user(3, `select public.add_team_member($1,'S26',null,null,null)`, [org]), /25 staff/, '26th refused');
await q(`delete from public.memberships where org_id=$1 and user_id=$2`, [org, U(4)]);
await q(`update public.invitations set expires_at = now() - interval '1 day' where org_id=$1`, [org]);
await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,null,'member','filler')`, [org]); // seat taken
await q(`alter table public.invitations disable trigger invitations_limit_guard`);
await q(`insert into public.invitations(org_id,email,role,invited_by) values($1,'u4@x.test','member',$2)`, [org, U(3)]); // an invitation made before the seat was taken
await q(`alter table public.invitations enable trigger invitations_limit_guard`);
const invTok2 = (await q(`select token from public.invitations where org_id=$1 and email='u4@x.test' and accepted_at is null and expires_at > now()`, [org])).rows[0].token;
await throws(user(4, `select public.accept_invitation($1, 'Four')`, [invTok2]), /25 staff/, 'accepting when the seat was taken meanwhile is refused (hint: billing)');
await q(`delete from public.memberships where org_id=$1 and display_name='filler'`, [org]);

console.log('Booking path (public RPC) + F6 expiry');
const svc = (await q(`insert into public.services(org_id,name,slug,duration_minutes) values($1,'Cut','cut',30) returning id`, [org])).rows[0].id;
const when = '2026-11-02T15:00:00Z';
const mem = (await q(`select id from public.memberships where org_id=$1 and user_id=$2`, [org, U(3)])).rows[0].id;
await q(`update public.locations set active=false where org_id=$1`, [org]);
let b = await anon(`select public.create_public_booking($1,$2,$3,$4,'Cust One','c1@x.test','','n') as j`, [org, svc, mem, when]);
ok(!!b.rows[0].j, 'active org: public booking works');
const tok = (await q(`select manage_token t from public.bookings where org_id=$1`, [org])).rows[0].t;
await q(`update public.subscriptions set status='trial', trial_ends_at=now()-interval '1 second' where org_id=$1`, [org]);
ok((await anon(`select public.org_accepts_bookings($1) a`, [org])).rows[0].a === false, 'org_accepts_bookings false 1s after trial end');
await throws(anon(`select public.create_public_booking($1,$2,$3,$4,'Cust Two','c2@x.test','','n')`, [org, svc, mem, '2026-11-02T16:00:00Z']), /not accepting/, 'expired: public booking refused');
await throws(user(3, `insert into public.bookings(org_id,member_id,starts_at,ends_at,blocked_until,source) values($1,$2,'2026-11-03T15:00Z','2026-11-03T15:30Z','2026-11-03T15:30Z','manual')`, [org, mem]), /not accepting/, 'expired: dashboard booking refused');
await throws(user(3, `insert into public.services(org_id,name,slug) values($1,'New','new')`, [org]), /row-level security/, 'expired: owner cannot create service (RLS)');
r = await user(3, `update public.services set name='Renamed' where org_id=$1 returning id`, [org]);
ok(r.rows.length === 0, 'expired: owner update of service affects 0 rows (RLS)');
r = await user(3, `delete from public.services where org_id=$1 returning id`, [org]);
ok(r.rows.length === 0, 'expired: owner delete of service affects 0 rows');
r = await user(3, `update public.organizations set name='Hacked' where id=$1 returning id`, [org]);
ok(r.rows.length === 0, 'expired: organization settings read-only');
ok((await user(3, `select count(*)::int c from public.bookings where org_id=$1`, [org])).rows[0].c === 1, 'expired: owner can still read bookings (export)');
ok((await user(3, `select count(*)::int c from public.customers where org_id=$1`, [org])).rows[0].c === 1, 'expired: owner can still read customers');
await allowed(anon(`select public.cancel_booking_by_token($1,'x')`, [tok]), 'expired: customer can cancel with token');
ok((await q(`select status from public.bookings where manage_token=$1`, [tok])).rows[0].status === 'cancelled', 'booking cancelled');

console.log('Tables with org_id not covered by the read-only policies (informational)');
r = await q(`select c.table_name from information_schema.columns c join pg_class k on k.relname=c.table_name and k.relnamespace='public'::regnamespace
  where c.table_schema='public' and c.column_name='org_id' and k.relkind='r'
  and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.table_name and p.policyname like 'billing: plan required%')
  and c.table_name not in ('subscriptions') order by 1`);
console.log('   uncovered:', r.rows.map((x) => x.table_name).join(', '));
r = await user(3, `update public.memberships set display_name='Renamed in read-only' where org_id=$1 and id=$2 returning id`, [org, mem]);
console.log('   memberships update while expired affects rows:', r.rows.length);

await q(`update public.subscriptions set status='expired' where org_id=$1`, [org]);
for (const [label, sql, args] of [
  ['service_staff insert', `insert into public.service_staff(service_id,member_id) values($1,$2) returning 1`, [svc, mem]],
  ['member_locations insert', `insert into public.member_locations(location_id,member_id) select id,$2 from public.locations where org_id=$1 limit 1 returning 1`, [org, mem]],
]) {
  const rr = await user(3, sql, args).then((x) => 'ALLOWED rows=' + x.rows.length, (e) => 'refused: ' + e.message.slice(0, 50));
  console.log('   expired,', label + ':', rr);
}
console.log('Waitlist promotion in expired org');
await q(`update public.subscriptions set status='active', trial_ends_at=now()+interval '1 day', current_period_end=now()+interval '10 days' where org_id=$1`, [org]);
const cls = (await q(`insert into public.services(org_id,name,slug,is_class,class_capacity,duration_minutes) values($1,'Yoga','yoga',true,1,60) returning id`, [org])).rows[0].id;
const ses = (await user(3, `insert into public.class_sessions(org_id,service_id,member_id,starts_at,ends_at,blocked_until,capacity) values($1,$2,$3,'2026-11-10T15:00Z','2026-11-10T16:00Z','2026-11-10T16:00Z',1) returning id`, [org, cls, mem])).rows[0].id;
await anon(`select public.create_public_session_booking($1,$2,'A','a@x.test','','',null,1,null)`, [org, ses]);
await anon(`select public.join_class_waitlist($1,$2,'B','b@x.test','','',null,1,null)`, [org, ses]);
await q(`update public.subscriptions set status='cancelled' where org_id=$1`, [org]);
await throws(anon(`select public.join_class_waitlist($1,$2,'C','c@x.test','','',null,1,null)`, [org, ses]), /not accepting/, 'expired: join waitlist refused');
await throws(user(3, `insert into public.class_sessions(org_id,service_id,member_id,starts_at,ends_at,blocked_until,capacity) values($1,$2,$3,'2026-11-11T15:00Z','2026-11-11T16:00Z','2026-11-11T16:00Z',1)`, [org, cls, mem]), /not accepting|row-level/, 'expired: cannot add class session');
const tokA = (await q(`select manage_token t from public.bookings where session_id=$1`, [ses])).rows[0].t;
await allowed(anon(`select public.cancel_booking_by_token($1,'x')`, [tokA]), 'expired: cancelling a class booking succeeds (promotion does not roll it back)');
ok((await q(`select status from public.class_waitlist where email='b@x.test'`)).rows[0].status === 'waiting', 'expired: waitlist person NOT auto-booked');
await q(`update public.subscriptions set status='active' where org_id=$1`, [org]);
r = await q(`select private.promote_class_waitlist($1) n`, [ses]);
ok(r.rows[0].n === 1, 'after resubscribe: promotion works again');

console.log('Definer RPCs that move things must also respect the read-only rule');
await q(`update public.subscriptions set status='active', cancel_at_period_end=false, current_period_end=now()+interval '5 days' where org_id=$1`, [org]);
const ses2 = (await user(3, `insert into public.class_sessions(org_id,service_id,member_id,starts_at,ends_at,blocked_until,capacity) values($1,$2,$3,'2026-11-12T15:00Z','2026-11-12T16:00Z','2026-11-12T16:00Z',5) returning id`, [org, cls, mem])).rows[0].id;
const ses3 = (await user(3, `insert into public.class_sessions(org_id,service_id,member_id,starts_at,ends_at,blocked_until,capacity) values($1,$2,$3,'2026-11-13T15:00Z','2026-11-13T16:00Z','2026-11-13T16:00Z',5) returning id`, [org, cls, mem])).rows[0].id;
await anon(`select public.create_public_session_booking($1,$2,'M','m@x.test','','',null,1,null)`, [org, ses2]);
const bk = (await q(`select id from public.bookings where session_id=$1`, [ses2])).rows[0].id;
await anon(`select public.create_public_booking($1,$2,$3,'2026-11-04T15:00:00Z','Resch','r@x.test','','n')`, [org, svc, mem]);
const rtok = (await q(`select manage_token t from public.bookings where customer_id=(select id from public.customers where email='r@x.test')`)).rows[0].t;
await q(`update public.subscriptions set status='expired' where org_id=$1`, [org]);
// D-009 decision: a customer who ALREADY has a booking may still move it on a paused business (it only moves an existing booking;
// every path that creates a NEW booking is refused above). Cancelling by token is allowed for the same reason.
await allowed(anon(`select public.reschedule_booking_by_token($1,'2026-11-04T17:00:00Z')`, [rtok]), 'expired: customer may reschedule an EXISTING booking via token (D-009 decision)');
await throws(user(3, `select public.move_class_booking($1,$2)`, [bk, ses3]), /./, 'expired: move_class_booking (owner, direct RPC) is refused');
await throws(user(3, `select public.move_class_session($1,'2026-11-20T15:00Z')`, [ses3]), /./, 'expired: move_class_session (owner, direct RPC) is refused');

console.log('Single multi-row statements cannot jump the limit');
const org4 = await createOrg(4, 'Multi', 'multi-org', 'Owner4');
await throws(user(4, `insert into public.locations(org_id,name) values($1,'m1'),($1,'m2'),($1,'m3')`, [org4]), /location/, 'trial: inserting 3 locations in one statement is refused');
ok((await q(`select count(*)::int c from public.locations where org_id=$1`, [org4])).rows[0].c === 0, 'nothing was inserted');
await throws(q(`insert into public.memberships(org_id,user_id,role,display_name) select $1, null, 'member', 'p'||g from generate_series(1,6) g`, [org4]), /staff/, 'trial: 6 members in one statement refused (owner already counts)');
await throws(user(4, `with a as (insert into public.locations(org_id,name) values($1,'w1') returning id) insert into public.locations(org_id,name) values($1,'w2')`, [org4]), /location/, 'trial: two locations via CTE refused');
await throws(user(4, `insert into public.locations(org_id,name,active) values($1,'x1',false),($1,'x2',false)`, [org4]).then(()=>user(4,`update public.locations set active=true where org_id=$1`,[org4])), /location/, 'trial: reactivating two hidden locations in one UPDATE refused');

console.log('Entitlement boundaries');
const ent = async (set) => { await q(`update public.subscriptions set status='trial', cancel_at_period_end=false, past_due_since=null, current_period_end=null, trial_ends_at=now()+interval '1 day' where org_id=$1`, [org]); await q(`update public.subscriptions set ${set} where org_id=$1`, [org]); return (await q(`select private.billing_entitled($1) e`, [org])).rows[0].e; };
ok(await ent(`trial_ends_at=now()+interval '1 second'`) === true, 'trial 1s left: entitled');
ok(await ent(`status='active', cancel_at_period_end=true, current_period_end=now()+interval '1 day'`) === true, 'cancel at period end: active before period end');
ok(await ent(`status='active', cancel_at_period_end=true, current_period_end=now()-interval '1 day'`) === true, 'cancel at period end: 1 day after end still entitled (2-day slack)');
ok(await ent(`status='active', cancel_at_period_end=true, current_period_end=now()-interval '3 days'`) === false, 'cancel at period end: 3 days after end blocked');
ok(await ent(`status='past_due', past_due_since=now()-interval '6 days 23 hours'`) === true, 'past_due 6d23h: grace');
ok(await ent(`status='past_due', past_due_since=now()-interval '7 days 1 minute'`) === false, 'past_due 7d+: blocked');
ok(await ent(`status='past_due', past_due_since=null`) === true, 'past_due with null since: entitled (grace restarts every call)');
ok(await ent(`status='expired'`) === false, 'expired blocked');

console.log('Access control');
await q(`update public.subscriptions set status='active', cancel_at_period_end=false, current_period_end=now()+interval '5 days' where org_id=$1`, [org]);
ok((await user(3, `select count(*)::int c from public.subscriptions`)).rows[0].c === 1, 'owner reads own subscription row');
ok((await user(2, `select count(*)::int c from public.subscriptions where org_id=$1`, [legacy])).rows[0].c === 0, 'admin cannot read subscription row');
ok((await user(1, `select count(*)::int c from public.subscriptions where org_id=$1`, [org])).rows[0].c === 0, 'other org owner cannot read row');
await throws(user(3, `update public.subscriptions set status='active', staff_packs=200 where org_id=$1`, [org]), /permission denied/, 'owner cannot write subscription');
await throws(user(3, `insert into public.subscriptions(org_id,trial_ends_at) values('${U(1)}', now())`), /permission denied/, 'cannot insert subscription');
await throws(anon(`select * from public.subscriptions`), /permission denied/, 'anon cannot read subscriptions');
await throws(anon(`select * from public.stripe_billing_events`), /permission denied/, 'anon cannot read events');
await throws(user(3, `select * from public.stripe_billing_events`), /permission denied/, 'authenticated cannot read events');
ok((await user(2, `select public.billing_status($1) j`, [legacy])).rows[0].j !== null, 'admin may read plan summary');
ok((await user(3, `select public.billing_status($1) j`, [legacy])).rows[0].j === null, 'outsider gets null summary');
await throws(anon(`select public.billing_status($1)`, [org]), /permission denied/, 'anon cannot call billing_status');
await allowed(anon(`select public.org_accepts_bookings($1)`, [org]), 'anon may call org_accepts_bookings');
const leak = await user(3, `select private.billing_entitled($1) e`, [legacy]).then(() => 'callable', () => 'denied');
console.log('   authenticated calling private.billing_entitled(other org):', leak);

console.log('D-002 / D-011 / S-009: more read-only tables, owner-only billing details, definer hygiene');
{
  await q(`update public.subscriptions set status='past_due', past_due_since=now()-interval '1 day', trial_ends_at=now()+interval '5 days', current_period_end=now()+interval '5 days' where org_id=$1`, [legacy]);
  const adm = (await user(2, `select public.billing_status($1) j`, [legacy])).rows[0].j;
  ok(adm.past_due_since === null && adm.current_period_end === null && adm.trial_ends_at === null && adm.status === 'active', 'admin: no payment-failure date, no period end, past_due shown as normal');
  const own = (await user(1, `select public.billing_status($1) j`, [legacy])).rows[0].j;
  ok(own.status === 'past_due' && own.past_due_since !== null, 'owner: sees the payment problem and its date');
  await q(`update public.subscriptions set status='active', past_due_since=null where org_id=$1`, [legacy]);
  const wf = (await q(`insert into public.workflows(org_id,name,trigger) values($1,'W','booking_confirmed') returning id`, [legacy])).rows[0].id;
  const lsvc = (await q(`insert into public.services(org_id,name,slug) values($1,'LS','ls') returning id`, [legacy])).rows[0].id;
  await allowed(user(1, `insert into public.workflow_services(workflow_id,service_id) values($1,$2)`, [wf, lsvc]), 'on a plan: workflow_services insert works');
  await allowed(user(1, `insert into public.workflow_steps(workflow_id,org_id,channel,subject,body,position) values($1,$2,'email','s','b',0)`, [wf, legacy]), 'on a plan: workflow_steps insert works');
  await q(`update public.subscriptions set status='expired' where org_id=$1`, [legacy]);
  await throws(user(1, `insert into public.workflow_steps(workflow_id,org_id,channel,subject,body,position) values($1,$2,'email','s','b',1)`, [wf, legacy]), /row-level security/, 'expired: workflow_steps insert refused');
  ok((await user(1, `delete from public.workflow_services where workflow_id=$1 returning 1`, [wf])).rows.length === 0, 'expired: workflow_services delete affects nothing');
  ok((await user(1, `update public.workflow_steps set body='x' where workflow_id=$1 returning 1`, [wf])).rows.length === 0, 'expired: workflow_steps update affects nothing');
  ok((await user(1, `update public.memberships set title='boss' where org_id=$1 and user_id=$2 returning 1`, [legacy, U(1)])).rows.length === 0, 'expired: owner cannot edit memberships');
  ok((await user(1, `delete from public.memberships where org_id=$1 and user_id=$2 returning 1`, [legacy, U(2)])).rows.length === 0, 'expired: owner cannot remove a member');
  ok((await user(2, `delete from public.memberships where org_id=$1 and user_id=$2 returning 1`, [legacy, U(2)])).rows.length === 1, 'expired: a member can still leave on their own');
  await throws(anon(`select public.create_public_inquiry($1,null,'Nina','nina@x.test','','Hello, do you have time on Friday?',null)`, [legacy]), /isn't taking messages/, 'S-010: expired: the public contact form is refused');
  await q(`update public.subscriptions set status='active' where org_id=$1`, [legacy]);
  await allowed(anon(`select public.create_public_inquiry($1,null,'Nina','nina@x.test','','Hello, do you have time on Friday?',null)`, [legacy]), 'S-010: on a plan: the contact form works');
  ok((await user(1, `update public.memberships set title='boss' where org_id=$1 and user_id=$2 returning 1`, [legacy, U(1)])).rows.length === 1, 'on a plan: owner edits memberships');
}

console.log('S-001 / D-013: one trial per person, and a cap on teams');
const trialOf = async (id) => (await q(`select status, trial_ended_email_sent_at is not null as noemail from public.subscriptions where org_id=$1`, [id])).rows[0];
const mkOrg = (n, slug) => createOrg(n, 'T', slug, 'O');
ok(await claimCount('email', 'u1@x.test') === 1 && await claimCount('user', U(1)) === 1, 'backfill: the owner of an existing business has used their trial (hashed email and hashed user id)');
const own1 = await mkOrg(1, 'u1-second');
ok((await trialOf(own1)).status === 'expired', 'owner of a legacy (backfilled) business gets no second trial');
ok((await trialOf(own1)).noemail === true, 'no "trial ended" email for a business that never had a trial');
const a1 = await mkOrg(5, 'u5-a');
ok((await trialOf(a1)).status === 'trial', 'first business of a new person gets the trial');
await q(`delete from public.organizations where id=$1`, [a1]);
ok(await claimCount('email', 'u5@x.test') === 1 && await claimCount('user', U(5)) === 1, 'deleting the business keeps the trial record');
const b1 = await mkOrg(5, 'u5-b');
ok((await trialOf(b1)).status === 'expired', 'delete and recreate: no new trial');
await throws(user(5, `insert into public.services(org_id,name,slug) values($1,'S','s')`, [b1]), /row-level security/, 'a business without a plan cannot be edited until it subscribes');
await q(`update public.subscriptions set status='active', current_period_end=now()+interval '20 days', stripe_customer_id='cus_x' where org_id=$1`, [b1]);
await allowed(user(5, `insert into public.services(org_id,name,slug) values($1,'S','s')`, [b1]), 'after subscribing it works (a paid plan is unaffected by the trial rule)');
await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${U(6)}','unverified@x.test',null),('${U(7)}','Dot.Ted+promo@gmail.com',now()),('${U(8)}','dotted@googlemail.com',now())`);
ok((await trialOf(await mkOrg(6, 'u6-a'))).status === 'expired', 'unverified email: the business starts without a trial');
ok(await claimCount('user', U(6)) === 0 && await claimCount('email', 'unverified@x.test') === 0, 'unverified email: nothing is claimed (the trial is not burned)');
ok((await trialOf(await mkOrg(7, 'u7-a'))).status === 'trial', 'gmail user: first business gets the trial');
ok((await trialOf(await mkOrg(8, 'u8-a'))).status === 'expired', 'same gmail address with dots, +tag and googlemail spelling: no second trial');
ok((await q(`select private.email_key('A.B+c@Example.com') k`)).rows[0].k === 'a.b@example.com', 'email_key keeps dots on other domains, drops +tag, lower-cases');
// cap: 3 teams per owner
await mkOrg(5, 'u5-c');
const b3 = await mkOrg(5, 'u5-d');
await throws(mkOrg(5, 'u5-e'), /own up to 3 teams/, 'the 4th team is refused');
await q(`delete from public.organizations where id=$1`, [b3]);
const b4 = await mkOrg(5, 'u5-f');
ok((await trialOf(b4)).status === 'expired', 'after deleting one, a new team is allowed but still gets no trial');
ok((await q(`select count(*)::int c from public.memberships where user_id=$1 and role='owner'`, [U(5)])).rows[0].c === 3, 'never more than 3 owned teams');
await throws(user(5, `select * from public.trial_claims`), /permission denied/, 'trial_claims is not readable through the API');

console.log('S-012: trial_claims holds hashes only');
r = await q(`select column_name from information_schema.columns where table_schema='public' and table_name='trial_claims' order by 1`);
ok(JSON.stringify(r.rows.map((x) => x.column_name)) === JSON.stringify(['claim_hash', 'claimed_at']), 'only claim_hash and claimed_at remain (no email, user id or org id): ' + r.rows.map((x) => x.column_name).join());
const dump = JSON.stringify((await q(`select * from public.trial_claims`)).rows);
ok(!/@/.test(dump) && !dump.includes(U(1)) && !dump.includes(org), 'no email address, user id or org id appears anywhere in the table');
ok((await q(`select count(*)::int c from public.trial_claims where claim_hash !~ '^[0-9a-f]{64}$'`)).rows[0].c === 0, 'every record is a 64-character HMAC-SHA256 hex digest');
const h1 = (await q(`select private.claim_hash('email','a@b.c','test-trial-secret-0123456789') h`)).rows[0].h;
const h2 = (await q(`select private.claim_hash('email','a@b.c','another-secret-0123456789ab') h`)).rows[0].h;
ok(h1 !== h2, 'a different key gives a different hash (the hash can not be recomputed without the secret)');
ok((await q(`select private.claim_hash('email','x','test-trial-secret-0123456789') = private.claim_hash('user','x','test-trial-secret-0123456789') as same`)).rows[0].same === false, 'email and user records of the same text do not collide');
await throws(q(`select private.claim_hash('email','a@b.c','')`), /not available/, 'fail closed: an empty key is refused');
await throws(q(`select private.claim_hash('email','a@b.c',null)`), /not available/, 'fail closed: a missing key is refused');
await throws(q(`select private.claim_hash('email','a@b.c','short')`), /not available/, 'fail closed: a short key is refused');
const before = (await q(`select count(*)::int c from public.trial_claims`)).rows[0].c;
await throws(as('service_role', '', `select public.create_organization_as($1,'','X','x-nokey','America/Toronto','O')`, [U(2)]), /not available/, 'fail closed: creating a team with an empty key fails');
await throws(as('service_role', '', `select public.create_organization_as($1,null,'X','x-nokey','America/Toronto','O')`, [U(2)]), /not available/, 'fail closed: ...and with a missing key');
ok((await q(`select count(*)::int c from public.organizations where slug='x-nokey'`)).rows[0].c === 0 && (await q(`select count(*)::int c from public.trial_claims`)).rows[0].c === before, 'nothing was created or claimed by the refused calls');
// a direct insert as the server without a key and without the settings never claims anything and never hashes with an empty key
await q(`insert into public.organizations(name,slug) values('Imported','imported-x')`);
ok((await q(`select count(*)::int c from public.trial_claims`)).rows[0].c === before, 'a row created without a signed-in person claims nothing');
// the trigger itself fails closed if someone names a creator but supplies no key
await q(`select set_config('tempo.claim_uid', '${U(2)}', false), set_config('tempo.claim_secret', '', false)`);
await throws(q(`insert into public.organizations(name,slug) values('NoKey','nokey-direct')`), /not available/, 'the trigger refuses to claim with an empty key');
await q(`select set_config('tempo.claim_uid', '', false)`);
await throws(user(3, `select public.create_organization_as($1,$2,'X','x-browser','America/Toronto','O')`, [U(3), SECRET]), /permission denied/, 'a signed-in user cannot call create_organization_as (service role only)');
await throws(anon(`select public.create_organization_as($1,$2,'X','x-anon2','America/Toronto','O')`, [U(3), SECRET]), /permission denied/, 'anon cannot call create_organization_as');
await throws(user(3, `select public.create_organization('X','x-old','America/Toronto','O')`), /does not exist/, 'the old browser-callable create_organization is gone');
await throws(user(3, `select public.backfill_trial_claims($1)`, [SECRET]), /permission denied/, 'users cannot run the backfill');
await throws(user(3, `select public.forget_trial_claim($1,$2,'a@b.c')`, [SECRET, U(3)]), /permission denied/, 'users cannot run forget_trial_claim');
await as('service_role', '', `select public.backfill_trial_claims($1) n`, [SECRET]); // (also records owners who had no claim, such as the unverified one)
ok((await as('service_role', '', `select public.backfill_trial_claims($1) n`, [SECRET])).rows[0].n === 0, 'backfill is idempotent: running it again adds nothing');

console.log('S-013: a changed verified email on one account does not renew the trial; the owner cap applies to promotions');
await db.exec(`insert into auth.users(id,email) values('${U(9)}','before@x.test')`);
ok((await trialOf(await createOrg(9, 'EA', 'ea-1', 'O'))).status === 'trial', 'first team of a new account: trial');
await q(`update auth.users set email='after@x.test' where id=$1`, [U(9)]);
ok((await trialOf(await createOrg(9, 'EB', 'ea-2', 'O'))).status === 'expired', 'same account, new verified email: no second trial');
ok(await claimCount('email', 'after@x.test') === 1, '...and the new address is recorded as used too');
// promotion: user 4 owns 3 teams, then another owner tries to promote them to owner of a 4th
await db.exec(`insert into auth.users(id,email) values('${U(10)}','cap4@x.test'), ('${U(11)}','host4@x.test')`);
const caps = [];
for (const i of [1, 2, 3]) caps.push(await createOrg(10, 'C', 'cap4-' + i, 'O'));
const hostOrg = await createOrg(11, 'H', 'host4', 'O');
await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'member','Cap4')`, [hostOrg, U(10)]);
const promo = (await q(`select id from public.memberships where org_id=$1 and user_id=$2`, [hostOrg, U(10)])).rows[0].id;
await throws(user(11, `update public.memberships set role='owner' where id=$1`, [promo]), /already owns 3 teams/, 'promoting a person who owns 3 teams to owner of a 4th is refused (guard_role_change path)');
await throws(q(`update public.memberships set role='owner' where id=$1`, [promo]), /already owns 3 teams/, '...also when done by the server');
const hostOrg2 = await createOrg(11, 'H2', 'host4b', 'O');
await q(`update public.subscriptions set status='active', current_period_end=now()+interval '20 days' where org_id=$1`, [hostOrg2]); // (so the plan check passes and the cap is what refuses)
await throws(q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'owner','Direct')`, [hostOrg2, U(10)]), /already owns 3 teams/, 'inserting a new owner membership for them is refused too');
ok((await q(`select count(*)::int c from public.memberships where user_id=$1 and role='owner'`, [U(10)])).rows[0].c === 3, 'never more than 3 owner memberships');
await q(`delete from public.organizations where id=$1`, [caps[0]]);
await allowed(user(11, `update public.memberships set role='owner' where id=$1`, [promo]), 'after one team is deleted the promotion works');
await allowed(q(`update public.memberships set role='owner', title='x' where id=$1`, [promo]), 'a membership that is already an owner can be edited (the cap only applies when it BECOMES owner)');
await allowed(q(`update public.memberships set role='admin' where id=$1`, [promo]), 'demoting is always allowed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
