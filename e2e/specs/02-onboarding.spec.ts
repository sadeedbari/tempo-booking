import { test, expect } from "@playwright/test";
import { login, S, watchErrors } from "./helpers";

test.describe("creating a team", () => {
  test.beforeEach(async ({ page }) => { await login(page, "stranger"); });

  const fill = async (page: import("@playwright/test").Page, name: string, slug?: string) => {
    await page.goto("/onboarding");
    await page.getByLabel("Team or business name").fill(name);
    if (slug !== undefined) await page.getByLabel("Booking link").fill(slug);
  };

  test("a missing name is refused", async ({ page }) => {
    await fill(page, "");
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page).toHaveURL(/onboarding/);
  });

  test("links that are too short, reserved or already taken give a clear message", async ({ page }) => {
    await fill(page, "E2E Tiny", "ab");
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByText(/at least 3/i)).toBeVisible();

    await fill(page, "E2E Reserved", "login");
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByText(/reserved/i)).toBeVisible();

    await fill(page, "E2E Copycat", S.orgA.slug);
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByText(/already taken/i)).toBeVisible();
    await expect(page).toHaveURL(/onboarding/);
  });

  test("odd characters in the link are cleaned up, and the team is created with starter services", async ({ page }) => {
    const w = watchErrors(page);
    await fill(page, "E2E Nora's Studio & Café!!", "E2E Nora's Café!!");
    await page.getByRole("button", { name: "Create team" }).click();
    await page.waitForURL(/\/o\/e2enorascaf\/calendar/);
    await expect(page.getByText("Your team is ready")).toBeVisible();
    await page.goto("/o/e2enorascaf/services");
    await expect(page.getByText("Standard appointment")).toBeVisible();
    await expect(page.getByText("Consultation").first()).toBeVisible();
    w.assertNone();
  });
});
