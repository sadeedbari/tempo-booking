import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, fillDetails, pickDay, pickTime, S, watchErrors } from "./helpers";

const slug = S.orgA.slug;
const base = `/o/${slug}`;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const HAIRCUT = S.orgA.services.haircut;
const COLOUR = S.orgA.services.colour;

type Def = { label: string; type: string; options?: string[]; required?: boolean; help?: string };
async function addQuestions(service: string, defs: Def[]) {
  const ids: string[] = [];
  for (const [position, d] of defs.entries()) {
    const { data, error } = await sb()
      .from("service_questions")
      .insert({ org_id: S.orgA.id, service_id: service, label: d.label, type: d.type, options: d.options ?? [], required: d.required ?? false, help_text: d.help ?? null, position })
      .select("id")
      .single();
    expect(error).toBeNull();
    ids.push(data!.id);
  }
  return ids;
}
const questionsOf = async (service: string) =>
  (await sb().from("service_questions").select("id, label, type, options, required, help_text, position").eq("service_id", service).order("position")).data ?? [];

test.beforeEach(async () => {
  await sb().from("service_questions").delete().eq("org_id", S.orgA.id);
});

async function openEditor(page: import("@playwright/test").Page, nth: number) {
  await page.goto(`${base}/services`);
  await page.getByRole("button", { name: "Edit" }).nth(nth).click();
  await expect(page.getByRole("heading", { name: "Edit service" })).toBeVisible();
  return page.getByRole("dialog");
}
const SAVED = "Service updated";

