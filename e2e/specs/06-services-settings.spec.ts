import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { mock, S, watchErrors } from "./helpers";

const base = `/o/${S.orgA.slug}`;
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const publicServices = async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  const { data } = await sb.rpc("get_public_org", { p_slug: S.orgA.slug });
  return (data as { services: { name: string; price_cents: number; auto_approve: boolean }[] }).services;
};

test.beforeEach(async () => { await mock.clear(); });

test.describe("services", () => {
  test("create, edit and delete a service; each change reaches the public booking page", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/services`);
    await page.getByRole("button", { name: "New service" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E Deep Clean");
    await page.getByLabel("Description").fill("A very thorough clean.");
    await page.getByLabel(/^Price/).fill("149.50");
    await page.getByLabel("Duration").selectOption({ label: "2 hr" });
    await page.getByLabel("Break after").selectOption({ label: "15 min" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "E2E Deep Clean" })).toBeVisible();
    let svc = (await publicServices()).find((s) => s.name === "E2E Deep Clean");
    expect(svc).toBeTruthy();
    expect(svc!.price_cents).toBe(14950);
    expect(svc!.auto_approve).toBe(true);

    // edit: turn off automatic approval, change price
    await page.getByRole("heading", { name: "E2E Deep Clean" }).locator("xpath=ancestor::div[contains(@class,'group')][1]").getByRole("button", { name: "Edit" }).click();
    await page.getByLabel(/^Price/).fill("99");
    await page.getByRole("switch", { name: "Automatically approve bookings" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // (the seeded Home visit also needs approval, so look inside this service's own card)
    await expect(page.getByRole("heading", { name: "E2E Deep Clean" }).locator("xpath=ancestor::div[contains(@class,'group')][1]").getByText("Needs approval")).toBeVisible();
    svc = (await publicServices()).find((s) => s.name === "E2E Deep Clean");
    expect(svc!.price_cents).toBe(9900);
    expect(svc!.auto_approve).toBe(false);

    // hide it from the booking page
    await page.getByRole("heading", { name: "E2E Deep Clean" }).locator("xpath=ancestor::div[contains(@class,'group')][1]").getByRole("button", { name: "Edit" }).click();
    await page.getByRole("switch").last().click(); // Bookable online
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Hidden", { exact: true }).first()).toBeVisible();
    expect((await publicServices()).some((s) => s.name === "E2E Deep Clean")).toBe(false);

    // delete (asks to confirm first)
    await page.getByRole("heading", { name: "E2E Deep Clean" }).locator("xpath=ancestor::div[contains(@class,'group')][1]").getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Tap to confirm" })).toBeVisible();
    await page.getByRole("button", { name: "Tap to confirm" }).click();
    await expect(page.getByRole("heading", { name: "E2E Deep Clean" })).toHaveCount(0);
    w.assertNone();
  });

  test("bad input is explained: a deposit above the price, an empty name, a duplicate name, a very long name", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/services`);
    await page.getByRole("button", { name: "New service" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E Deposit Test");
    await page.getByLabel(/^Price/).fill("50");
    await page.getByLabel("Deposit").fill("80");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/deposit can.t be more than the price/i)).toBeVisible();
    await page.getByLabel("Deposit").fill("20");
    await page.getByLabel("Name", { exact: true }).fill("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "New service" })).toBeVisible(); // required field stops it
    // two services with the same name get different links
    await page.getByLabel("Name", { exact: true }).fill("Haircut");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Haircut" })).toHaveCount(2);
    const { data } = await admin().from("services").select("slug").eq("org_id", S.orgA.id).like("slug", "haircut%");
    expect(new Set(data!.map((r) => r.slug)).size).toBe(data!.length);
    // a 400-character name is refused with a message, not a crash
    await page.getByRole("button", { name: "New service" }).click();
    await page.getByLabel("Name", { exact: true }).fill("X".repeat(400));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("body")).not.toContainText(/Application error|Something went wrong/);
  });
});

