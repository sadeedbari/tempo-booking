import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, mock, pickDay, pickTime, S, watchErrors } from "./helpers";
import type { Page } from "@playwright/test";

const base = `/o/${S.orgA.slug}`;
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const mailsTo = async (to: string) => (await mock.sent()).emails.filter((e) => ([] as string[]).concat(e.to).includes(to));

test.beforeEach(async () => { await mock.clear(); await mock.mode({ resend: "ok", twilio: "ok" }); });

async function publicBook(page: Page, email: string, dayIndex: number, time: string) {
  await page.goto(`/${S.orgA.slug}?service=haircut`);
  await page.getByRole("button", { name: /Queen West/ }).click();
  await page.getByRole("button", { name: /Olivia Owner/ }).click();
  await pickDay(page, dayIndex);
  await pickTime(page, time);
  await fillDetails(page, { name: "Wendy Workflow", email });
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.waitForURL(/\/booking\//);
}

test.describe("workflows", () => {
  test("the six built-in messages are there, can be switched off, and can't be deleted", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/workflows`);
    for (const name of ["Booking confirmed", "Request received", "Request declined", "Booking cancelled", "Booking rescheduled", "Appointment reminder"]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await page.getByRole("link", { name: /Appointment reminder/ }).click();
    await expect(page.getByRole("heading", { name: "Appointment reminder" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restore original wording" })).toBeVisible();
    w.assertNone();
  });

  test("editing the confirmation changes the email a customer actually receives", async ({ pageAs, page: anon }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/workflows`);
    await page.getByRole("link", { name: /Booking confirmed/ }).click();
    const subject = page.getByLabel("Subject");
    await subject.fill("Your appointment is set, {{customer_first_name}}!");
    const body = page.locator("textarea").first();
    await body.fill("Hi {{customer_first_name}},\n\nSee you {{date_time}} with {{staff_name}}.\nWhere: {{location}}\nDeposit: {{deposit}}\n\n{{manage_button}}");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.getByText("Workflow saved")).toBeVisible();
    const email = customerEmail("wf");
    await publicBook(anon, email, 9, "10:00 AM");
    await expect.poll(async () => (await mailsTo(email)).length, { timeout: 15_000 }).toBe(1);
    const mail = (await mailsTo(email))[0];
    expect(mail.subject).toBe("Your appointment is set, Wendy!");
    expect(mail.text).toContain("See you ");
    expect(mail.text).toContain("with Olivia Owner");
    expect(mail.text).toContain("Where: Queen West, 214 Queen St W, Toronto");
    expect(mail.text).not.toContain("Deposit:");
    expect(mail.html).toContain("Manage booking");
    const { data } = await admin().from("message_log").select("status, channel, workflow_name").eq("org_id", S.orgA.id).eq("recipient", email);
    expect(data).toEqual([{ status: "sent", channel: "email", workflow_name: "Booking confirmed" }]);
  });

  test("wording mistakes are explained instead of saved", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/workflows`);
    await page.getByRole("link", { name: /Booking confirmed/ }).click();
    await page.getByLabel("Subject").fill("Hello {{custmer_name}}");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.getByText(/isn.t a variable/i)).toBeVisible();
    await page.getByLabel("Subject").fill("");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.getByText(/add a subject/i)).toBeVisible();
    await page.getByLabel("Subject").fill("Fine");
    // the text message: too long, and a button variable doesn't work in a text
    const sms = page.locator("textarea").nth(1);
    await sms.fill("{{manage_button}}");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.getByText(/buttons only work in emails/i)).toBeVisible();
    await sms.fill("x".repeat(500)); // the box itself stops at 480 characters
    await expect(sms).toHaveValue("x".repeat(480));
    await page.getByRole("button", { name: "Restore original wording" }).click();
    // the page reloads to show the restored text
    await expect(page.getByLabel("Subject")).toHaveValue("Confirmed: {{service_name}} with {{business_name}}");
  });

  test("the live preview, the SMS counter and Send test to me", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/workflows`);
    await page.getByRole("link", { name: /Booking confirmed/ }).click();
    await expect(page.locator("iframe").first()).toBeVisible();
    await expect(page.getByText(/Reply STOP to opt out/).first()).toBeVisible();
    await expect(page.getByText(/\d+ messages? · \d+ characters/)).toBeVisible();
    await page.getByRole("button", { name: "Send test to me" }).click();
    await expect(page.getByText("Test email sent to you")).toBeVisible();
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 15_000 }).toBe(1);
    const sent = (await mock.sent()).emails[0];
    expect(sent.subject).toMatch(/^\[Test\]/);
    expect(sent.to).toContain("e2e.olivia.owner@tempo-e2e.test");
    // when email is down the person is told, nothing crashes
    await mock.mode({ resend: "fail" });
    await page.getByRole("button", { name: "Send test to me" }).click();
    await expect(page.getByText(/mock email failure|couldn.t send/i)).toBeVisible();
  });

  test("a custom workflow: from a starter, per service, with several messages, then delete", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/workflows`);
    await page.getByRole("button", { name: "New workflow" }).click();
    await page.getByRole("link", { name: /Thank you after the appointment/ }).click();
    await expect(page.getByRole("heading", { name: "New workflow" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("E2E Thanks");
    await page.getByRole("button", { name: "Selected services" }).click();
    await page.getByRole("button", { name: "Haircut" }).first().click();
    await page.getByRole("button", { name: /Add a text/ }).click();
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.getByText("Workflow saved")).toBeVisible();
    await page.waitForURL(/\/workflows\/[0-9a-f-]{36}/);
    const { data } = await admin().from("workflows").select("id, trigger, offset_minutes, all_services, workflow_steps(channel), workflow_services(service_id)").eq("org_id", S.orgA.id).eq("name", "E2E Thanks").single();
    expect(data).toMatchObject({ trigger: "after_end", offset_minutes: 120, all_services: false });
    expect(data!.workflow_steps).toHaveLength(2);
    expect(data!.workflow_services).toEqual([{ service_id: S.orgA.services.haircut }]);
    // it is listed, can be turned off, then deleted
    await page.goto(`${base}/workflows`);
    await expect(page.getByRole("heading", { name: "E2E Thanks" })).toBeVisible();
    await page.getByRole("link", { name: /E2E Thanks/ }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Tap to confirm" }).click();
    await page.waitForURL(`**${base}/workflows`);
    await expect(page.getByRole("heading", { name: "E2E Thanks" })).toHaveCount(0);
  });

  test("selected services need at least one choice, and timing is checked", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/workflows/new?starter=second-reminder`);
    await page.getByRole("button", { name: "Selected services" }).click();
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.getByText(/Choose at least one service/)).toBeVisible();
    await page.getByRole("button", { name: "All services" }).click();
    await page.locator('input[type="number"]').fill("0");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await expect(page.getByText(/at least 5 minutes/i)).toBeVisible();
  });

  test("the Activity tab lists what was sent, including failures", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/workflows`);
    await page.getByText("Activity", { exact: true }).click();
    const sb = admin();
    await sb.from("message_log").insert([
      { org_id: S.orgA.id, workflow_name: "Booking confirmed", channel: "email", recipient: "a@customers.tempo-e2e.test", status: "sent" },
      { org_id: S.orgA.id, workflow_name: "Appointment reminder", channel: "sms", recipient: "+14165550100", status: "failed", detail: "Twilio error 30032" },
    ]);
    await page.reload();
    await page.getByText("Activity", { exact: true }).click();
    await expect(page.getByText("Booking confirmed").first()).toBeVisible();
    await expect(page.getByText("Twilio error 30032")).toBeVisible();
  });
});