test.describe("the service editor", () => {
  test("a business builds questions of each kind; they save in order, and reopen as they were", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    const dlg = await openEditor(page, 0); // Haircut
    await expect(dlg.getByText("Questions for customers")).toBeVisible();

    await dlg.getByRole("button", { name: "Add a question" }).click();
    await dlg.getByLabel("Question 1", { exact: true }).fill("Any allergies?");
    await dlg.getByRole("switch", { name: "Question 1 is required" }).click();
    await dlg.getByLabel("Help text for question 1").fill("Products, fragrances, latex");

    await dlg.getByRole("button", { name: "Add a question" }).click();
    await dlg.getByLabel("Question 2", { exact: true }).fill("Hair type");
    await dlg.getByLabel("Answer type for question 2").selectOption("choice");
    await dlg.getByLabel("Choices for question 2").fill("Straight\nWavy\n\n  Curly  \n");

    await dlg.getByRole("button", { name: "Add a question" }).click();
    await dlg.getByLabel("Question 3", { exact: true }).fill("I accept the cancellation policy");
    await dlg.getByLabel("Answer type for question 3").selectOption("agree");
    await dlg.getByRole("switch", { name: "Question 3 is required" }).click();

    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(SAVED)).toBeVisible();

    const rows = await questionsOf(HAIRCUT);
    expect(rows.map((r) => [r.label, r.type, r.required, r.position])).toEqual([
      ["Any allergies?", "text", true, 0],
      ["Hair type", "choice", false, 1],
      ["I accept the cancellation policy", "agree", true, 2],
    ]);
    expect(rows[0].help_text).toBe("Products, fragrances, latex");
    expect(rows[1].options).toEqual(["Straight", "Wavy", "Curly"]); // blank lines dropped, spaces trimmed
    expect(rows[2].options).toEqual([]);

    // reopened: same questions, same settings
    const again = await openEditor(page, 0);
    await expect(again.getByLabel("Question 1", { exact: true })).toHaveValue("Any allergies?");
    await expect(again.getByRole("switch", { name: "Question 1 is required" })).toHaveAttribute("aria-checked", "true");
    await expect(again.getByLabel("Answer type for question 2")).toHaveValue("choice");
    await expect(again.getByLabel("Choices for question 2")).toHaveValue("Straight\nWavy\nCurly");
    await expect(again.getByLabel("Answer type for question 3")).toHaveValue("agree");
    w.assertNone();
  });

  test("saving again keeps the same questions (same ids), including after reordering; removing one deletes only that one", async ({ pageAs }) => {
    const [a, b, c] = await addQuestions(HAIRCUT, [{ label: "First", type: "text" }, { label: "Second", type: "text" }, { label: "Third", type: "text" }]);
    const page = await pageAs("ownerA");
    let dlg = await openEditor(page, 0);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    expect((await questionsOf(HAIRCUT)).map((r) => r.id)).toEqual([a, b, c]);

    dlg = await openEditor(page, 0);
    await dlg.getByRole("button", { name: "Move question 3 up" }).click(); // First, Third, Second
    await dlg.getByRole("button", { name: "Move question 1 down" }).click(); // Third, First, Second
    await expect(dlg.getByRole("button", { name: "Move question 1 up" })).toBeDisabled();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    expect((await questionsOf(HAIRCUT)).map((r) => [r.id, r.label])).toEqual([[c, "Third"], [a, "First"], [b, "Second"]]);

    dlg = await openEditor(page, 0);
    await dlg.getByRole("button", { name: "Remove question 2" }).click(); // First
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    expect((await questionsOf(HAIRCUT)).map((r) => r.id)).toEqual([c, b]);
  });

  test("mistakes are explained, the editor stays open, and nothing half-saved is left behind", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const dlg = await openEditor(page, 0);
    const add = async (label: string) => { await dlg.getByRole("button", { name: "Add a question" }).click(); await dlg.getByLabel("Question 1", { exact: true }).fill(label); };

    await add("Hair type");
    await dlg.getByLabel("Answer type for question 1").selectOption("choice");
    await dlg.getByLabel("Choices for question 1").fill("Only one");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg.getByText(/Question 1: add at least two choices/)).toBeVisible();
    expect(await questionsOf(HAIRCUT)).toHaveLength(0);

    await dlg.getByLabel("Choices for question 1").fill("Wavy\nwavy");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg.getByText(/each choice must be different/)).toBeVisible();

    await dlg.getByLabel("Choices for question 1").fill("Wavy\nCurly");
    await dlg.getByLabel("Question 1", { exact: true }).fill("   ");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg.getByText(/Give every question some text/)).toBeVisible();
    expect(await questionsOf(HAIRCUT)).toHaveLength(0);

    await dlg.getByLabel("Question 1", { exact: true }).fill("Hair type");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    expect(await questionsOf(HAIRCUT)).toHaveLength(1);
  });

  test("a service can have 12 questions and no more", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const dlg = await openEditor(page, 0);
    for (let i = 1; i <= 12; i++) await dlg.getByRole("button", { name: "Add a question" }).click();
    await expect(dlg.getByRole("button", { name: "Add a question" })).toBeDisabled();
    await expect(dlg.getByText(/the most a service can have/)).toBeVisible();
    for (let i = 1; i <= 12; i++) await dlg.getByLabel(`Question ${i}`, { exact: true }).fill(`Question number ${i}`);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    expect(await questionsOf(HAIRCUT)).toHaveLength(12);
  });

  test("questions can be copied from another service; the copies are independent", async ({ pageAs }) => {
    const src = await addQuestions(COLOUR, [{ label: "Patch test done?", type: "yes_no", required: true }, { label: "Scalp condition", type: "choice", options: ["Fine", "Sensitive"] }]);
    const page = await pageAs("ownerA");
    const dlg = await openEditor(page, 0); // Haircut
    await dlg.getByLabel("Copy questions from another service").selectOption({ label: "Colour (2)" });
    await dlg.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dlg.getByLabel("Question 1", { exact: true })).toHaveValue("Patch test done?");
    await expect(dlg.getByLabel("Question 2", { exact: true })).toHaveValue("Scalp condition");
    await expect(dlg.getByLabel("Choices for question 2")).toHaveValue("Fine\nSensitive");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(SAVED)).toBeVisible();
    const copies = await questionsOf(HAIRCUT);
    expect(copies.map((r) => r.label)).toEqual(["Patch test done?", "Scalp condition"]);
    expect(copies[0].required).toBe(true);
    expect(copies.map((r) => r.id)).not.toEqual(src); // new questions, not shared ones
    expect(await questionsOf(COLOUR)).toHaveLength(2);
  });

  test("plain staff can't edit services, so can't edit questions", async ({ pageAs }) => {
    const page = await pageAs("staffA1");
    await page.goto(`${base}/services`);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });
});

/** Opens the booking form for Colour up to the details step. Each test books on its own day so they never compete for the slot. */
async function toDetails(page: import("@playwright/test").Page, day = 3, url = `/${slug}?service=colour`) {
  await page.goto(url);
  await page.getByRole("button", { name: /Queen West/ }).click();
  await pickDay(page, day);
  await pickTime(page, "10:00 AM");
}

