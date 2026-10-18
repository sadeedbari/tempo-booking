// Round-3 (final) adversarial checks for the trial rules, privileges and seat counting (QA). In-memory only.
//   PGLITE_DIR=<folder where `npm i @electric-sql/pglite` was run> node tests/sql/billing-round3.test.mjs
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

async function boot() {
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
  for (const f of files.filter((f) => f < BILLING)) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  const applyBilling = async () => db.exec(fs.readFileSync(path.join(MIG, BILLING), 'utf8'));
  const as = async (role, uid, sql, p) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid || ''}',false), set_config('request.jwt.claim.role','${role}',false)`);
    try { return await db.query(sql, p); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)`); }
  };
  return { db, applyBilling, q: (s, p) => db.query(s, p), asUser: (id, s, p) => as('authenticated', id, s, p), anon: (s, p) => as('anon', '', s, p), svc: (s, p) => as('service_role', '', s, p) };
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(c ? '  PASS' : '  FAIL', m); };
const throws = async (p, rx, m) => { try { await p; fail++; console.log('  FAIL (no error)', m); } catch (e) { const g = !rx || rx.test(e.message); if (g) pass++; else fail++; console.log(g ? '  PASS' : '  FAIL', m, '->', e.message.slice(0, 110)); } };
const SECRET = 'round3-secret-0123456789';
const G = (n) => `20000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

console.log('R0. migration applied WITH the operator key supplied in the session (set_config path)');
{
  const { db, q, svc, applyBilling } = await boot();
  await db.exec(`insert into auth.users(id,email) values('${G(1)}','Own.er@gmail.com'),('${G(2)}','two@x.test'),('${G(3)}',null)`);
  await db.exec(`select set_config('request.jwt.claim.sub','${G(1)}',false)`);
  await db.exec(`select public.create_organization('A','a-1','America/Toronto','O')`);
  await db.exec(`select set_config('request.jwt.claim.sub','${G(2)}',false)`);
  await db.exec(`select public.create_organization('B','b-1','America/Toronto','O')`);
  await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
  await db.exec(`select set_config('tempo.trial_claim_secret','${SECRET}',false)`);
  await applyBilling();
  ok((await q(`select count(*)::int c from public.trial_claims`)).rows[0].c === 4, 'key supplied: the migration itself backfilled 2 email + 2 user hashes');
  ok((await svc(`select public.backfill_trial_claims($1) n`, [SECRET])).rows[0].n === 0, 'running the script afterwards adds nothing (idempotent)');
  await db.exec(`select set_config('tempo.trial_claim_secret','',false)`);
  ok((await q(`select s.status from public.subscriptions s join public.organizations o on o.id=s.org_id where o.slug='a-1'`)).rows[0].status === 'trial', 'legacy teams keep their trial');
  const o = (await svc(`select public.create_organization_as($1,$2,'N','n-1','America/Toronto','O') o`, [G(1), SECRET])).rows[0].o;
  ok((await q(`select status from public.subscriptions where org_id=$1`, [o])).rows[0].status === 'expired', 'legacy owner (gmail dots) gets no second trial after the key-supplied migration');
}

