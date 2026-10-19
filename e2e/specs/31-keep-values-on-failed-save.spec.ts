// D-024: what the person typed must survive a failed Save, both when the request itself fails and when the server answers
// with a validation message. Covers the new-service form, the Add team member sheet and the location editor.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { S, mock } from "./helpers";
import { B, openAt, removeExtras, restoreSeedPlans, setPlan, stripeMock } from "./billing-helpers";

const slug = S.orgB.slug;
const MSG = /Something went wrong\. Please check your connection and try again\./;
const TOO_LONG = "E2E keep values ".padEnd(90, "x"); // over the 80-character limit: the server rejects it

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); await removeExtras(B()); });
test.afterAll(async () => { await stripeMock.reset(); await restoreSeedPlans(); });

async function failRequests(page: Page) {
  await page.route("**/*", (route) => {
    const r = route.request();
    return r.method() === "POST" && r.headers()["next-action"] ? route.abort("internetdisconnected") : route.continue();
  });
}

for (const mode of ["request fails", "server validation error"] as const) {
  test.describe(mode, () => {
    const name = mode === "request fails" ? "E2E Keep Me" : TOO_LONG;

    test("new service: name and description are kept", async ({ pageAs }) => {
      const page = await pageAs("ownerB");
      await openAt(page, 1280, `/o/${slug}/services`);
      await page.getByRole("button", { name: "New service" }).click();
      const dlg = page.getByRole("dialog", { name: "New service" });
      await dlg.getByLabel("Name").fill(name);
      await dlg.getByLabel("Description").fill("Keep this description");
      if (mode === "request fails") await failRequests(page);
      await dlg.getByRole("button", { name: "Save" }).click();
      // The service sheet's error box is a plain div (no role=alert, see D-025), so match its text as well.
      await expect(dlg.getByRole("alert").or(dlg.getByText(MSG)).or(dlg.getByText(/expected string to have <=80 characters/))).toBeVisible();
      await expect(dlg).toBeVisible();
      await expect(dlg.getByLabel("Name")).toHaveValue(name);
      await expect(dlg.getByLabel("Description")).toHaveValue("Keep this description");
      await expect(dlg.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    test("Add team member: name, title and email are kept", async ({ pageAs }) => {
      await setPlan(B(), "active", { extraLocations: 2, staffPacks: 1 });
      const page = await pageAs("ownerB");
      await openAt(page, 1280, `/o/${slug}/team`);
      await page.getByRole("button", { name: "Add team member" }).first().click();
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Name").fill(name);
      await dlg.getByLabel("Title").fill("Keep title");
      await dlg.getByLabel("Email").fill("keep.me@example.com");
      if (mode === "request fails") await failRequests(page);
      await dlg.getByRole("button", { name: "Add team member" }).click();
      await expect(dlg.getByRole("alert").or(dlg.getByText(MSG))).toBeVisible();
      await expect(dlg).toBeVisible();
      await expect(dlg.getByLabel("Name")).toHaveValue(name);
      await expect(dlg.getByLabel("Title")).toHaveValue("Keep title");
      await expect(dlg.getByLabel("Email")).toHaveValue("keep.me@example.com");
    });

    test("location editor: name, address and phone are kept", async ({ pageAs }) => {
      await setPlan(B(), "active", { extraLocations: 2, staffPacks: 0 });
      const page = await pageAs("ownerB");
      await openAt(page, 1280, `/o/${slug}/settings`);
      await page.getByRole("button", { name: "Add" }).first().click();
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Name").fill(name);
      await dlg.getByLabel("Address").fill("1 Keep St");
      await dlg.getByLabel("Phone").fill("4165550100");
      if (mode === "request fails") await failRequests(page);
      await dlg.getByRole("button", { name: /Save|Add/ }).last().click();
      await expect(dlg.getByRole("alert").or(dlg.getByText(MSG))).toBeVisible();
      await expect(dlg.getByLabel("Name")).toHaveValue(name);
      await expect(dlg.getByLabel("Address")).toHaveValue("1 Keep St");
      await expect(dlg.getByLabel("Phone")).toHaveValue("4165550100");
    });
  });
}
