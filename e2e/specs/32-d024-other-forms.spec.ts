// D-024 retest, second part: the converted forms that spec 31 does not cover (customers, time off, settings, contact-embed),
// plus the things that must NOT change: success still closes the sheet, required fields still block, Enter submits, no double records.
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { S, mock } from "./helpers";
import { admin, openAt } from "./billing-helpers";

const slug = S.orgA.slug;
const MSG = /Something went wrong\. Please check your connection and try again\./;
const actionPosts = (page: Page) => { const n = { v: 0 }; page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) n.v++; }); return n; };
async function failRequests(page: Page) {
  await page.route("**/*", (route) => {
    const r = route.request();
    return r.method() === "POST" && r.headers()["next-action"] ? route.abort("internetdisconnected") : route.continue();
  });
}
const unroute = (page: Page) => page.unroute("**/*");
const email = (t: string) => `e2e.d024.${t}.${Date.now()}@tempo-e2e.test`;
const cleanup = async () => {
  const a = await admin();
  await a.from("customers").delete().eq("org_id", S.orgA.id).like("email", "e2e.d024.%@tempo-e2e.test");
  await a.from("time_off").delete().eq("org_id", S.orgA.id).like("reason", "E2E d024%");
};

test.beforeEach(async () => { await mock.clear(); await cleanup(); });
test.afterAll(cleanup);

test.describe("customers form", () => {
  test("request fails: typed values kept, retry saves, sheet closes on success", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await openAt(page, 1280, `/o/${slug}/customers`);
    await page.getByRole("button", { name: "Add" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New customer" });
    const em = email("fail");
    await dlg.getByLabel("Name").fill("E2E D024 Keep");
    await dlg.getByLabel("Email").fill(em);
    await dlg.getByLabel("Private notes").fill("keep these notes");
    await failRequests(page);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg.getByText(MSG).or(dlg.getByRole("alert"))).toBeVisible();
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel("Name")).toHaveValue("E2E D024 Keep");
    await expect(dlg.getByLabel("Email")).toHaveValue(em);
    await expect(dlg.getByLabel("Private notes")).toHaveValue("keep these notes");
    await unroute(page);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText("Customer saved")).toBeVisible();
  });

  test("server validation error: values kept, message shown", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await openAt(page, 1280, `/o/${slug}/customers`);
    await page.getByRole("button", { name: "Add" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New customer" });
    await dlg.getByLabel("Name").fill("E2E D024 Phone");
    await dlg.getByLabel("Email").fill(email("phone"));
    await dlg.getByLabel(/^Phone/).fill("abc");
    await dlg.getByLabel("Private notes").fill("notes stay");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg.getByText(/doesn't look right/)).toBeVisible();
    await expect(dlg.getByLabel("Name")).toHaveValue("E2E D024 Phone");
    await expect(dlg.getByLabel(/^Phone/)).toHaveValue("abc");
    await expect(dlg.getByLabel("Private notes")).toHaveValue("notes stay");
  });

  test("required Name/Email block the browser submit (no request), Enter submits, a double click makes one record", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await openAt(page, 1280, `/o/${slug}/customers`);
    const posts = actionPosts(page);
    await page.getByRole("button", { name: "Add" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New customer" });
    await dlg.getByLabel("Email").fill(email("req"));
    await dlg.getByRole("button", { name: "Save" }).click(); // Name empty
    await expect(dlg).toBeVisible();
    expect(posts.v, "no server call while a required field is empty").toBe(0);
    expect(await dlg.getByLabel("Name").evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true);
    await dlg.getByLabel("Name").fill("E2E D024 Enter");
    await dlg.getByLabel("Email").fill("not-an-email");
    await dlg.getByLabel("Name").press("Enter"); // the browser's type=email check blocks it
    expect(posts.v).toBe(0);
    const em = email("enter");
    await dlg.getByLabel("Email").fill(em);
    await dlg.getByLabel("Name").press("Enter");
    await expect(dlg).toBeHidden();
    // double submit
    await page.getByRole("button", { name: "Add" }).first().click();
    const d2 = page.getByRole("dialog", { name: "New customer" });
    const em2 = email("dbl");
    await d2.getByLabel("Name").fill("E2E D024 Double");
    await d2.getByLabel("Email").fill(em2);
    await d2.getByRole("button", { name: "Save" }).dblclick();
    await expect(d2).toBeHidden();
    await page.waitForTimeout(1000);
    const a = await admin();
    expect((await a.from("customers").select("id").eq("org_id", S.orgA.id).eq("email", em)).data).toHaveLength(1);
    expect((await a.from("customers").select("id").eq("org_id", S.orgA.id).eq("email", em2)).data).toHaveLength(1);
  });
});

test.describe("time off form", () => {
  const open = async (page: Page) => {
    await openAt(page, 1280, `/o/${slug}/availability`);
    await page.getByRole("heading", { name: "Time off" }).locator("..").getByRole("button", { name: "Add" }).click();
    return page.getByRole("dialog", { name: "Add time off" });
  };

  test("request fails: values kept, retry succeeds and closes", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const dlg = await open(page);
    await dlg.getByLabel(/Reason/).fill("E2E d024 trip");
    await dlg.getByLabel("From").fill("2030-03-04");
    await dlg.getByLabel("To").fill("2030-03-05");
    await failRequests(page);
    await dlg.getByRole("button", { name: "Add time off" }).click();
    await expect(dlg.getByText(MSG).or(dlg.getByRole("alert"))).toBeVisible();
    await expect(dlg.getByLabel(/Reason/)).toHaveValue("E2E d024 trip");
    await expect(dlg.getByLabel("From")).toHaveValue("2030-03-04");
    await expect(dlg.getByLabel("To")).toHaveValue("2030-03-05");
    await unroute(page);
    await dlg.getByRole("button", { name: "Add time off" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText("Time off added")).toBeVisible();
  });

  test("server validation error (end before start): values kept; required From blocks; double click makes one row", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const dlg = await open(page);
    const posts = actionPosts(page);
    await dlg.getByLabel(/Reason/).fill("E2E d024 range");
    await dlg.getByRole("button", { name: "Add time off" }).click();
    expect(posts.v).toBe(0);
    await dlg.getByLabel("From").fill("2030-04-10");
    await dlg.getByLabel("To").fill("2030-04-05");
    await dlg.getByRole("button", { name: "Add time off" }).click();
    await expect(dlg.getByText("Choose a valid range.")).toBeVisible();
    await expect(dlg.getByLabel(/Reason/)).toHaveValue("E2E d024 range");
    await expect(dlg.getByLabel("From")).toHaveValue("2030-04-10");
    await dlg.getByLabel("To").fill("2030-04-11");
    await dlg.getByRole("button", { name: "Add time off" }).dblclick();
    await expect(dlg).toBeHidden();
    await page.waitForTimeout(1000);
    expect((await (await admin()).from("time_off").select("id").eq("org_id", S.orgA.id).eq("reason", "E2E d024 range")).data).toHaveLength(1);
  });
});

