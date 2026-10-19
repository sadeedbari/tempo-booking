// Teams and the trial: a person's first team gets the 14-day trial, the second and third start without one and say "Choose a plan",
// and at 3 owned teams /onboarding explains the cap with a way back, and the team menu stops offering "New team" (D-016).
// (Creating a team when the server's TRIAL_CLAIM_SECRET is missing cannot be tested here.) Person: Nora (no teams in the seed).
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { S, mock, watchErrors } from "./helpers";
import { admin, createTeamFor, billingUrl, bodyText, deleteTestOrgs, forgetTrialClaimOf, noHorizontalScroll, openAt, sizeFor, subRow } from "./billing-helpers";

const nora = () => S.people.stranger;
const slugs = ["e2e-nora-one", "e2e-nora-two", "e2e-nora-three"];

async function createTeam(page: Page, name: string, slug: string) {
  await page.goto("/onboarding");
  await page.getByLabel("Team or business name").fill(name);
  await page.getByLabel("Booking link").fill(slug);
  await page.getByRole("button", { name: "Create team" }).click();
}
async function orgIdOf(slug: string) {
  return ((await (await admin()).from("organizations").select("id").eq("slug", slug).single()).data as { id: string }).id;
}

test.beforeAll(async () => { await deleteTestOrgs("e2e-nora"); await forgetTrialClaimOf(nora()); });
test.afterAll(async () => { await deleteTestOrgs("e2e-nora"); await forgetTrialClaimOf(nora()); });
test.beforeEach(async () => { await mock.clear(); });

test.describe.configure({ mode: "serial" });

