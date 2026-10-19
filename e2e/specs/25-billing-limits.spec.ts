// Plan limits and the upgrade prompt: the 6th person on a 5-staff plan, the 2nd location on a 1-location plan, who can buy
// the add-on and who is told to ask, invitations holding seats, and hidden locations not counting.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { S, mock, watchErrors } from "./helpers";
import {
  A, B, WIDTHS, admin, billingUrl, bodyText, captureAction, noHorizontalScroll, openAt, removeExtras, replayAction, restoreSeedPlans, setPlan, stripeMock, subRow,
} from "./billing-helpers";

const teamB = `/o/${S.orgB.slug}/team`;
const teamA = `/o/${S.orgA.slug}/team`;
const settingsB = `/o/${S.orgB.slug}/settings`;
const settingsA = `/o/${S.orgA.slug}/settings`;
const alert = (page: Page) => page.getByRole("dialog").getByRole("alert");

async function addPeople(orgId: string, n: number, prefix = "E2E Helper") {
  const db = await admin();
  for (let i = 1; i <= n; i++) {
    const { error } = await db.from("memberships").insert({ org_id: orgId, user_id: null, role: "member", display_name: `${prefix} ${i}` });
    if (error) throw new Error(`add person ${i}: ${error.message}`);
  }
}
async function memberCount(orgId: string) {
  return (await (await admin()).from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgId)).count ?? 0;
}
async function addLocation(orgId: string, name: string, active = true) {
  const { error } = await (await admin()).from("locations").insert({ org_id: orgId, name, active });
  if (error) throw new Error(`add location: ${error.message}`);
}
async function openAddMember(page: Page, name: string, o: { invite?: string } = {}) {
  await page.getByRole("button", { name: "Add team member" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill(name);
  if (o.invite) {
    await dlg.getByRole("switch", { name: "Invite them to sign in" }).click();
    await dlg.getByLabel("Email").fill(o.invite);
  }
  return dlg;
}

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await removeExtras(A()); await removeExtras(B()); });
test.afterAll(async () => { await stripeMock.reset(); await restoreSeedPlans(); });

