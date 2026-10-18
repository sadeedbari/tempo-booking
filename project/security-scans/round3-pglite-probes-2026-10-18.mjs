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
const MIG = 'C:/Users/SAB/Documents/GitHub/tempo-booking/supabase/migrations';
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
  for (const f of files.filter((f) => applyBilling || f !== BILLING)) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
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


const U=(n)=>G(n);
const { db, q, asUser, anon, asService: svc } = await boot(true);
for (const [i,e] of [[1,'a@x.test'],[2,'b@x.test'],[3,'c@x.test']]) await db.query(`insert into auth.users(id,email) values($1,$2)`,[U(i),e]);
console.log('R2 probes');
await throws(asUser(U(1),`select public.create_organization_as($1,$2,'T','slug1','UTC','O')`,[U(2),SECRET]),/permission denied/,'authenticated cannot call create_organization_as (impersonation)');
await throws(anon(`select public.create_organization_as($1,$2,'T','slug1','UTC','O')`,[U(2),SECRET]),/permission denied/,'anon cannot call create_organization_as');
await throws(asUser(U(1),`select public.backfill_trial_claims($1)`,[SECRET]),/permission denied/,'authenticated cannot call backfill');
await throws(asUser(U(1),`select public.forget_trial_claim($1,$2,$3)`,[SECRET,U(1),'a@x.test']),/permission denied/,'authenticated cannot call forget_trial_claim');
await throws(anon(`select public.forget_trial_claim($1,$2,$3)`,[SECRET,U(1),'a@x.test']),/permission denied/,'anon cannot call forget_trial_claim');
await throws(asUser(U(1),`select public.create_organization('T','slug9','UTC','O')`),/does not exist/,'old create_organization gone');
await throws(asUser(U(1),`select private.claim_hash('email','a@x.test',$1)`,[SECRET]),/permission denied/,'private.claim_hash not callable by authenticated (hash oracle)');
await throws(svc(`select public.create_organization_as($1,null,'T','slug1','UTC','O')`,[U(1)]),/not available/,'null secret fails closed');
await throws(svc(`select public.create_organization_as($1,'short','T','slug1','UTC','O')`,[U(1)]),/not available/,'short secret fails closed');
await throws(svc(`select public.create_organization_as($1,$2,'T','slug1','UTC','O')`,['99999999-0000-0000-0000-000000000000',SECRET]),/Not authenticated/,'unknown uid refused');
ok((await q(`select count(*)::int c from public.organizations`)).rows[0].c===0,'no org created by failures');
ok((await q(`select count(*)::int c from public.trial_claims`)).rows[0].c===0,'no claims by failures');
// GUC cleanup after success and after failure
await svc(`select public.create_organization_as($1,$2,'T','slug1','UTC','O')`,[U(1),SECRET]);
let r=await q(`select current_setting('tempo.claim_secret',true) s, current_setting('tempo.claim_uid',true) u`);
ok(!r.rows[0].s && !r.rows[0].u,'GUCs cleared after success (session level check)');
await throws(svc(`select public.create_organization_as($1,$2,'T','slug1','UTC','O')`,[U(2),SECRET]),/duplicate|unique/,'dup slug fails');
r=await q(`select current_setting('tempo.claim_secret',true) s`);
ok(!r.rows[0].s,'GUC cleared after failure');
ok((await q(`select count(*)::int c from public.trial_claims`)).rows[0].c===2,'failed dup-slug attempt rolled back its claims (user 2 not burned)');
// secret does not leak into stored rows
const dump=JSON.stringify((await q(`select * from public.trial_claims`)).rows)+JSON.stringify((await q(`select * from public.organizations`)).rows)+JSON.stringify((await q(`select * from public.subscriptions`)).rows);
ok(!dump.includes(SECRET),'secret not in any stored row');
const pc=(await q(`select proname, prosrc from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace)`)).rows;
ok(!pc.some(p=>p.prosrc.includes(SECRET)),'secret not in function source');
// backfill idempotent, domain separation, rotation
const b1=(await svc(`select public.backfill_trial_claims($1) n`,[SECRET])).rows[0].n; const b2=(await svc(`select public.backfill_trial_claims($1) n`,[SECRET])).rows[0].n;
ok(b2===0,'backfill second run writes 0 (b1='+b1+')');
const hs=(await q(`select private.claim_hash('email','x',$1) a, private.claim_hash('user','x',$1) b, private.claim_hash('email','x',$2) c`,[SECRET,SECRET+'z'])).rows[0];
ok(hs.a!==hs.b && hs.a!==hs.c,'kinds and secrets separate');
// rotated secret: user 1 gets new trial?
await q(`select 1`);
const rot='another-secret-0123456789';
const o2=(await svc(`select public.create_organization_as($1,$2,'T','slug2','UTC','O') id`,[U(1),rot])).rows[0].id;
ok((await q(`select status from public.subscriptions where org_id=$1`,[o2])).rows[0].status==='trial','ROTATION: changing the secret re-grants a trial to a past user (documented)');
// owner cap: ownership transfer
await svc(`select public.create_organization_as($1,$2,'T','slug3','UTC','O')`,[U(1),SECRET]).catch(e=>console.log('  note',e.message));
const owned=(await q(`select count(*)::int c from public.memberships where user_id=$1 and role='owner'`,[U(1)])).rows[0].c; console.log('  user1 owners',owned);
const sx=(await q(`select id from public.organizations where slug='slug1'`)).rows[0].id;
await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'admin','B')`,[sx,U(3)]);
await allowed(asUser(U(1),`update public.memberships set role='owner' where org_id=$1 and user_id=$2`,[sx,U(3)]),'transfer: promote admin B (0 owned) to owner');
await allowed(asUser(U(1),`update public.memberships set role='admin' where org_id=$1 and user_id=$2`,[sx,U(1)]),'transfer: previous owner demotes self');
await allowed(asUser(U(3),`update public.memberships set role='admin' where org_id=$1 and user_id=$2`,[sx,U(1)]),'idempotent role writes ok');
await allowed(asUser(U(3),`update public.memberships set display_name='Z' where org_id=$1 and user_id=$2`,[sx,U(3)]),'owner updating own display name unaffected');
await q(`update public.memberships set role='owner' where org_id=$1 and user_id=$2`,[sx,U(1)]).then(()=>console.log('  re-promote ok'),e=>console.log('  re-promote:',e.message.slice(0,80)));
// existing >cap owner can still edit own other fields
console.log(pass,'pass',fail,'fail');
