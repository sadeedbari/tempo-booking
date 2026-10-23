import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, mock, pickDay, pickTime, S } from "./helpers";

/** Twilio's toll-free review: the opt-in is never pre-ticked, names the business, and links to terms that cover texting. */
const slug = S.orgA.slug;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const toOf = (m: any) => (Array.isArray(m.to) ? m.to[0] : m.to) as string;

test.beforeEach(async () => { await mock.clear(); });

async function toDetails(page: import("@playwright/test").Page, nth: number) {
  await page.goto(`/${slug}?service=haircut`);
  await page.getByRole("button", { name: /Queen West/ }).click();
  await page.getByRole("button", { name: /Olivia Owner/ }).click();
  await pickDay(page, nth);
  await pickTime(page, "10:00 AM");
}

test.describe("the opt-in on the booking form", () => {
  test("it is shown from the start, is not ticked, names the business and says everything a customer must know", async ({ page }) => {
    await toDetails(page, 3);
    const box = page.getByTestId("sms-consent");
    await expect(box).toBeVisible(); // visible before anyone types a number
    const checkbox = box.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();
    const text = (await box.innerText()).replace(/\s+/g, " ");
    expect(text).toContain("E2E Salon"); // the business that sends the texts
    for (const phrase of ["confirmations, reminders and changes", "Message frequency varies", "Message and data rates may apply", "Reply STOP to opt out", "HELP for help", "not required to book"]) {
      expect(text.toLowerCase(), phrase).toContain(phrase.toLowerCase());
    }
    await expect(box.getByRole("link", { name: "Text message terms" })).toHaveAttribute("href", "/sms");
    await expect(box.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    for (const l of await box.getByRole("link").all()) await expect(l).toHaveAttribute("target", "_blank");
    // typing a number does not tick it
    await page.getByLabel("Phone").fill("416 555 0123");
    await expect(checkbox).not.toBeChecked();
  });

  test("a phone number without a tick books fine and sends no text; ticking it sends one and records the yes", async ({ page, browser }) => {
    // no tick
    await toDetails(page, 4);
    const quiet = customerEmail("quiet");
    await page.getByLabel("Full name").fill("Quiet Quinn");
    await page.getByLabel("Email").fill(quiet);
    await page.getByLabel("Phone").fill("416 555 0124");
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === quiet).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect((await mock.sent()).sms).toHaveLength(0);
    const { data: c1 } = await sb().from("customers").select("sms_consent_at").eq("org_id", S.orgA.id).eq("email", quiet).single();
    expect(c1!.sms_consent_at).toBeNull();

    // tick
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await toDetails(p2, 5);
    const loud = customerEmail("loud");
    await fillDetails(p2, { name: "Loud Lou", email: loud, phone: "416 555 0125" }); // the helper ticks the box
    await expect(p2.getByRole("checkbox", { name: /Text me about this booking/ })).toBeChecked();
    await p2.getByRole("button", { name: "Confirm booking" }).click();
    await p2.waitForURL(/\/booking\/[a-f0-9]{48}/);
    await expect.poll(async () => (await mock.sent()).sms.length, { timeout: 20_000 }).toBe(1);
    expect((await mock.sent()).sms[0].Body).toMatch(/^E2E Salon: Confirmed - Haircut/);
    expect((await mock.sent()).sms[0].Body).toMatch(/Reply STOP to opt out\.$/);
    const { data: c2 } = await sb().from("customers").select("sms_consent_at").eq("org_id", S.orgA.id).eq("email", loud).single();
    expect(c2!.sms_consent_at).not.toBeNull();
    await ctx.close();
  });
});

test.describe("the text message terms page", () => {
  test("it is public and covers what a toll-free review looks for", async ({ page, request }) => {
    const res = await request.get("/sms", { maxRedirects: 0 });
    expect(res.status(), "reachable without signing in").toBe(200);
    await page.goto("/sms");
    await expect(page.getByRole("heading", { level: 1, name: "Text message terms" })).toBeVisible();
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    for (const phrase of [
      "confirmation", "reminder", "We do not send marketing or promotional text messages",
      "never ticked for you", "not required to book", "Message frequency varies", "Message and data rates may apply",
      "reply STOP", "reply HELP", "info@sulosystems.com", "Sulo Systems",
      "We do not share your mobile number, or the fact that you agreed to receive texts, with third parties or affiliates for marketing or promotional purposes",
      "Mobile carriers are not liable",
    ]) expect(text, phrase).toContain(phrase);
    // it links on to the privacy policy and the general terms, which exist
    await expect(page.getByRole("main").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("main").getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    for (const path of ["/privacy", "/terms"]) expect((await request.get(path)).status()).toBe(200);
  });

});

test.describe("the team's own forms never tick the box for the customer", () => {
  test("new booking (new customer) and the customer editor start unticked", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/calendar`);
    await page.getByRole("button", { name: /^New$/ }).first().click();
    const dlg = page.getByRole("dialog");
    const newTab = dlg.getByRole("tab", { name: "New", exact: true });
    if (await newTab.count()) await newTab.click();
    await expect(dlg.getByRole("checkbox", { name: /agreed to receive text messages/ })).not.toBeChecked();
    await page.keyboard.press("Escape");

    await page.goto(`/o/${slug}/customers`);
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByLabel("Phone").fill("416 555 0126");
    await expect(page.getByRole("checkbox", { name: /agreed to receive text messages/ })).not.toBeChecked();
  });
});