test.describe("team: the 6th person", () => {
  for (const width of WIDTHS) {
    test(`on a trial the owner gets the prompt with a 'Choose a plan' link carrying the add-on, at ${width}px`, async ({ pageAs }) => {
      await setPlan(B(), "trial", { days: 10 });
      await addPeople(B(), 4); // owner + 4 = 5 of 5
      const page = await pageAs("ownerB");
      const w = watchErrors(page);
      await openAt(page, width, teamB);
      await expect(page.getByText("5 members")).toBeVisible();
      const dlg = await openAddMember(page, "E2E Sixth");
      await dlg.getByRole("button", { name: "Add team member" }).click();
      await expect(alert(page)).toContainText("Your plan includes 5 staff. Add 5 more for $5/month.");
      await expect(alert(page).getByRole("button")).toHaveCount(0); // a trial has nothing to change in place
      const choose = alert(page).getByRole("link", { name: "Choose a plan" });
      await expect(choose).toHaveAttribute("href", `/o/${S.orgB.slug}/settings/billing?locations=0&packs=1`);
      expect(await memberCount(B())).toBe(5);
      await noHorizontalScroll(page);
      await choose.click();
      await page.waitForURL(/settings\/billing\?locations=0&packs=1/);
      await expect(page.getByLabel("Staff packs (5 staff each)")).toHaveValue("1");
      await expect(page.getByRole("button", { name: /^Subscribe for \$20\/month/ })).toBeEnabled();
      w.assertNone();
    });
  }

  test("owner on a paid plan: 'Add and continue (+$5/month)' buys one staff pack and finishes adding the person", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    await addPeople(B(), 4);
    const page = await pageAs("ownerB");
    await openAt(page, 1280, teamB);
    const dlg = await openAddMember(page, "E2E Sixth");
    await dlg.getByRole("button", { name: "Add team member" }).click();
    await expect(alert(page)).toContainText("Your plan includes 5 staff. Add 5 more for $5/month.");
    const add = alert(page).getByRole("button", { name: "Add and continue (+$5/month)" });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByText("Team member added")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("6 members")).toBeVisible();
    await expect(page.getByText("E2E Sixth")).toBeVisible();
    const row = await subRow(B());
    expect(row.staff_packs).toBe(1);
    const [upd] = (await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST");
    expect(upd.body.proration_behavior).toBe("always_invoice");
    expect(await memberCount(B())).toBe(6);
    // the next person fits without any prompt
    const dlg2 = await openAddMember(page, "E2E Seventh");
    await dlg2.getByRole("button", { name: "Add team member" }).click();
    await expect(page.getByText("7 members")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0); // closed, no prompt
  });

  test("admin: told to ask the owner, no price and no buy button (D-006); the same for an invitation", async ({ pageAs }) => {
    await setPlan(A(), "active", { extraLocations: 1, staffPacks: 0 }); // 2 locations, 10 staff
    await addPeople(A(), 6); // 4 + 6 = 10 of 10
    const page = await pageAs("adminA");
    await openAt(page, 375, teamA);
    const dlg = await openAddMember(page, "E2E Eleventh");
    await dlg.getByRole("button", { name: "Add team member" }).click();
    await expect(alert(page)).toContainText("Your plan includes 10 staff. Ask the account owner to add more on the Billing page.");
    await expect(alert(page)).not.toContainText("$");
    await expect(alert(page)).not.toContainText("Add 5 more");
    await expect(alert(page).getByRole("button")).toHaveCount(0);
    await expect(alert(page).getByRole("link")).toHaveCount(0);
    expect(await memberCount(A())).toBe(10);
    await noHorizontalScroll(page);
    // the invitation path says the same
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const dlg2 = await openAddMember(page, "E2E Twelfth", { invite: "e2e.twelfth@tempo-e2e.test" });
    await dlg2.getByRole("button", { name: "Add and send invitation" }).click();
    await expect(alert(page)).toContainText("Ask the account owner to add more on the Billing page.");
    await expect(alert(page)).not.toContainText("$");
    expect(await memberCount(A())).toBe(10);
  });

  test("a crafted add-on request from an admin or staff is refused and buys nothing", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    await addPeople(B(), 4);
    const owner = await pageAs("ownerB");
    await openAt(owner, 1280, teamB);
    const dlg = await openAddMember(owner, "E2E Sixth");
    await dlg.getByRole("button", { name: "Add team member" }).click();
    const cap = await captureAction(owner, () => alert(owner).getByRole("button", { name: /Add and continue/ }).click());
    expect(JSON.parse(cap.body)).toEqual([S.orgB.slug, "staff"]);
    await expect(owner.getByText("Team member added")).toBeVisible();
    // now A: the admin and a member replay it against their own team
    await setPlan(A(), "active", { extraLocations: 1, staffPacks: 0 });
    await addPeople(A(), 6);
    const stripeBefore = (await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST").length;
    for (const who of ["adminA", "staffA1"] as const) {
      const page = await pageAs(who);
      await page.goto(teamA);
      expect(await replayAction(page, cap, [S.orgA.slug, "staff"]), who).toContain("Only the account owner can manage billing.");
      expect(await replayAction(page, cap, [S.orgA.slug, "location"]), who).toContain("Only the account owner can manage billing.");
    }
    // the owner of A cannot be talked into a bogus kind either
    const ownerA = await pageAs("ownerA");
    await ownerA.goto(teamA);
    expect(await replayAction(ownerA, cap, [S.orgA.slug, "everything"])).toContain("Unknown add-on.");
    expect(await replayAction(ownerA, cap, [S.orgA.slug, { __proto__: null }])).toContain("Unknown add-on.");
    expect((await subRow(A())).staff_packs).toBe(0);
    expect((await stripeMock.calls("/v1/subscriptions/")).filter((c) => c.method === "POST").length).toBe(stripeBefore);
  });
});