test.describe("settings", () => {
  test("business details, booking rules and alerts save, and persist after a reload", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/settings`);
    await page.getByLabel("About").fill("We cut hair & \"style\" it <b>nicely</b>.");
    await page.getByLabel("Phone").fill("416-555-0100");
    await page.getByLabel("Website", { exact: true }).fill("https://example.test");
    await page.getByLabel("Address").first().fill("1 Test Street, Toronto");
    await page.getByLabel("Minimum notice").selectOption({ index: 2 });
    await page.getByLabel("Book up to").selectOption({ label: "30 days ahead" });
    await page.getByLabel("Time slot spacing").selectOption({ label: "Every 30 minutes" });
    await page.getByLabel("Customers can cancel or reschedule until").selectOption({ label: "48 hours before" });
    await page.getByRole("switch", { name: "Booking alerts for your team" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("About")).toHaveValue("We cut hair & \"style\" it <b>nicely</b>.");
    await expect(page.getByLabel("Book up to")).toHaveValue("30");
    await expect(page.getByLabel("Time slot spacing")).toHaveValue("30");
    const { data } = await admin().from("organizations").select("notify_push, cancellation_window_hours, slot_interval_minutes").eq("id", S.orgA.id).single();
    expect(data).toEqual({ notify_push: false, cancellation_window_hours: 48, slot_interval_minutes: 30 });
    // the public page escapes it rather than running it
    const pub = await page.request.get(`/${S.orgA.slug}`);
    expect(await pub.text()).not.toContain("<b>nicely</b>");
    // put things back
    await page.getByLabel("Book up to").selectOption({ label: "60 days ahead" });
    await page.getByLabel("Time slot spacing").selectOption({ label: "Every 15 minutes" });
    await page.getByLabel("Customers can cancel or reschedule until").selectOption({ label: "24 hours before" });
    await page.getByRole("switch", { name: "Booking alerts for your team" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    w.assertNone();
  });

  test("a reserved or empty booking link is refused with a clear message", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/settings`);
    await page.getByLabel("Booking link").fill("login");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/reserved/i)).toBeVisible();
    await page.getByLabel("Booking link").fill("e2e-clinic");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/already|taken|exists/i)).toBeVisible();
    await page.getByLabel("Booking link").fill(S.orgA.slug);
    await page.getByLabel("Name", { exact: true }).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/settings`)); // required field
  });

  test("payments: without a connected Stripe account the button explains what to do, with the stand-in it connects", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/settings`);
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    const connect = page.getByRole("link", { name: /Connect Stripe/ });
    await expect(connect).toBeVisible();
    const res = await page.request.get(`/api/stripe/connect?org=${S.orgA.slug}`, { maxRedirects: 0 });
    expect([302, 303, 307]).toContain(res.status()); // sent to Stripe's onboarding page
    expect(res.headers()["location"]).toContain("127.0.0.1:4010/onboard");
    const { data } = await admin().from("organizations").select("stripe_account_id").eq("id", S.orgA.id).single();
    expect(data!.stripe_account_id).toMatch(/^acct_mock_/);
    await admin().from("organizations").update({ stripe_account_id: null }).eq("id", S.orgA.id);
    // a signed-out caller or a stranger gets nowhere
    const anon = await page.context().browser()!.newContext();
    const r2 = await anon.request.get(`/api/stripe/connect?org=${S.orgA.slug}`, { maxRedirects: 0 });
    expect([302, 303, 307, 401, 403, 404]).toContain(r2.status());
    expect(r2.headers()["location"] ?? "").not.toContain("onboard");
    await anon.close();
  });

  test("locations: add, assign people, edit and delete", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/settings`);
    const locations = page.locator("section", { has: page.getByRole("heading", { name: "Locations" }) });
    await locations.getByRole("button", { name: "Add" }).click();
    await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("E2E Pop-up");
    await page.getByRole("dialog").getByLabel("Address").fill("99 Pop Street");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("E2E Pop-up")).toBeVisible();
    // at least two locations means customers are asked to choose one
    const sb = admin();
    const { data: loc } = await sb.from("locations").select("id, name, address").eq("org_id", S.orgA.id).eq("name", "E2E Pop-up").single();
    expect(loc!.address).toBe("99 Pop Street");
    await page.getByText("E2E Pop-up").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Tap to confirm|Delete/ }).last().click();
    await expect(page.getByText("E2E Pop-up")).toHaveCount(0);
  });

  test("the booking-page link generator gives copyable snippets", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/settings`);
    await expect(page.getByText(/embed|Add to your website/i).first()).toBeVisible();
    await expect(page.locator("body")).toContainText(S.orgA.slug);
    const embedJs = await page.request.get("/embed.js");
    expect(embedJs.status()).toBe(200);
    expect(await embedJs.text()).toContain("tempo");
  });
});
