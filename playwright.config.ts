import { defineConfig } from "@playwright/test";
import fs from "node:fs";

// The tests talk to the same Supabase project as the app (for test-only setup), so read the same settings.
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// End-to-end tests run against a local Tempo started by e2e/dev-server.sh (stand-in email/SMS/Stripe) and
// tagged test data created by e2e/seed.mjs. They use the installed Chrome, so no browser download is needed.
export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 90_000,
  expect: { timeout: 8_000 },
  workers: 1, // one shared database: run one test at a time, in file order
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "off",
  },
});
