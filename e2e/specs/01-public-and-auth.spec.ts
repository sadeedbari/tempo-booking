import { test, expect } from "@playwright/test";
import { login, logout, S, watchErrors } from "./helpers";

test.describe("public pages", () => {
  test("landing, privacy and terms load and link to each other", async ({ page }) => {
    const w = watchErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Booking");
    await page.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page.getByRole("heading", { name: "Privacy Policy" }).first()).toBeVisible();
    await expect(page.getByText("info@sulosystems.com").first()).toBeVisible();
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: /Terms/ }).first()).toBeVisible();
    w.assertNone();
  });

  test("unknown addresses show the friendly 404 with a way back", async ({ page }) => {
    for (const url of ["/no-such-business", "/o/no-such-team/dashboard", "/booking/not-a-real-token", "/embed/no-such-business", "/invite/not-a-token"]) {
      const res = await page.goto(url);
      expect([200, 404], url).toContain(res?.status());
      await expect(page.locator("body"), url).not.toContainText(/Application error|Internal Server Error|digest/i);
    }
    await page.goto("/no-such-business");
    await expect(page.getByText("find that page")).toBeVisible();
    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
  });

  test("protected pages send signed-out visitors to sign in, and back afterwards", async ({ page }) => {
    await page.goto(`/o/${S.orgA.slug}/calendar`);
    await expect(page).toHaveURL(/\/login/);
    await login(page, "ownerA", `/o/${S.orgA.slug}/services`);
    await expect(page).toHaveURL(new RegExp(`/o/${S.orgA.slug}/services`));
  });
});

test.describe("sign in and sign up forms", () => {
  test("wrong password shows a clear message and stays on the page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(S.people.ownerA.email);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/don.t match|invalid|incorrect/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("empty and malformed input is stopped by the form", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("x");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("A B");
    await page.getByLabel("Email").fill("e2e.short@tempo-e2e.test");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("signing in lands on the team's Home; signing out returns to the landing page", async ({ page }) => {
    const w = watchErrors(page);
    await login(page, "ownerA");
    await page.goto("/app");
    await expect(page).toHaveURL(new RegExp(`/o/${S.orgA.slug}/dashboard`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByTitle("Sign out").click();
    await expect(page).toHaveURL(/\/($|login)/);
    await page.goto(`/o/${S.orgA.slug}/dashboard`);
    await expect(page).toHaveURL(/\/login/);
    w.assertNone();
  });

  test("a person with no team is sent to set one up", async ({ page }) => {
    await login(page, "stranger");
    await page.goto("/app");
    await expect(page).toHaveURL(/\/onboarding/);
    await logout(page);
  });
});

test.describe("people from another team", () => {
  test("cannot open a team they don't belong to", async ({ page }) => {
    await login(page, "ownerB");
    for (const p of ["dashboard", "calendar", "bookings", "customers", "services", "team", "settings", "workflows", "schedule", "availability"]) {
      const res = await page.goto(`/o/${S.orgA.slug}/${p}`);
      await expect(page.locator("body"), p).not.toContainText("E2E Salon");
      expect(res?.status(), p).toBe(404);
    }
  });
});
