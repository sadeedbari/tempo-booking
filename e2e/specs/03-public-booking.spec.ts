import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { customerEmail, fillDetails, mock, pickDay, pickTime, S, watchErrors } from "./helpers";

const slug = S.orgA.slug;
test.beforeEach(async () => { await mock.clear(); });

test.describe("booking page, start to finish", () => {
  test("a visitor books a haircut with a chosen person and gets a confirmation and email", async ({ page }) => {
    const w = watchErrors(page);
    await page.goto(`/${slug}`);
    await expect(page.getByRole("heading", { name: "E2E Salon" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose a location" })).toBeVisible();
    await page.getByRole("button", { name: /Queen West/ }).click();
    await expect(page.getByRole("heading", { name: "Choose a service" })).toBeVisible();
    await expect(page.getByText("Hidden service")).toHaveCount(0);
    await page.getByRole("button", { name: /^Haircut/ }).click();
    await expect(page.getByRole("heading", { name: "Who would you like?" })).toBeVisible();
    await page.getByRole("button", { name: /Sara Stylist/ }).click();
    const day = await pickDay(page, 2);
    await pickTime(page, "10:00 AM");
    const email = customerEmail("flow");
    await fillDetails(page, { name: "Flow Customer", email, phone: "(416) 555-0177", notes: "First visit" });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
    await expect(page.getByText("Haircut").first()).toBeVisible();
    await expect(page.getByText(/Sara Stylist/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /cancel/i }).or(page.getByRole("link", { name: /cancel/i })).first()).toBeVisible();
    // the confirmation email went to the customer, and the text only because they agreed
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const sent = await mock.sent();
    const mail = sent.emails.find((e) => ([] as string[]).concat(e.to).includes(email));
    expect(mail.subject).toBe("Confirmed: Haircut with E2E Salon");
    expect(mail.html).toContain("Flow");
    expect(sent.sms.length).toBe(1);
    expect(sent.sms[0].To).toBe("+14165550177");
    expect(sent.sms[0].Body).toMatch(/Reply STOP to opt out\.$/);
    expect(day).toMatch(/^20\d\d-\d\d-\d\d$/);
    w.assertNone();
  });

  test("unchecking the text box means no text is sent", async ({ page }) => {
    await page.goto(`/${slug}?service=haircut`);
    await page.getByRole("button", { name: /Queen West/ }).click();
    await page.getByRole("button", { name: /Olivia Owner/ }).click();
    await pickDay(page, 3);
    await pickTime(page, "11:00 AM");
    await expect(page.getByRole("checkbox", { name: /Text me about this booking/ })).not.toBeChecked(); // shown from the start, never pre-ticked
    await fillDetails(page, { email: customerEmail("nosms"), phone: "416 555 0188", consent: false });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/booking\//);
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect((await mock.sent()).sms.length).toBe(0);
  });

  test("a service link skips the list; any available needs no person choice", async ({ page }) => {
    await page.goto(`/${slug}?service=consult`);
    await page.getByRole("button", { name: /Queen West/ }).click();
    await expect(page.getByRole("heading", { name: "Who would you like?" })).toBeVisible();
    await page.getByRole("button", { name: /Any available/ }).click();
    await pickDay(page, 4);
    await pickTime(page, "9:00 AM");
    await fillDetails(page, { email: customerEmail("any") });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/booking\//);
    await expect(page.getByText(/Video/i).first()).toBeVisible();
  });

  test("details are checked, the form keeps what was typed, and the back button works", async ({ page }) => {
    await page.goto(`/${slug}?service=haircut`);
    await page.getByRole("button", { name: /Queen West/ }).click();
    await page.getByRole("button", { name: /Sara Stylist/ }).click();
    await pickDay(page, 5);
    await pickTime(page, "1:00 PM");
    await page.getByLabel("Full name").fill("Half Done");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}`)); // browser validation stops it
    await expect(page.getByLabel("Full name")).toHaveValue("Half Done");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Pick a time" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Who would you like?" })).toBeVisible();
  });

  test("a request-only service says so, and a home visit insists on an address", async ({ page }) => {
    await page.goto(`/${slug}?service=home-visit`);
    await page.getByRole("button", { name: /Leslieville/ }).click();
    await pickDay(page, 6);
    await pickTime(page, "9:00 AM");
    await expect(page.getByRole("button", { name: "Request booking" })).toBeVisible();
    await expect(page.getByText(/confirms each booking personally/)).toBeVisible();
    await fillDetails(page, { email: customerEmail("home") });
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}`)); // address is required
    await page.getByLabel(/^Address/).fill("77 Bay Street, Toronto");
    await page.getByRole("option").first().click(); // a real Google suggestion; the address must be picked from the list
    await expect(page.getByText("Address confirmed.")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel(/Unit/).fill("Apt 4B");
    await page.getByRole("button", { name: "Request booking" }).click();
    await page.waitForURL(/\/booking\//);
    await expect(page.getByText(/request|awaiting|pending/i).first()).toBeVisible();
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect((await mock.sent()).emails[0].subject).toMatch(/^Request received: Home visit/);
  });

  test("someone else grabbing the slot first gives a friendly message and lets you pick another", async ({ page }) => {
    await page.goto(`/${slug}?service=colour`);
    await page.getByRole("button", { name: /Queen West/ }).click();
    const day = await pickDay(page, 7);
    await pickTime(page, "9:00 AM");
    // meanwhile another customer takes it (9:00 in Toronto is 13:00 UTC during daylight time, 14:00 otherwise)
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { TZDate } = await import("@date-fns/tz");
    const [y, m, d] = day.split("-").map(Number);
    const nine = new TZDate(y, m - 1, d, 9, 0, 0, "America/Toronto").toISOString();
    const taken = await sb.rpc("create_public_booking", { p_org: S.orgA.id, p_service: S.orgA.services.colour, p_member: S.orgA.members.sara, p_starts_at: nine, p_name: "Quick Fingers", p_email: customerEmail("quick"), p_phone: "", p_notes: "", p_location: S.orgA.locations.qw, p_address: "" });
    expect(taken.error).toBeNull();
    await fillDetails(page, { email: customerEmail("late") });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByText(/just taken|pick another/i)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${slug}`));
  });

  test("the embedded version of the page works and can be framed by other sites", async ({ page, request }) => {
    const res = await request.get(`/embed/${slug}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-security-policy"] ?? "").toContain("frame-ancestors *");
    const normal = await request.get(`/o/${slug}/dashboard`, { maxRedirects: 0 });
    expect(normal.headers()["content-security-policy"] ?? "").toContain("frame-ancestors 'self'");
    await page.goto(`/embed/${slug}`);
    await expect(page.getByRole("button", { name: /Queen West/ })).toBeVisible();
  });
});
