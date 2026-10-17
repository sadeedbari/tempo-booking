import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, mock, pickDay, pickTime, S, watchErrors } from "./helpers";

const slug = S.orgA.slug;
const base = `/o/${slug}`;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const COLOUR = S.orgA.services.colour;
const toOf = (m: any) => (Array.isArray(m.to) ? m.to[0] : m.to) as string;

type Def = { label: string; type: string; options?: string[]; required?: boolean };
async function addQuestions(defs: Def[]) {
  const ids: string[] = [];
  for (const [position, d] of defs.entries()) {
    const { data, error } = await sb().from("service_questions").insert({ org_id: S.orgA.id, service_id: COLOUR, label: d.label, type: d.type, options: d.options ?? [], required: d.required ?? false, position }).select("id").single();
    expect(error).toBeNull();
    ids.push(data!.id);
  }
  return ids;
}

test.beforeEach(async () => {
  await sb().from("service_questions").delete().eq("org_id", S.orgA.id);
  await mock.clear();
});

async function bookColour(page: import("@playwright/test").Page, day: number, email: string, answer?: (page: import("@playwright/test").Page) => Promise<void>) {
  await page.goto(`/${slug}?service=colour`);
  await page.getByRole("button", { name: /Queen West/ }).click();
  await pickDay(page, day);
  await pickTime(page, "10:00 AM");
  await fillDetails(page, { name: "Anna Answers", email });
  if (answer) await answer(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
}

/** Makes the built-in "Booking confirmed" email mention the answers. */
async function confirmationShowsAnswers(pageAs: (w: "ownerA") => Promise<import("@playwright/test").Page>) {
  const owner = await pageAs("ownerA");
  await owner.goto(`${base}/workflows`); // creates the built-in workflows
  const { data: wf } = await sb().from("workflows").select("id").eq("org_id", S.orgA.id).eq("default_key", "confirmed").single();
  await sb().from("workflow_steps").update({ body: "Hi {{customer_first_name}},\n\nYour answers:\n{{answers}}\n\n{{manage_button}}" }).eq("workflow_id", wf!.id).eq("channel", "email");
  return { owner, id: wf!.id as string };
}

test.describe("the answers in messages to the customer", () => {
  test("{{answers}} lists what the customer answered, one per line, safely, and vanishes when nothing was answered", async ({ page, pageAs }) => {
    await confirmationShowsAnswers(pageAs);
    await addQuestions([
      { label: "Any allergies?", type: "text" },
      { label: "Hair type", type: "choice", options: ["Straight", "Wavy"] },
      { label: "Areas", type: "multi", options: ["Roots", "Ends"] },
    ]);
    const email = customerEmail("ans");
    await bookColour(page, 3, email, async (p) => {
      await p.getByLabel(/Any allergies/).fill("Latex & <b>nuts</b>");
      await p.getByLabel(/Hair type/).selectOption("Wavy");
      await p.getByLabel("Roots").check();
      await p.getByLabel("Ends").check();
    });
    await expect.poll(async () => (await mock.sent()).emails.map(toOf), { timeout: 20_000 }).toContain(email);
    const mail = (await mock.sent()).emails.find((m) => toOf(m) === email)!;
    expect(mail.text).toContain("Your answers:\nAny allergies?: Latex & <b>nuts</b>\nHair type: Wavy\nAreas: Roots, Ends");
    expect(mail.html).toContain("Any allergies?: Latex &amp; &lt;b&gt;nuts&lt;/b&gt;<br>Hair type: Wavy<br>Areas: Roots, Ends");
    expect(mail.html).not.toContain("<b>nuts</b>");

    // a booking where nothing was answered: no placeholder, no blank line of its own
    await mock.clear();
    const email2 = customerEmail("noans");
    await bookColour(page, 4, email2);
    await expect.poll(async () => (await mock.sent()).emails.map(toOf), { timeout: 20_000 }).toContain(email2);
    const plain = (await mock.sent()).emails.find((m) => toOf(m) === email2)!;
    expect(plain.text).not.toMatch(/\{\{|undefined|null/);
    expect(plain.text).toContain("Your answers:");
    expect(plain.text).not.toMatch(/Any allergies/);
  });

  test("{{answers}} is offered for emails, and refused in a text message with a clear reason", async ({ pageAs }) => {
    const { owner, id } = await confirmationShowsAnswers(pageAs);
    await owner.goto(`${base}/workflows/${id}`);
    await expect(owner.getByText("Their answers to your booking questions").first()).toBeVisible();
    const sms = owner.locator("textarea").nth(1);
    await sms.fill("Answers: {{answers}}");
    await owner.getByRole("button", { name: "Save workflow" }).click();
    await expect(owner.getByText(/booking answers only work in emails/i)).toBeVisible();
    await sms.fill("Confirmed. {{manage_link}}");
    await owner.getByRole("button", { name: "Save workflow" }).click();
    await expect(owner.getByText(/booking answers only work in emails/i)).toHaveCount(0);
  });

  test("the test email shows sample answers", async ({ pageAs }) => {
    const { owner, id } = await confirmationShowsAnswers(pageAs);
    await owner.goto(`${base}/workflows/${id}`);
    // the live preview uses the sample answers
    await expect(owner.frameLocator("iframe[title='Email preview']").getByText(/Any allergies\?: Latex/).first()).toBeVisible();
  });
});

test.describe("the Excel export", () => {
  async function pastBooking(answers: unknown) {
    const day = new Date(Date.now() - 2 * 86_400_000);
    day.setUTCHours(15, 0, 0, 0);
    const end = new Date(day.getTime() + 2 * 3_600_000);
    const { data: cust } = await sb().from("customers").upsert({ org_id: S.orgA.id, name: "Past Paula", email: customerEmail("past") }, { onConflict: "org_id,email" }).select("id").single();
    const { error } = await sb().from("bookings").insert({
      org_id: S.orgA.id, service_id: COLOUR, member_id: S.orgA.members.sara, customer_id: cust!.id, starts_at: day.toISOString(), ends_at: end.toISOString(), blocked_until: end.toISOString(),
      status: "completed", service_name: "Colour", price_cents: 18000, deposit_cents: 0, currency: "CAD", payment_status: "none", source: "online", answers,
    });
    expect(error).toBeNull();
  }
  const rows = async (res: import("@playwright/test").APIResponse) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as never);
    const ws = wb.getWorksheet("Bookings")!;
    const out: string[][] = [];
    ws.eachRow((r) => out.push((r.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
    return out;
  };

  test("owners and admins get a Booking questions column with each booking's answers; staff don't", async ({ pageAs }) => {
    await pastBooking([
      { id: crypto.randomUUID(), label: "Any allergies?", type: "text", value: "Latex" },
      { id: crypto.randomUUID(), label: "Areas", type: "multi", value: ["Roots", "Ends"] },
    ]);
    const owner = await pageAs("ownerA");
    const sheet = await rows(await owner.request.get(`/api/export/home?org=${slug}&range=30`));
    const header = sheet.find((r) => r.includes("Booking questions"))!;
    expect(header, "owners' bookings sheet has the column").toBeTruthy();
    const col = header.indexOf("Booking questions");
    const withAnswers = sheet.find((r) => r[col]?.includes("Latex"));
    expect(withAnswers![col]).toBe("Any allergies?: Latex; Areas: Roots, Ends");

    const admin = await pageAs("adminA");
    expect((await rows(await admin.request.get(`/api/export/home?org=${slug}&range=30`))).some((r) => r.includes("Booking questions"))).toBe(true);

    const staff = await pageAs("staffA1");
    const staffSheet = await rows(await staff.request.get(`/api/export/home?org=${slug}&range=30`));
    expect(staffSheet.some((r) => r.includes("Booking questions"))).toBe(false);
    expect(JSON.stringify(staffSheet)).not.toContain("Latex");
  });

  test("answers that look like spreadsheet formulas are kept as plain text", async ({ pageAs }) => {
    await pastBooking([{ id: crypto.randomUUID(), label: "Note", type: "text", value: "=HYPERLINK(\"http://evil.example\",\"click\")" }]);
    const owner = await pageAs("ownerA");
    const res = await owner.request.get(`/api/export/home?org=${slug}&range=30`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as never);
    const found: ExcelJS.Cell[] = [];
    wb.getWorksheet("Bookings")!.eachRow((r) => r.eachCell((c) => { if (String(c.value).includes("HYPERLINK")) found.push(c); }));
    expect(found.length, "the answer is in the sheet").toBeGreaterThan(0);
    expect(typeof found[0].value, "stored as text, not a formula").toBe("string");
    expect(found[0].type).not.toBe(ExcelJS.ValueType.Formula);
  });
});

test.describe("the team adding a booking by hand", () => {
  async function openNew(page: import("@playwright/test").Page) {
    await page.goto(`${base}/calendar`);
    await page.getByRole("button", { name: /^New/ }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "New booking" })).toBeVisible();
    return sheet;
  }
  const futureDay = (n: number) => {
    const d = new Date(Date.now() + n * 86_400_000);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const fillBooking = async (sheet: import("@playwright/test").Locator, day: string, name: string, email: string) => {
    await sheet.getByRole("button", { name: /^Colour/ }).click();
    await sheet.getByLabel("Date").fill(day);
    await sheet.getByRole("button", { name: /Sara Stylist/ }).click();
    // with no customers yet there is nothing to switch: the new-customer fields are already showing
    const newTab = sheet.getByRole("tab", { name: "New", exact: true });
    if (await newTab.count()) await newTab.click();
    await sheet.getByPlaceholder("Full name").fill(name);
    await sheet.getByPlaceholder("Email").fill(email);
  };

  test("the service's questions appear (none required), and the answers are saved with the booking", async ({ pageAs }) => {
    await addQuestions([
      { label: "Any allergies?", type: "text", required: true },
      { label: "Hair type", type: "choice", options: ["Straight", "Wavy"], required: true },
      { label: "Is this a first visit?", type: "yes_no" },
    ]);
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const sheet = await openNew(page);
    const email = customerEmail("manual");
    await fillBooking(sheet, futureDay(15), "Manual Mia", email);
    const box = sheet.getByTestId("intake-questions");
    await expect(box.getByText("Booking questions (optional)")).toBeVisible();
    await expect(box.getByText("Any allergies?")).toBeVisible();
    // even the questions customers must answer are optional for the team: nothing is marked required
    expect(await box.locator("[required]").count()).toBe(0);
    await box.getByLabel(/Any allergies/).fill("Nuts");
    await box.getByLabel(/Hair type/).selectOption("Wavy");
    await sheet.getByRole("button", { name: "Add booking" }).click();
    await expect(page.getByText("Booking added")).toBeVisible({ timeout: 15_000 });
    const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
    const { data: b } = await sb().from("bookings").select("answers, source").eq("customer_id", cust!.id).single();
    expect(b!.source).toBe("manual");
    expect(b!.answers.map((a: any) => [a.label, a.value])).toEqual([["Any allergies?", "Nuts"], ["Hair type", "Wavy"]]);
    w.assertNone();
  });

  test("a booking with every question left blank works, and changing the service swaps the questions", async ({ pageAs }) => {
    await addQuestions([{ label: "Any allergies?", type: "text", required: true }]);
    const page = await pageAs("ownerA");
    const sheet = await openNew(page);
    const email = customerEmail("blank");
    await fillBooking(sheet, futureDay(23), "Blank Ben", email);
    await expect(sheet.getByTestId("intake-questions")).toBeVisible();
    // another service has no questions: the section goes away
    await sheet.getByRole("button", { name: /^Haircut/ }).click();
    await expect(sheet.getByTestId("intake-questions")).toHaveCount(0);
    await sheet.getByRole("button", { name: /^Colour/ }).click();
    await expect(sheet.getByTestId("intake-questions")).toBeVisible();
    await sheet.getByRole("button", { name: "Add booking" }).click();
    await expect(page.getByText("Booking added")).toBeVisible({ timeout: 15_000 });
    const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
    const { data: b } = await sb().from("bookings").select("answers").eq("customer_id", cust!.id).single();
    expect(b!.answers).toBeNull();
  });

  test("answers typed for one service are not carried to another", async ({ pageAs }) => {
    await addQuestions([{ label: "Any allergies?", type: "text" }]);
    const page = await pageAs("ownerA");
    const sheet = await openNew(page);
    const email = customerEmail("swap");
    await fillBooking(sheet, futureDay(31), "Swap Sam", email);
    await sheet.getByLabel(/Any allergies/).fill("Typed for Colour");
    await sheet.getByRole("button", { name: /^Haircut/ }).click();
    await sheet.getByRole("button", { name: /^Add booking/ }).click();
    await expect(page.getByText("Booking added")).toBeVisible({ timeout: 15_000 });
    const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
    const { data: b } = await sb().from("bookings").select("service_name, answers").eq("customer_id", cust!.id).single();
    expect(b!.service_name).toBe("Haircut");
    expect(b!.answers, "Haircut has no questions, so no answers are stored").toBeNull();
  });
});

test("the services page says how many questions each service asks", async ({ pageAs }) => {
  await addQuestions([{ label: "One", type: "text" }, { label: "Two", type: "text" }]);
  const page = await pageAs("ownerA");
  await page.goto(`${base}/services`);
  await expect(page.getByText("2 questions")).toBeVisible();
  await sb().from("service_questions").delete().eq("org_id", S.orgA.id);
  await addQuestions([{ label: "Only", type: "text" }]);
  await page.reload();
  await expect(page.getByText("1 question", { exact: true })).toBeVisible();
});