test.describe("trial, no-trial and the 3-team cap", () => {
  test("a person's first team gets a 14-day trial, shown on the billing page and in the strip", async ({ pageAs }) => {
    const page = await pageAs("stranger");
    const w = watchErrors(page);
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Set up your team" })).toBeVisible();
    await createTeam(page, "E2E Nora One", slugs[0]);
    await page.waitForURL(/\/o\/e2e-nora-one\/calendar\?welcome=1/);
    await page.goto(billingUrl(slugs[0]));
    await expect(page.getByText("14 days left. Your trial ends")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Free trial: 14 days left." })).toBeVisible();
    await expect(page.getByText("Your free trial was already used")).toHaveCount(0);
    const row = await subRow(await orgIdOf(slugs[0]));
    expect(row.status).toBe("trial");
    expect(row.stripe_customer_id).toBeNull();
    w.assertNone();
  });

  test("the second team starts without a trial: it is told why, and offered 'Choose a plan'; starter services are there to read", async ({ pageAs }) => {
    const page = await pageAs("stranger");
    const w = watchErrors(page);
    // the menu still offers "New team" with one team
    await page.goto(`/o/${slugs[0]}/dashboard`);
    await page.getByRole("button", { name: /E2E Nora One/ }).first().click();
    await expect(page.getByRole("link", { name: "New team" })).toBeVisible();
    await page.getByRole("link", { name: "New team" }).click();
    await page.waitForURL(/\/onboarding/);
    await createTeam(page, "E2E Nora Two", slugs[1]);
    await page.waitForURL(/\/o\/e2e-nora-two\/settings\/billing\?notice=no-trial/);
    await expect(page.getByText("Your free trial was already used on another team, so this team starts without one. Choose a plan below to switch it on.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Your plan isn't active." })).toBeVisible();
    await expect(page.getByText("No active plan.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Subscribe for $15/month" })).toBeEnabled();
    const row = await subRow(await orgIdOf(slugs[1]));
    expect(row.status).toBe("expired");
    expect(row.stripe_customer_id).toBeNull();
    await page.goto(`/o/${slugs[1]}/services`);
    await expect(page.getByText("Standard appointment")).toBeVisible();
    // and the public page of that team is paused until it subscribes
    await page.goto(`/${slugs[1]}`);
    await expect(page.getByRole("heading", { name: "E2E Nora Two isn't accepting bookings right now" })).toBeVisible();
    w.assertNone();
  });

  test("the third team is allowed (also without a trial); the first team keeps its trial", async ({ pageAs }) => {
    const page = await pageAs("stranger");
    await createTeam(page, "E2E Nora Three", slugs[2]);
    await page.waitForURL(/\/o\/e2e-nora-three\/settings\/billing\?notice=no-trial/);
    await expect(page.getByRole("heading", { name: "Choose a plan" })).toBeVisible();
    expect((await subRow(await orgIdOf(slugs[0]))).status).toBe("trial");
  });

  for (const width of [375, 768, 1280] as const) {
    test(`at 3 teams /onboarding explains the cap, has no form, and a way back (${width}px)`, async ({ pageAs }) => {
      const page = await pageAs("stranger");
      const w = watchErrors(page);
      await openAt(page, width, "/onboarding");
      await expect(page.getByRole("heading", { name: "You have 3 teams", level: 1 })).toBeVisible();
      await expect(page.getByText("That is the most one person can own.")).toBeVisible();
      await expect(page.getByText("To create another team, delete one you no longer need from its Settings page first.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Set up your team" })).toHaveCount(0);
      await expect(page.getByLabel("Team or business name")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Create team" })).toHaveCount(0);
      const back = page.getByRole("link", { name: "Back to my dashboard" });
      await expect(back).toHaveAttribute("href", `/o/${slugs[0]}/dashboard`);
      await noHorizontalScroll(page);
      await back.click();
      await page.waitForURL(new RegExp(`/o/${slugs[0]}/dashboard`));
      w.assertNone();
    });
  }

  test("the team menu lists the three teams and no longer offers 'New team'; the Tempo logo link on /onboarding goes home", async ({ pageAs }) => {
    const page = await pageAs("stranger");
    for (const width of [1280, 375] as const) {
      await openAt(page, width, `/o/${slugs[0]}/dashboard`);
      await page.getByRole("button", { name: /E2E Nora One/ }).first().click();
      for (const n of ["E2E Nora One", "E2E Nora Two", "E2E Nora Three"]) await expect(page.getByRole("link", { name: new RegExp(n) })).toBeVisible();
      await expect(page.getByRole("link", { name: "New team" })).toHaveCount(0);
    }
    // another team in the menu opens that team's dashboard
    await openAt(page, 1280, `/o/${slugs[0]}/dashboard`);
    await page.getByRole("button", { name: /E2E Nora One/ }).first().click();
    await page.getByRole("link", { name: /E2E Nora Two/ }).click();
    await page.waitForURL(/\/o\/e2e-nora-two\/dashboard/);
    await page.goto("/onboarding");
    await page.getByRole("link").first().click(); // the logo
    await expect(page).not.toHaveURL(/onboarding/);
  });

  test("a form left open in another tab cannot get round the cap: the 4th team is refused with a plain message and nothing is created", async ({ pageAs, browser }) => {
    // free a slot, open the form in a second tab, take the slot back with a new team, then submit the stale form
    await deleteTestOrgs("e2e-nora-three");
    const page = await pageAs("stranger");
    const stale = await pageAs("stranger");
    await stale.goto("/onboarding");
    await expect(stale.getByLabel("Team or business name")).toBeVisible();
    await createTeam(page, "E2E Nora Three", slugs[2]);
    await page.waitForURL(/\/o\/e2e-nora-three\//);
    await stale.getByLabel("Team or business name").fill("E2E Nora Four");
    await stale.getByLabel("Booking link").fill("e2e-nora-four");
    await stale.getByRole("button", { name: "Create team" }).click();
    await expect(stale.getByText("You can own up to 3 teams. Delete one you no longer need first.")).toBeVisible();
    await expect(stale).toHaveURL(/onboarding/);
    const found = await (await admin()).from("organizations").select("id").eq("slug", "e2e-nora-four");
    expect(found.data).toHaveLength(0);
  });

  test("a 4th team can't be created by calling the database either (the cap is enforced there too)", async () => {
    await expect(createTeamFor(nora(), { name: "E2E Nora Direct", slug: "e2e-nora-direct", timezone: "America/Toronto", displayName: "Nora" })).rejects.toThrow(/3 teams|own up to/i);
    const found = await (await admin()).from("organizations").select("id").eq("slug", "e2e-nora-direct");
    expect(found.data).toHaveLength(0);
  });
});