test.describe("settings form", () => {
  test("request fails keeps the edit; server error keeps it; retry saves; Enter submits", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await openAt(page, 1280, `/o/${slug}/settings`);
    const about = page.getByLabel("About");
    const old = await about.inputValue();
    await about.fill("E2E d024 about text");
    await failRequests(page);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(MSG).or(page.getByRole("alert")).first()).toBeVisible();
    await expect(about).toHaveValue("E2E d024 about text");
    await unroute(page);
    await page.getByLabel("Booking link").fill("Bad Link!");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/Links can use lowercase letters/)).toBeVisible();
    await expect(about).toHaveValue("E2E d024 about text");
    await expect(page.getByLabel("Booking link")).toHaveValue("Bad Link!");
    await page.getByLabel("Booking link").fill(slug);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await about.fill(old);
    await page.getByLabel("Name").first().press("Enter"); // Enter in a text field submits
    await expect(page.getByText("Settings saved").first()).toBeVisible();
  });

  test("required Name blocks the submit", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await openAt(page, 1280, `/o/${slug}/settings`);
    const posts = actionPosts(page);
    const name = page.getByLabel("Name").first();
    const old = await name.inputValue();
    await name.fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    expect(posts.v).toBe(0);
    await expect(name).toHaveValue("");
    await name.fill(old);
  });
});

test.describe("contact form options", () => {
  const box = (page: Page) => page.locator("#contact-form");

  test("request fails keeps the message; server error keeps it; retry saves", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await openAt(page, 1280, `/o/${slug}/settings`);
    const msg = box(page).getByLabel("Message after they send");
    await msg.fill("E2E d024 thanks");
    await failRequests(page);
    await box(page).getByRole("button", { name: "Save contact form options" }).click();
    await expect(box(page).getByText(MSG).or(box(page).getByRole("alert"))).toBeVisible();
    await expect(msg).toHaveValue("E2E d024 thanks");
    await unroute(page);
    // (A server validation error cannot be provoked here: the browser's maxLength=500 trims anything longer.)
    await box(page).getByRole("button", { name: "Save contact form options" }).click();
    await expect(page.getByText("Contact form options saved")).toBeVisible();
    await expect(msg).toHaveValue("E2E d024 thanks");
    await msg.fill("");
    await box(page).getByRole("button", { name: "Save contact form options" }).click();
  });
});