test.describe("the booking form", () => {
  const defs: Def[] = [
    { label: "Any allergies?", type: "paragraph", required: true, help: "Products, fragrances, latex" },
    { label: "Hair type", type: "choice", options: ["Straight", "Wavy", "Curly"], required: true },
    { label: "Areas to treat", type: "multi", options: ["Roots", "Ends", "All over"] },
    { label: "Is this your first visit?", type: "yes_no", required: true },
    { label: "Last colour", type: "date" },
    { label: "I accept the cancellation policy", type: "agree", required: true },
  ];

  test("the questions appear in order, required ones block the booking, and the answers reach the team", async ({ page, pageAs }) => {
    await addQuestions(COLOUR, defs);
    const w = watchErrors(page);
    await toDetails(page);
    const box = page.getByTestId("intake-questions");
    await expect(box.getByText("A few questions")).toBeVisible();
    await expect(box.getByText("Any allergies?")).toBeVisible();
    await expect(box.getByText("Products, fragrances, latex")).toBeVisible();
    await expect(box.getByText("Areas to treat (optional)")).toBeVisible();
    await expect(box.getByText("Last colour (optional)")).toBeVisible();

    const email = customerEmail("intake");
    await fillDetails(page, { name: "Ivy Intake", email });
    // required questions unanswered: the browser stops the submit, nothing is booked
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}`));
    expect(await page.locator("form :invalid").count()).toBeGreaterThan(0);
    const { data: none } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email);
    expect(none).toHaveLength(0);

    await box.getByLabel(/Any allergies/).fill("Latex & <b>nuts</b>");
    await box.getByLabel(/Hair type/).selectOption("Wavy");
    await box.getByLabel("Roots").check();
    await box.getByLabel("All over").check();
    await box.getByText("Yes", { exact: true }).click();
    await box.getByLabel(/Last colour/).fill("2026-01-15");
    await box.getByLabel(/I accept the cancellation policy/).check();
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);

    const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
    const { data: b } = await sb().from("bookings").select("id, answers").eq("customer_id", cust!.id).single();
    expect(b!.answers.map((a: any) => [a.label, a.value])).toEqual([
      ["Any allergies?", "Latex & <b>nuts</b>"],
      ["Hair type", "Wavy"],
      ["Areas to treat", ["Roots", "All over"]],
      ["Is this your first visit?", "Yes"],
      ["Last colour", "2026-01-15"],
      ["I accept the cancellation policy", "Agreed"],
    ]);

    // the team: an icon in the list, the answers in the booking, shown as plain text
    const staff = await pageAs("ownerA");
    await staff.goto(`${base}/bookings`);
    const row = staff.getByRole("button", { name: /Ivy Intake/ });
    await expect(row.getByLabel("Has intake answers")).toBeVisible();
    await row.click();
    const answers = staff.getByTestId("booking-answers");
    await expect(answers.getByText("Customer's answers")).toBeVisible();
    await expect(answers.getByText("Any allergies?")).toBeVisible();
    await expect(answers.getByText("Latex & <b>nuts</b>")).toBeVisible(); // not interpreted as HTML
    await expect(answers.getByText("Roots, All over")).toBeVisible();
    await expect(answers.getByText("Agreed")).toBeVisible();
    w.assertNone();
  });

  test("a required 'choose several' question the browser can't check is still enforced, in plain words", async ({ page }) => {
    await addQuestions(COLOUR, [{ label: "Areas to treat", type: "multi", options: ["Roots", "Ends"], required: true }]);
    await toDetails(page, 4);
    await fillDetails(page, { email: customerEmail("multi") });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByText("Please answer: Areas to treat")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/violates|constraint|P0001|function public/i);
    // what they had typed is still there
    await expect(page.getByLabel("Full name")).toHaveValue("Test Customer");
    await expect(page.getByLabel("Email")).not.toHaveValue("");
    await page.getByLabel("Ends").check();
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
  });

  test("if the business changes the questions while someone is filling the form in, they get a clear message and can retry", async ({ page }) => {
    await addQuestions(COLOUR, [{ label: "Optional note", type: "text" }]);
    await toDetails(page, 5);
    await fillDetails(page, { email: customerEmail("stale") });
    // meanwhile a new required question is added
    await addQuestions(COLOUR, [{ label: "Brand new required question", type: "text", required: true }]);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByText("Please answer: Brand new required question")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${slug}`));
  });

  test("a service without questions shows no question section", async ({ page }) => {
    await toDetails(page, 6);
    await expect(page.getByTestId("intake-questions")).toHaveCount(0);
    await fillDetails(page, { email: customerEmail("plain") });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/booking\/[a-f0-9]{48}/);
  });

  test("the website pop-up version of the booking form asks them too", async ({ page }) => {
    await addQuestions(COLOUR, [{ label: "Any allergies?", type: "text", required: true }]);
    await toDetails(page, 7, `/embed/${slug}?service=colour`);
    await expect(page.getByTestId("intake-questions").getByText("Any allergies?")).toBeVisible();
  });

  test("on a phone the questions fit the screen and the fields are big enough", async ({ browser }) => {
    await addQuestions(COLOUR, defs);
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await toDetails(page, 8);
    await expect(page.getByTestId("intake-questions")).toBeVisible();
    const audit = await page.evaluate(() => {
      const doc = document.documentElement;
      const small = [...document.querySelectorAll<HTMLInputElement>("[data-testid=intake-questions] input:not([type=checkbox]):not([type=radio]), [data-testid=intake-questions] select, [data-testid=intake-questions] textarea")]
        .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
        .map((e) => e.getAttribute("name") || e.tagName);
      return { overflow: doc.scrollWidth - doc.clientWidth, small };
    });
    expect(audit.overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
    expect(audit.small, "fields under 16px zoom on iPhone").toEqual([]);
    await ctx.close();
  });
});