test.describe("pending invitations hold seats", () => {
  test("5 people and a waiting invitation fill a 5-staff plan: the meter says so and a 6th is refused (D-007)", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    await addPeople(B(), 3); // owner + 3 = 4
    const db = await admin();
    const ins = await db.from("invitations").insert({ org_id: B(), email: "e2e.waiting@tempo-e2e.test", role: "member" });
    expect(ins.error, ins.error?.message).toBeNull();
    const owner = await pageAs("ownerB");
    await openAt(owner, 1280, billingUrl(S.orgB.slug));
    await expect(owner.getByText("5 of 5 · includes 1 invitation waiting")).toBeVisible();
    await expect(owner.getByRole("progressbar", { name: "Team members" })).toHaveAttribute("aria-valuenow", "5");
    await owner.goto(teamB);
    await expect(owner.getByText("4 members")).toBeVisible();
    const dlg = await openAddMember(owner, "E2E Fifth");
    await dlg.getByRole("button", { name: "Add team member" }).click();
    await expect(alert(owner)).toContainText("Your plan includes 5 staff.");
    expect(await memberCount(B())).toBe(4);
    // revoke the invitation: the seat is free again
    await owner.keyboard.press("Escape");
    await expect(owner.getByRole("heading", { name: "Pending invitations" })).toBeVisible();
    await owner.getByRole("button", { name: "Revoke" }).click();
    await expect(owner.getByText("Invitation revoked")).toBeVisible();
    const dlg2 = await openAddMember(owner, "E2E Fifth");
    await dlg2.getByRole("button", { name: "Add team member" }).click();
    await expect(owner.getByText("5 members")).toBeVisible();
  });

  test("the plan chooser will not shrink the plan below people plus waiting invitations", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 1 }); // 10 staff
    await addPeople(B(), 5); // 6 people
    const db = await admin();
    for (const n of [1, 2, 3, 4]) await db.from("invitations").insert({ org_id: B(), email: `e2e.waiting${n}@tempo-e2e.test`, role: "member" });
    const owner = await pageAs("ownerB");
    await openAt(owner, 1280, billingUrl(S.orgB.slug));
    await expect(owner.getByText("10 of 10 · includes 4 invitations waiting")).toBeVisible();
    await owner.getByLabel("Staff packs (5 staff each)").fill("0");
    await expect(owner.getByText("You have 6 team members and 4 invitations waiting but this plan includes 5. Remove 5 team members or cancel invitations first, or keep more staff packs.")).toBeVisible();
    await expect(owner.getByRole("button", { name: "Update plan" })).toBeDisabled();
  });
});

