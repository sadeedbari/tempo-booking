#!/usr/bin/env bash
# Runs every end-to-end spec against the local server from e2e/dev-server.sh, re-creating the tagged test data
# before each file so they can't affect one another. Needs E2E_ALLOW_LIVE=1 (it uses the project in .env.local).
cd "$(dirname "$0")/.."
: "${E2E_ALLOW_LIVE:?set E2E_ALLOW_LIVE=1 to run (creates and deletes tagged test data)}"
out="${1:-e2e-results.txt}"
: > "$out"
echo "== API tests" >> "$out"
node e2e/seed.mjs >/dev/null && node --test e2e/api/booking.test.mjs e2e/api/permissions.test.mjs e2e/api/inquiries.test.mjs e2e/api/intake.test.mjs >> "$out" 2>&1
node e2e/seed.mjs >/dev/null && node --test e2e/api/system.test.mjs >> "$out" 2>&1
node e2e/seed.mjs >/dev/null && node --test e2e/api/recurring.test.mjs >> "$out" 2>&1
node e2e/seed.mjs >/dev/null && node --test e2e/api/classes.test.mjs >> "$out" 2>&1
node e2e/seed.mjs >/dev/null && node --test e2e/api/classes.test.mjs >> "$out" 2>&1
for spec in e2e/specs/[0-9]*.spec.ts; do
  echo "== $spec" >> "$out"
  node e2e/seed.mjs >/dev/null && npx playwright test "$spec" --reporter=list >> "$out" 2>&1
done
echo "== done" >> "$out"
