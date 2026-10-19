// Read-only: prints row counts so a run can prove it left the real data alone (and shows any e2e leftovers).
//   E2E_ALLOW_LIVE=1 node e2e/counts.mjs
import { admin, EMAIL_DOMAIN, guard } from "./lib.mjs";

guard();
const count = async (table, f = (q) => q) => {
  const { count: n, error } = await f(admin.from(table).select("*", { count: "exact", head: true }));
  return error ? `error: ${error.message}` : n;
};
const users = [];
for (let page = 1; ; page++) {
  const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (!data?.users.length) break;
  users.push(...data.users);
  if (data.users.length < 200) break;
}
console.log(JSON.stringify({
  organizations: await count("organizations"),
  e2e_orgs: await count("organizations", (q) => q.like("slug", "e2e%")),
  subscriptions: await count("subscriptions"),
  trial_claims: await count("trial_claims"),
  memberships: await count("memberships"),
  bookings: await count("bookings"),
  stripe_billing_events: await count("stripe_billing_events"),
  auth_users: users.length,
  e2e_users: users.filter((u) => u.email?.endsWith(`@${EMAIL_DOMAIN}`)).length,
}));