test.describe("locations: the 2nd location on a 1-location plan", () => {
  for (const width of WIDTHS) {
    test(`on a trial the owner gets the prompt with a plan link (+$15, includes +5 staff) at ${width}px`, async ({ pageAs }) => {
      await setPlan(B(), "trial", { days: 10 });
      await addLocation(B(), "E2E Loc One");
      const page = await pageAs("ownerB");
      const w = watchErrors(page);
      await openAt(page, width, settingsB);
      await page.getByRole("button", { name: "Add" }).first().click();
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Name").fill("E2E Loc Two");
      await dlg.getByRole("button", { name: "Save" }).click();
      await expect(alert(page)).toContainText("Your plan includes 1 location. Add 1 more for $15/month (it includes 5 more staff).");
      await expect(alert(page).getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", `/o/${S.orgB.slug}/settings/billing?locations=1&packs=0`);
      await noHorizontalScroll(page);
      await alert(page).getByRole("link", { name: "Choose a plan" }).click();
      await page.waitForURL(/settings\/billing\?locations=1&packs=0/);
      await expect(page.getByLabel("Extra locations")).toHaveValue("1");
      await expect(page.getByRole("button", { name: "Subscribe for $30/month" })).toBeEnabled();
      w.assertNone();
    });
  }

  test("owner on a paid plan: 'Add and continue (+$15/month)' adds the location and saves it", async ({ pageAs }) => {
    await setPlan(B(), "active", { extraLocations: 0, staffPacks: 0 });
    await addLocation(B(), "E2E Loc One");
    const page = await pageAs("ownerB");
    await openAt(page, 1280, settingsB);
    await page.getByRole("button", { name: "Add" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill("E2E Loc Two");
    await dlg.getByRole("button", { name: "Save" }).click();
    await alert(page).getByRole("button", { name: "Add and continue (+$15/month)" }).click();
    await expect(page.getByText("Location added")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /E2E Loc Two/ })).toBeVisible();
    const row = await subRow(B());
    expect([row.extra_locations, row.staff_packs]).toEqual([1, 0]);
    const locs = await (await admin()).from("locations").select("name").eq("org_id", B());
    expect(locs.data!.map((l) => l.name).sort()).toEqual(["E2E Loc One", "E2E Loc Two"]);
  });

  test("admin: 'ask the account owner', nothing to buy", async ({ pageAs }) => {
    await setPlan(A(), "active", { extraLocations: 1, staffPacks: 0 }); // 2 locations, both in use
    const page = await pageAs("adminA");
    await openAt(page, 768, settingsA);
    await page.getByRole("button", { name: "Add" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill("E2E Third");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(alert(page)).toContainText("Your plan includes 2 locations. Ask the account owner to add more on the Billing page.");
    await expect(alert(page)).not.toContainText("$");
    await expect(alert(page).getByRole("button")).toHaveCount(0);
    await expect(alert(page).getByRole("link")).toHaveCount(0);
    const n = (await (await admin()).from("locations").select("id", { count: "exact", head: true }).eq("org_id", A())).count;
    expect(n).toBe(2);
  });

  test("hidden locations do not count: they can be added at the limit, show as Hidden, and can't be switched back on beyond it", async ({ pageAs }) => {
    await setPlan(B(), "trial", { days: 10 });
    await addLocation(B(), "E2E Loc One");
    await addLocation(B(), "E2E Loc Hidden", false);
    const page = await pageAs("ownerB");
    await openAt(page, 1280, billingUrl(S.orgB.slug));
    await expect(page.getByText("1 of 1").first()).toBeVisible(); // 1 active of 1: the hidden one is not counted
    await page.goto(settingsB);
    await expect(page.getByRole("button", { name: /E2E Loc Hidden/ }).getByText("Hidden")).toBeVisible();
    // a new hidden location is fine at the limit
    await page.getByRole("button", { name: "Add" }).first().click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Name").fill("E2E Loc Hidden Two");
    await dlg.getByRole("switch").last().click(); // Bookable online off
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Location added")).toBeVisible();
    // switching a hidden one back on is the same as adding a 2nd active location
    await page.getByRole("button", { name: /E2E Loc Hidden Two/ }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByRole("switch").last().click();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(alert(page)).toContainText("Your plan includes 1 location.");
  });
});

test.describe("limits when the plan is off", () => {
  test("with no plan nothing can be added: a plain message, no price, no upgrade button", async ({ pageAs }) => {
    await setPlan(B(), "trial-ended");
    const owner = await pageAs("ownerB");
    await openAt(owner, 1280, teamB);
    const dlg = await openAddMember(owner, "E2E Nobody");
    await dlg.getByRole("button", { name: "Add team member" }).click();
    await expect(owner.getByRole("dialog")).toContainText("Your subscription isn't active");
    await expect(owner.getByRole("dialog").getByRole("button", { name: /Add and continue/ })).toHaveCount(0);
    expect(await memberCount(B())).toBe(1);
    await setPlan(A(), "trial-ended");
    const admin = await pageAs("adminA");
    await openAt(admin, 1280, teamA);
    const dlg2 = await openAddMember(admin, "E2E Nobody");
    await dlg2.getByRole("button", { name: "Add team member" }).click();
    await expect(admin.getByRole("dialog")).toContainText("Ask the account owner to subscribe");
    expect(await bodyText(admin)).not.toMatch(/\$\d/);
  });
});
