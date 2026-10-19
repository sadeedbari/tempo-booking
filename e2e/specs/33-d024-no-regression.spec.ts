// D-024 retest, third part: things that must not change for the three forms spec 31 covers (new service, Add team member,
// location editor): success still closes the sheet and shows once, required fields still block, Enter submits, a double
// click makes one record.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { S, mock } from "./helpers";
import { B, admin, openAt, removeExtras, restoreSeedPlans, setPlan, stripeMock } from "./billing-helpers";

const slug = S.orgB.slug;
const posts = (page: Page) => { const n = { v: 0 }; page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) n.v++; }); return n; };
const cleanup = async () => { await removeExtras(B()); await (await admin()).from("services").delete().eq("org_id", B()).like("name", "E2E D024%"); };

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await cleanup(); });
test.afterAll(async () => { await cleanup(); await restoreSeedPlans(); });

test("new service: success closes and resets; required Name blocks; Enter submits; double click makes one service", async ({ pageAs }) => {
  const page = await pageAs("ownerB");
  await openAt(page, 1280, `/o/${slug}/services`);
  const n = posts(page);
  await page.getByRole("button", { name: "New service" }).click();
  let dlg = page.getByRole("dialog", { name: "New service" });
  await dlg.getByRole("button", { name: "Save" }).click(); // Name empty
  await expect(dlg).toBeVisible();
  expect(n.v, "no request while Name is empty").toBe(0);
  await dlg.getByLabel("Name").fill("E2E D024 Enter");
  await dlg.getByLabel("Name").press("Enter");
  await expect(dlg).toBeHidden();
  await expect(page.getByText("Service created")).toBeVisible();
  // the next time the sheet opens it is empty again
  await page.getByRole("button", { name: "New service" }).click();
  dlg = page.getByRole("dialog", { name: "New service" });
  await expect(dlg.getByLabel("Name")).toHaveValue("");
  await dlg.getByLabel("Name").fill("E2E D024 Double");
  await dlg.getByRole("button", { name: "Save" }).dblclick();
  await expect(dlg).toBeHidden();
  await page.waitForTimeout(1000);
  const a = await admin();
  expect((await a.from("services").select("id").eq("org_id", B()).eq("name", "E2E D024 Enter")).data).toHaveLength(1);
  expect((await a.from("services").select("id").eq("org_id", B()).eq("name", "E2E D024 Double")).data).toHaveLength(1);
});

test("Add team member: success closes; required Name blocks; double click adds one person", async ({ pageAs }) => {
  await setPlan(B(), "active", { extraLocations: 2, staffPacks: 1 });
  const page = await pageAs("ownerB");
  await openAt(page, 1280, `/o/${slug}/team`);
  const n = posts(page);
  await page.getByRole("button", { name: "Add team member" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Add team member" }).click(); // Name empty
  await expect(dlg).toBeVisible();
  expect(n.v).toBe(0);
  await dlg.getByLabel("Name").fill("E2E D024 Person");
  await dlg.getByRole("button", { name: "Add team member" }).dblclick();
  await expect(dlg).toBeHidden();
  await page.waitForTimeout(1000);
  const rows = (await (await admin()).from("memberships").select("id").eq("org_id", B()).eq("display_name", "E2E D024 Person")).data;
  expect(rows).toHaveLength(1);
});

test("location editor: success closes; double click adds one location; Enter submits", async ({ pageAs }) => {
  await setPlan(B(), "active", { extraLocations: 2, staffPacks: 0 });
  const page = await pageAs("ownerB");
  await openAt(page, 1280, `/o/${slug}/settings`);
  const n = posts(page);
  await page.getByRole("button", { name: "Add" }).first().click();
  let dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: /Save|Add/ }).last().click(); // Name empty
  await expect(dlg).toBeVisible();
  expect(n.v).toBe(0);
  await dlg.getByLabel("Name").fill("E2E D024 Loc One");
  await dlg.getByLabel("Name").press("Enter");
  await expect(dlg).toBeHidden();
  await page.getByRole("button", { name: "Add" }).first().click();
  dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Name")).toHaveValue("");
  await dlg.getByLabel("Name").fill("E2E D024 Loc Two");
  await dlg.getByRole("button", { name: /Save|Add/ }).last().dblclick();
  await expect(dlg).toBeHidden();
  await page.waitForTimeout(1000);
  const a = await admin();
  expect((await a.from("locations").select("id").eq("org_id", B()).eq("name", "E2E D024 Loc One")).data).toHaveLength(1);
  expect((await a.from("locations").select("id").eq("org_id", B()).eq("name", "E2E D024 Loc Two")).data).toHaveLength(1);
});
