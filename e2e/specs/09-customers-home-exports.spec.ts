import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { test, expect } from "./fixtures";
import { customerEmail, dayAhead, mock, rpcBook, S, watchErrors } from "./helpers";

const base = `/o/${S.orgA.slug}`;
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const customerRow = async (email: string) => (await admin().from("customers").select("name, phone, notes, sms_consent_at").eq("org_id", S.orgA.id).eq("email", email).maybeSingle()).data;

test.beforeEach(async () => { await mock.clear(); });

test.describe("customers", () => {
  test("add, edit, search, and delete a customer", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const email = customerEmail("crm");
    await page.goto(`${base}/customers`);
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Crm Carla");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Phone").fill("(416) 555-0123");
    await page.getByLabel("Private notes").fill("Allergic to <b>ammonia</b>");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Customer saved")).toBeVisible();
    await expect(page.getByText("Crm Carla")).toBeVisible();
    const row = await customerRow(email);
    expect(row).toMatchObject({ name: "Crm Carla", notes: "Allergic to <b>ammonia</b>" });
    expect(row!.phone).toMatch(/416/);
    // search by name, email and phone
    const search = page.getByPlaceholder("Search by name, email or phone");
    await search.fill("carla");
    await expect(page.getByText("Crm Carla")).toBeVisible();
    await search.fill("zzzzzz");
    await expect(page.getByText("Crm Carla")).toHaveCount(0);
    await search.fill("");
    // edit
    await page.getByText("Crm Carla").click();
    await page.getByLabel("Name", { exact: true }).fill("Crm Carla Jones");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Crm Carla Jones")).toBeVisible();
    // the same email can't be added twice
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Dup");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/already|exists/i)).toBeVisible();
    await page.keyboard.press("Escape");
    // delete (asks first)
    await page.getByText("Crm Carla Jones").click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: /Tap again to delete/ }).last().click();
    await expect(page.getByText("Customer deleted")).toBeVisible();
    expect(await customerRow(email)).toBeNull();
    w.assertNone();
  });

  test("a customer with an upcoming booking can't be deleted, and the message says why", async ({ pageAs }) => {
    const email = customerEmail("keep");
    await rpcBook({ day: dayAhead(31), time: "10:00", email, name: "Keep Kim" });
    const page = await pageAs("ownerA");
    await page.goto(`${base}/customers`);
    await page.getByText("Keep Kim").click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: /Tap again to delete/ }).last().click();
    await expect(page.getByText(/upcoming booking/i)).toBeVisible();
    expect(await customerRow(email)).not.toBeNull();
  });

  test("odd names and phone numbers are accepted or refused politely, never a crash", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/customers`);
    for (const [name, phone] of [["Zoë 李雷 O'Brien-Smith", "+44 20 7946 0958"], ["A".repeat(300), "123"], ["<img src=x onerror=alert(1)>", "not a number"]]) {
      await page.getByRole("button", { name: "Add" }).click();
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByLabel("Email").fill(customerEmail("odd"));
      await page.getByLabel("Phone").fill(phone);
      await page.getByRole("button", { name: "Save" }).click();
      await page.waitForTimeout(800);
      await expect(page.locator("body")).not.toContainText(/Application error|Something went wrong/);
      await page.reload();
    }
    // nothing ran as script
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.reload();
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);
  });

  test("customers only: staff can't see the customer list's export", async ({ pageAs }) => {
    const staff = await pageAs("staffA1");
    expect((await staff.request.get(`/api/export/customers?org=${S.orgA.slug}`)).status()).toBe(403);
  });
});

test.describe("home dashboard and Excel exports", () => {
  test("Home loads for each range with no errors, and the export is a real workbook", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const label of ["Last 7 days", "Last 90 days", "Last 30 days"]) {
      await page.getByRole("link", { name: label }).click();
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
    const res = await page.request.get(`/api/export/home?org=${S.orgA.slug}&range=30`);
    expect(res.status()).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as never);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Summary", "Daily", "Services", "Team", "Busiest times", "Best customers", "Bookings"]);
    expect(res.headers()["content-disposition"]).toMatch(/tempo-e2e-salon-home-.*\.xlsx/);
    // bad range falls back to the default instead of failing
    expect((await page.request.get(`/api/export/home?org=${S.orgA.slug}&range=banana`)).status()).toBe(200);
    // customers export has every customer
    const cust = await page.request.get(`/api/export/customers?org=${S.orgA.slug}`);
    expect(cust.status()).toBe(200);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await cust.body()) as never);
    expect(wb2.getWorksheet("Customers")!.rowCount).toBeGreaterThan(2);
    w.assertNone();
  });

  test("staff Home hides money and customers; other teams and signed-out callers can't export", async ({ pageAs, request }) => {
    const staff = await pageAs("staffA1");
    await staff.goto(`${base}/dashboard`);
    await expect(staff.locator("body")).not.toContainText("Revenue");
    const res = await staff.request.get(`/api/export/home?org=${S.orgA.slug}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as never);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Summary", "Daily", "Services", "Busiest times", "Bookings"]);
    const anon = await request.get(`/api/export/home?org=${S.orgA.slug}`, { maxRedirects: 0 });
    expect([302, 307, 401, 403, 404]).toContain(anon.status());
  });
});
