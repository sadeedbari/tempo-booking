// The follow-up migration (20261102) applies on top of ALL earlier migrations and fixes search_path. In-memory only.
//   PGLITE_DIR=<folder where `npm i @electric-sql/pglite` was run> node tests/sql/billing-followups.test.mjs
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

const FOLLOW = '20261102000000_billing_followups.sql';
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
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(c ? '  PASS' : '  FAIL', m); };
const sp = async () => (await db.query(`select p.oid::regprocedure::text as fn, coalesce(array_to_string(p.proconfig, ','), '') as cfg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'`)).rows;

console.log('F1. every migration up to billing applies; max_owned_orgs has a mutable search_path before the follow-up');
for (const f of files.filter((f) => f <= '20261101000000_subscription_billing.sql')) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
ok((await sp()).find((r) => r.fn.startsWith('private.max_owned_orgs')).cfg === '', 'before: no search_path set (the advisor warning)');

console.log('F2. the follow-up applies on top');
ok(files.includes(FOLLOW), 'the follow-up migration exists');
await db.exec(fs.readFileSync(path.join(MIG, FOLLOW), 'utf8'));
const after = await sp();
ok(after.find((r) => r.fn.startsWith('private.max_owned_orgs')).cfg.includes('search_path'), 'after: max_owned_orgs has search_path set');
const loose = after.filter((r) => !/search_path/.test(r.cfg));
ok(loose.length === 0, 'no function in schema private has a mutable search_path' + (loose.length ? ': ' + loose.map((r) => r.fn).join(', ') : ''));
const pub = (await db.query(`select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname in ('forget_trial_claim','backfill_trial_claims','create_organization_as','billing_status','org_accepts_bookings') and coalesce(array_to_string(p.proconfig, ','),'') !~ 'search_path'`)).rows;
ok(pub.length === 0, 'the new public billing functions all set search_path');

console.log('F3. behaviour and grants unchanged');
ok((await db.query(`select private.max_owned_orgs() n`)).rows[0].n === 3, 'still returns 3');
await db.exec(`set role authenticated`);
let refused = false; try { await db.query(`select public.forget_trial_claim('x', null, 'a@b.c')`); } catch { refused = true; }
await db.exec(`reset role`);
ok(refused, 'forget_trial_claim is refused for authenticated (service_role only)');
await db.exec(`set role anon`);
refused = false; try { await db.query(`select public.forget_trial_claim('x', null, 'a@b.c')`); } catch { refused = true; }
await db.exec(`reset role`);
ok(refused, 'forget_trial_claim is refused for anon');
ok((await db.query(`select has_function_privilege('service_role','public.forget_trial_claim(text,uuid,text)','execute') ok`)).rows[0].ok, 'service_role can still run it (e2e cleanup)');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