const B = await boot();
await B.applyBilling();
const { db, q, asUser, anon, svc } = B;
const addUser = (n, email, confirmed = true) => db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,${confirmed ? 'now()' : 'null'})`, [G(n), email]);
const mk = async (n, slug, secret = SECRET) => (await svc(`select public.create_organization_as($1,$2,'T',$3,'America/Toronto','O') as id`, [G(n), secret, slug])).rows[0].id;
const st = async (id) => (await q(`select status from public.subscriptions where org_id=$1`, [id])).rows[0].status;
const nClaims = async () => (await q(`select count(*)::int c from public.trial_claims`)).rows[0].c;

console.log('R1. key length boundary and fail-closed on every entry point');
await addUser(1, 'len@x.test');
const c0 = await nClaims();
await throws(mk(1, 'k15', 'x'.repeat(15)), /not available/, '15-character key refused');
await throws(mk(1, 'k0', ''), /not available/, 'empty key refused');
await throws(svc(`select public.create_organization_as($1,null,'T','knull','America/Toronto','O')`, [G(1)]), /not available/, 'null key refused');
await throws(svc(`select public.backfill_trial_claims($1)`, ['y'.repeat(15)]), /not available/, 'backfill with a 15-character key refused');
await throws(svc(`select public.backfill_trial_claims(null)`), /not available/, 'backfill with null key refused');
await throws(svc(`select public.forget_trial_claim('',$1,'a@b.c')`, [G(1)]), /not available/, 'forget with empty key refused');
ok((await nClaims()) === c0 && (await q(`select count(*)::int c from public.organizations`)).rows[0].c === 0, 'nothing created, nothing claimed by any refused call');
const t16 = await mk(1, 'k16', 'z'.repeat(16));
ok((await st(t16)) === 'trial', '16-character key accepted');
await throws(svc(`select public.create_organization_as($1,$2,'T','ghost','America/Toronto','O')`, ['99999999-0000-0000-0000-000000000000', SECRET]), /Not authenticated/, 'unknown user id refused');

console.log('R2. who can call what (EXECUTE privileges)');
for (const fn of ['public.create_organization_as(uuid,text,text,text,text,text)', 'public.backfill_trial_claims(text)', 'public.forget_trial_claim(text,uuid,text)']) {
  const r = (await q(`select has_function_privilege('anon',$1,'execute') a, has_function_privilege('authenticated',$1,'execute') u, has_function_privilege('service_role',$1,'execute') s, (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid=$1::regprocedure and x.grantee=0) pub`, [fn])).rows[0];
  ok(!r.a && !r.u && r.s && r.pub === 0, `${fn}: service_role only (anon ${r.a}, authenticated ${r.u}, PUBLIC grants ${r.pub})`);
}
for (const [role, run] of [['authenticated', (s, p) => asUser(G(1), s, p)], ['anon', (s, p) => anon(s, p)]]) {
  await throws(run(`select public.backfill_trial_claims($1)`, [SECRET]), /permission denied/, `${role}: backfill_trial_claims denied`);
  await throws(run(`select public.forget_trial_claim($1,$2,'len@x.test')`, [SECRET, G(1)]), /permission denied/, `${role}: forget_trial_claim denied`);
  await throws(run(`select public.create_organization_as($1,$2,'T','br','America/Toronto','O')`, [G(1), SECRET]), /permission denied/, `${role}: create_organization_as denied`);
  await throws(run(`select * from public.trial_claims`), /permission denied/, `${role}: trial_claims unreadable`);
  await throws(run(`insert into public.trial_claims(claim_hash) values ('x')`), /permission denied/, `${role}: trial_claims unwritable`);
  await throws(run(`delete from public.trial_claims`), /permission denied/, `${role}: trial_claims undeletable`);
  await throws(run(`select private.claim_hash('email','a',$1)`, [SECRET]), /permission denied/, `${role}: private.claim_hash unreachable`);
}
await throws(asUser(G(1), `insert into public.organizations(name,slug) values('x','sneak')`), /row-level security|permission denied/, 'a browser role cannot insert an organization directly');
ok((await q(`select relrowsecurity from pg_class where oid='public.trial_claims'::regclass`)).rows[0].relrowsecurity === true, 'trial_claims has RLS on');
ok((await q(`select count(*)::int c from pg_policy where polrelid='public.trial_claims'::regclass`)).rows[0].c === 0, 'trial_claims has no policies');
ok((await q(`select count(*)::int c from pg_constraint where conrelid='public.trial_claims'::regclass and contype='f'`)).rows[0].c === 0, 'trial_claims has no foreign keys (survives deletes)');

console.log('R3. delete and recreate, aliases, email change');
await addUser(2, 'Dot.Ted+shop@Gmail.com');
const a1 = await mk(2, 'al-1');
ok((await st(a1)) === 'trial', 'first team: trial');
await q(`delete from public.organizations where id=$1`, [a1]);
await db.query(`delete from auth.users where id=$1`, [G(2)]);
await addUser(3, 'dotted@googlemail.com');
ok((await st(await mk(3, 'al-2'))) === 'expired', 'account DELETED, new account with an alias of the same address: no trial');
await addUser(4, 'chg@x.test');
ok((await st(await mk(4, 'ch-1'))) === 'trial', 'email-change user: first team trial');
await q(`update auth.users set email='chg2@x.test' where id=$1`, [G(4)]);
ok((await st(await mk(4, 'ch-2'))) === 'expired', 'same user after email change: no second trial');
await q(`update auth.users set email='chg@x.test' where id=$1`, [G(4)]);
ok((await st(await mk(4, 'ch-3'))) === 'expired', 'same user changing back: still none');
await addUser(5, 'chg@x.test');
ok((await st(await mk(5, 'ch-4'))) === 'expired', 'another account taking the ORIGINAL address: no trial');
await addUser(6, 'brandnew@x.test', false);
ok((await st(await mk(6, 'un-1'))) === 'expired', 'unverified: no trial');
await q(`update auth.users set email='fresh@x.test', email_confirmed_at=now() where id=$1`, [G(6)]);
ok((await st(await mk(6, 'un-2'))) === 'trial', 'unverified user who verifies a fresh address then earns exactly one trial');
ok((await st(await mk(6, 'un-3'))) === 'expired', '...and not a second');

console.log('R4. forget_trial_claim and what is stored');
await addUser(7, 'forget@x.test'); await addUser(8, 'keep@x.test');
await mk(7, 'f-7'); await mk(8, 'f-8');
const before = await nClaims();
ok((await svc(`select public.forget_trial_claim($1,$2,$3) n`, ['another-secret-0123456789', G(7), 'forget@x.test'])).rows[0].n === 0, 'wrong key removes nothing');
ok((await svc(`select public.forget_trial_claim($1,$2,$3) n`, [SECRET, G(7), 'forget@x.test'])).rows[0].n === 2, 'right key removes exactly this person\'s 2 records');
ok((await nClaims()) === before - 2, 'nobody else was touched');
ok((await svc(`select public.forget_trial_claim($1,$2,null) n`, [SECRET, G(8)])).rows[0].n === 1, 'null email: only the user record goes');
ok((await st(await mk(7, 'f-7b'))) === 'trial', 'a forgotten person earns a trial again (e2e cleanup works)');
const cols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name='trial_claims' order by 1`)).rows.map((x) => x.column_name);
ok(JSON.stringify(cols) === '["claim_hash","claimed_at"]', 'columns: ' + cols.join());
const dump = JSON.stringify((await q(`select * from public.trial_claims`)).rows);
ok(!/@/.test(dump) && !/2000000/.test(dump) && /^[0-9a-f]{64}$/.test(JSON.parse(dump)[0].claim_hash), 'data: only 64-hex hashes, no email or user id');

console.log('R5. the key is never stored');
const tables = (await q(`select table_schema s, table_name t from information_schema.tables where table_schema in ('public','auth') and table_type='BASE TABLE'`)).rows;
let leaks = 0;
for (const { s, t } of tables) {
  const r = await q(`select count(*)::int c from ${s}.${t} x where x::text like $1`, ['%' + SECRET + '%']);
  leaks += r.rows[0].c;
}
ok(leaks === 0, 'the secret appears in no row of any public or auth table (' + tables.length + ' tables scanned)');
ok(((await q(`select current_setting('tempo.claim_secret', true) v`)).rows[0].v ?? '') === '', 'the claim GUC is cleared after team creation');
ok(((await q(`select current_setting('tempo.claim_uid', true) v`)).rows[0].v ?? '') === '', 'the claim user GUC is cleared');
ok(((await q(`select count(*)::int c from pg_proc where prosrc like '%' || $1 || '%'`, [SECRET])).rows[0].c) === 0, 'the secret is in no function body');

console.log('R6. owner cap: creation, promotion, and a rolled-back claim');
await addUser(9, 'cap@x.test');
for (const i of [1, 2, 3]) await mk(9, 'cap-' + i);
const nBefore = await nClaims();
await throws(mk(9, 'cap-4'), /own up to 3 teams/, '4th creation refused');
ok((await nClaims()) === nBefore, 'a refused 4th team claims nothing');
await addUser(10, 'host@x.test');
const host = await mk(10, 'host-1');
await q(`update public.subscriptions set status='active', current_period_end=now()+interval '20 days' where org_id=$1`, [host]);
await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,$2,'admin','Cap')`, [host, G(9)]);
const mid = (await q(`select id from public.memberships where org_id=$1 and user_id=$2`, [host, G(9)])).rows[0].id;
await throws(asUser(G(10), `update public.memberships set role='owner' where id=$1`, [mid]), /already owns 3 teams/, 'owner promoting a person who owns 3 teams is refused');
await throws(q(`update public.memberships set user_id=$1, role='owner' where id=$2`, [G(9), mid]), /already owns 3 teams/, 'role+user swap path refused');
ok((await q(`select count(*)::int c from public.memberships where user_id=$1 and role='owner'`, [G(9)])).rows[0].c === 3, 'still exactly 3');
// the lock that serialises concurrent creations and promotions is taken in both functions
const src = (await q(`select string_agg(prosrc, ' ') s from pg_proc where proname in ('create_organization_as','owner_cap_guard')`)).rows[0].s;
ok((src.match(/pg_advisory_xact_lock\(hashtext\('owner_cap:' \|\| (p_uid|new\.user_id)::text\)\)/g) || []).length === 2, 'both paths take the same per-person advisory lock before counting');

console.log('R7. pending invitations hold a seat, consistently');
await addUser(11, 'inv-owner@x.test');
const org = await mk(11, 'inv-1');
await q(`update public.subscriptions set status='active', current_period_end=now()+interval '20 days' where org_id=$1`, [org]);
for (let i = 0; i < 3; i++) await q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,null,'member',$2)`, [org, 'm' + i]);
const count = async () => (await q(`select (select count(*)::int from public.memberships where org_id=$1) m, (select count(*)::int from public.invitations where org_id=$1 and accepted_at is null and member_id is null and expires_at>now()) i`, [org])).rows[0];
await q(`insert into public.invitations(org_id,email,role) values($1,'p1@x.test','member')`, [org]);
let c = await count();
ok(c.m === 4 && c.i === 1, '4 members + 1 pending = 5 of 5');
await throws(q(`insert into public.memberships(org_id,user_id,role,display_name) values($1,null,'member','sixth')`, [org]), /plan includes 5 staff/, 'a 5th member is refused while one invitation waits');
await throws(q(`insert into public.invitations(org_id,email,role) values($1,'p2@x.test','member')`, [org]), /plan includes 5 staff/, 'a second invitation is refused');
await addUser(12, 'p1@x.test');
await q(`select set_config('request.jwt.claim.sub','${G(12)}',false)`);
const tok = (await q(`select token from public.invitations where email='p1@x.test'`)).rows[0].token;
await asUser(G(12), `select public.accept_invitation($1,'P1')`, [tok]);
c = await count();
ok(c.m === 5 && c.i === 0, 'the invitee still fits when their own invitation is the one counted');
await q(`update public.invitations set expires_at = now() - interval '1 day'`);
c = await count();
ok(c.i === 0, 'an expired invitation no longer counts');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
