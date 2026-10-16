import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { customerEmail, mock, S, watchErrors } from "./helpers";

const slug = S.orgA.slug;
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** The form refuses anything sent within two seconds of opening (a robot), so a person-speed pause comes first. */
const human = (page: import("@playwright/test").Page) => page.waitForTimeout(2300);

/** Opens the hosted contact page, writes a message and sends it. */
async function ask(page: import("@playwright/test").Page, o: { email: string; name?: string; message?: string }) {
  await page.goto(`${BASE}/${slug}/contact`);
  await page.getByLabel("Full name").fill(o.name ?? "Ina Inquirer");
  await page.getByLabel("Email").fill(o.email);
  await page.getByLabel("Your message").fill(o.message ?? "Do you have anything open next week?");
  await human(page);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
}

async function fill(scope: import("@playwright/test").Page | import("@playwright/test").FrameLocator, o: { name?: string; email: string; phone?: string; message?: string; service?: string }) {
  await scope.getByLabel("Full name").fill(o.name ?? "Ina Inquirer");
  await scope.getByLabel("Email").fill(o.email);
  if (o.phone) await scope.getByLabel("Phone (optional)").fill(o.phone);
  if (o.service) await scope.getByLabel("Service you're interested in").selectOption({ label: o.service });
  await scope.getByLabel("Your message").fill(o.message ?? "Do you have anything open next week?");
}

/** A page on another website, served from a different origin (its own port), so the form is genuinely framed by another site. */
const hosts: http.Server[] = [];
async function hostPage(page: import("@playwright/test").Page, body: string) {
  // A real little web server (Chrome treats a page that was only faked by the test as "public" and blocks its calls to localhost).
  const server = http.createServer((_, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(`<!doctype html><body style="font-family:sans-serif">${body}</body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  hosts.push(server);
  await page.goto(`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/`);
}
test.afterEach(async () => { for (const s of hosts.splice(0)) await new Promise((r) => s.close(r)); });

test.beforeEach(async () => {
  await mock.clear();
  await sb().from("inquiries").delete().eq("org_id", S.orgA.id);
  await sb().from("organizations").update({ inquiries_enabled: true, inquiry_notify_email: null, inquiry_success_message: null }).eq("id", S.orgA.id);
  await sb().from("services").update({ contact_form: true }).eq("org_id", S.orgA.id);
  // the "message received" workflow back to how a business starts: on, for every service
  const { data: wfs } = await sb().from("workflows").select("id").eq("org_id", S.orgA.id).eq("trigger", "inquiry_received");
  for (const w of wfs ?? []) {
    await sb().from("workflows").update({ active: true, all_services: true }).eq("id", w.id);
    await sb().from("workflow_services").delete().eq("workflow_id", w.id);
  }
});

test.describe("the hosted contact page", () => {
  test("a visitor sends a question: it is saved, a customer is created, and the team is emailed with a reply-to", async ({ page }) => {
    const w = watchErrors(page);
    await page.goto(`/${slug}/contact`);
    await expect(page.getByRole("heading", { name: "E2E Salon" })).toBeVisible();
    await expect(page.getByText("Send us a message")).toBeVisible();
    const email = customerEmail("ask");
    await fill(page, { name: "Ina Inquirer", email, phone: "(416) 555-0142", service: "Haircut", message: "Can I bring my daughter along?" });
    await human(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();

    const { data: row } = await sb().from("inquiries").select("*").eq("org_id", S.orgA.id).eq("email", email).single();
    expect(row.message).toBe("Can I bring my daughter along?");
    expect(row.service_name).toBe("Haircut");
    expect(row.phone).toBe("+14165550142");
    expect(row.status).toBe("new");
    const { data: cust } = await sb().from("customers").select("name, phone").eq("org_id", S.orgA.id).eq("email", email).single();
    expect(cust).toMatchObject({ name: "Ina Inquirer", phone: "+14165550142" });

    // the team (owners and admins) gets an email whose Reply goes to the visitor
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3); // owner, admin, and the visitor's confirmation
    const mails = (await mock.sent()).emails;
    const to = mails.map((m) => (Array.isArray(m.to) ? m.to[0] : m.to));
    expect(to).toContain(S.people.ownerA.email);
    expect(to).toContain(S.people.adminA.email);
    expect(to).not.toContain(S.people.staffA1.email); // plain staff aren't emailed
    expect(to).toContain(email); // the visitor gets the business's "message received" confirmation
    const m = mails.find((x) => (Array.isArray(x.to) ? x.to[0] : x.to) === S.people.ownerA.email)!;
    expect(m.subject).toBe("New message from Ina Inquirer");
    expect(m.reply_to ?? m.replyTo).toContain(email);
    expect(m.html).toContain("Can I bring my daughter along?");
    expect(m.html).toContain(`/o/${slug}/inquiries`);
    w.assertNone();
  });

  test("a message with HTML in it is shown as text, never run", async ({ page }) => {
    const email = customerEmail("xss");
    await page.goto(`/${slug}/contact`);
    await fill(page, { name: "<img src=x onerror=alert(1)>", email, message: "<script>window.__pwned=1</script> hi" });
    await human(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 20_000 }).toBeGreaterThan(0);
    const html = (await mock.sent()).emails[0].html as string;
    expect(html).not.toContain("<script>window.__pwned");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  test("a robot that fills the hidden field is told it worked, and nothing is saved or sent", async ({ page }) => {
    const email = customerEmail("bot");
    await page.goto(`/${slug}/contact`);
    await fill(page, { email });
    await page.locator('input[name="website"]').evaluate((el: HTMLInputElement) => { el.value = "http://spam.example"; });
    await human(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
    const { data } = await sb().from("inquiries").select("id").eq("org_id", S.orgA.id).eq("email", email);
    expect(data).toHaveLength(0);
    // (an email from the previous test can still be on its way, so look only for this robot's address)
    await page.waitForTimeout(1500);
    expect(JSON.stringify((await mock.sent()).emails)).not.toContain(email);
  });

  test("a form submitted instantly (under two seconds) is treated as a robot too", async ({ page }) => {
    const email = customerEmail("fast");
    await page.goto(`/${slug}/contact`);
    await fill(page, { email });
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
    const { data } = await sb().from("inquiries").select("id").eq("org_id", S.orgA.id).eq("email", email);
    expect(data).toHaveLength(0);
  });

  test("a wrong phone number is explained, nothing is lost, and the fourth message in an hour is slowed", async ({ page }) => {
    const email = customerEmail("lim");
    await page.goto(`/${slug}/contact`);
    await fill(page, { email, phone: "12" });
    await human(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/phone number doesn.t look right/i)).toBeVisible();
    await expect(page.getByLabel("Your message")).toHaveValue("Do you have anything open next week?"); // typed text kept

    await page.getByLabel("Phone (optional)").fill("");
    for (let i = 1; i <= 3; i++) {
      await page.getByLabel("Your message").fill(`message number ${i}`);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
      await page.getByRole("button", { name: "Send another message" }).click();
      await page.getByLabel("Full name").fill("Ina Inquirer");
      await page.getByLabel("Email").fill(email);
    }
    await page.getByLabel("Your message").fill("message number 4");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/too many messages/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/violates|constraint|P0001|function public/i);
  });

  test("a business that turned the form off shows a polite notice instead of a form", async ({ page }) => {
    await sb().from("organizations").update({ inquiries_enabled: false }).eq("id", S.orgA.id);
    await page.goto(`/${slug}/contact`);
    await expect(page.getByText(/isn.t taking messages through its website/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
  });

  test("an unknown business is a clean not-found", async ({ page }) => {
    const r = await page.goto(`/no-such-business-here/contact`);
    expect(r?.status()).toBe(404);
  });

  test("the service can be pre-selected from the link", async ({ page }) => {
    await page.goto(`/${slug}/contact?service=haircut`);
    await expect(page.getByLabel("Service you're interested in")).toHaveValue(S.orgA.services.haircut);
  });
});

test.describe("on another website", () => {
  test("the embedded form tells its page when it is sent and how tall it is", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__msgs = [];
      window.addEventListener("message", (e) => (window as any).__msgs.push(e.data));
    });
    await page.goto(`/embed/${slug}/contact`);
    await expect(page.getByRole("heading", { name: "E2E Salon" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__msgs.some((m: any) => m?.type === "tempo:resize" && m.height > 200))).toBe(true);
    await fill(page, { email: customerEmail("emb") });
    await human(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__msgs.some((m: any) => m?.type === "tempo:inquiry"))).toBe(true);
  });

  test("embed.js: a button opens the form pop-up and a div shows it inline; both work and report a sent message", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await hostPage(page, `<h1>Someone else's website</h1>
      <button data-tempo-contact data-tempo-service="haircut">Ask a question</button>
      <div id="inline" data-tempo-form></div>
      <script src="${BASE}/embed.js" data-slug="${slug}" async></script>`);
    await page.evaluate(() => { (window as any).__sent = 0; window.addEventListener("tempo:inquiry", () => (window as any).__sent++); });

    // inline: the iframe appears and grows to fit the form
    const inline = page.frameLocator("iframe.tempo-inline");
    await expect(inline.getByRole("heading", { name: "E2E Salon" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await page.locator("iframe.tempo-inline").boundingBox())?.height ?? 0).toBeGreaterThan(400);

    // pop-up: opens over the page with the service pre-selected, closes with Escape
    await page.getByRole("button", { name: "Ask a question" }).click();
    const modal = page.locator(".tempo-modal.tempo-contact");
    await expect(modal).toBeVisible();
    const popup = modal.frameLocator("iframe");
    await expect(popup.getByLabel("Service you're interested in")).toHaveValue(S.orgA.services.haircut);
    const email = customerEmail("pop");
    await fill(popup, { email, message: "Question from the pop-up" });
    await human(page);
    await popup.getByRole("button", { name: "Send message" }).click();
    await expect(popup.getByRole("heading", { name: "Message sent" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__sent)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    const { data } = await sb().from("inquiries").select("message, service_name").eq("org_id", S.orgA.id).eq("email", email).single();
    expect(data).toMatchObject({ message: "Question from the pop-up", service_name: "Haircut" });
    await ctx.close();
  });

  test("the booking pop-up still works next to the contact form", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await hostPage(page, `<button data-tempo-open>Book now</button><button data-tempo-contact>Ask</button>
      <script src="${BASE}/embed.js" data-slug="${slug}" async></script>`);
    await page.getByRole("button", { name: "Book now" }).click();
    await expect(page.locator(".tempo-modal:not(.tempo-contact) iframe")).toBeVisible();
    await expect(page.locator(".tempo-modal.tempo-contact")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".tempo-modal")).toHaveCount(0);
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.locator(".tempo-modal.tempo-contact")).toBeVisible();
    await ctx.close();
  });
});

test.describe("the team's Inquiries page", () => {
  async function seed(n = 1, who = "Sam Seeker") {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const email = customerEmail("seed");
      const { error } = await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!).rpc("create_public_inquiry", {
        p_org: S.orgA.id, p_service: S.orgA.services.haircut, p_name: `${who} ${i + 1}`, p_email: email, p_phone: "+14165550166", p_message: `Seed message ${i + 1}`, p_ip_hash: null,
      });
      expect(error).toBeNull();
      out.push(email);
    }
    return out;
  }

  test("new messages show in the list and as a count in the menu; working through them moves them between tabs", async ({ pageAs }) => {
    await seed(2);
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`/o/${slug}/inquiries`);
    await expect(page.getByRole("heading", { name: "Inquiries" })).toBeVisible();
    await expect(page.getByTestId("inquiry")).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Inquiries\s*2/ })).toBeVisible(); // sidebar badge
    const first = page.getByTestId("inquiry").filter({ hasText: "Sam Seeker 1" });
    await expect(first.getByText("Haircut")).toBeVisible();
    await expect(first.getByRole("link", { name: "Reply by email" })).toHaveAttribute("href", /^mailto:.+subject=Re/);
    await expect(first.getByRole("link", { name: /\+14165550166/ })).toHaveAttribute("href", "tel:+14165550166");

    await first.getByRole("button", { name: "Mark handled" }).click();
    await expect(page.getByText("Marked as handled")).toBeVisible();
    await expect(page.getByTestId("inquiry")).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Inquiries\s*1/ })).toBeVisible();
    await page.getByRole("tab", { name: /Handled/ }).click();
    await expect(page.getByTestId("inquiry").filter({ hasText: "Sam Seeker 1" })).toBeVisible();
    await page.getByTestId("inquiry").first().getByRole("button", { name: "Archive" }).click();
    await page.getByRole("tab", { name: /Archived/ }).click();
    await expect(page.getByTestId("inquiry")).toHaveCount(1);
    await page.getByTestId("inquiry").first().getByRole("button", { name: "Reopen" }).click();
    await page.getByRole("tab", { name: /New/ }).click();
    await expect(page.getByTestId("inquiry")).toHaveCount(2);
    w.assertNone();
  });

  test("a private note is saved and survives a reload", async ({ pageAs }) => {
    await seed(1, "Noted Person");
    const page = await pageAs("adminA");
    await page.goto(`/o/${slug}/inquiries`);
    const card = page.getByTestId("inquiry").first();
    await card.getByRole("button", { name: "Add a note" }).click();
    await card.getByLabel(/Private note for/).fill("Call after 3pm");
    await card.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Note saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("inquiry").first().getByLabel(/Private note for/)).toHaveValue("Call after 3pm");
  });

  test("plain staff can work through messages but only owners and admins see Delete; deleting asks first", async ({ pageAs }) => {
    await seed(1, "Delete Candidate");
    const staff = await pageAs("staffA1");
    await staff.goto(`/o/${slug}/inquiries`);
    await expect(staff.getByTestId("inquiry")).toHaveCount(1);
    await expect(staff.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await staff.getByRole("button", { name: "Mark handled" }).click();
    await expect(staff.getByText("Marked as handled")).toBeVisible();

    const owner = await pageAs("ownerA");
    await owner.goto(`/o/${slug}/inquiries`);
    await owner.getByRole("tab", { name: /Handled/ }).click();
    await owner.getByRole("button", { name: "Delete" }).click();
    await expect(owner.getByText("Delete this message for good?")).toBeVisible();
    await owner.getByRole("button", { name: "Keep it" }).click();
    await expect(owner.getByTestId("inquiry")).toHaveCount(1); // cancelled: still there
    await owner.getByRole("button", { name: "Delete" }).click();
    await owner.getByRole("button", { name: "Yes, delete" }).click();
    await expect(owner.getByText("Deleted")).toBeVisible();
    await expect(owner.getByTestId("inquiry")).toHaveCount(0);
  });

  test("an empty list explains itself and points to the contact form setup", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/inquiries`);
    await expect(page.getByText("No new messages")).toBeVisible();
    await page.getByRole("link", { name: "Get the contact form" }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: "Contact form for your website" })).toBeVisible();
  });

  test("another team can't open this team's inquiries", async ({ pageAs }) => {
    const page = await pageAs("ownerB");
    const r = await page.goto(`/o/${slug}/inquiries`);
    expect(r?.status()).toBe(404);
  });
});

test.describe("contact form settings", () => {
  test("snippets are offered for pop-up, inline and link, with the chosen service", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/settings`);
    const section = page.locator("#contact-form");
    const code = section.locator("pre");
    await expect(code).toContainText("data-tempo-contact");
    await section.getByRole("tab", { name: "On the page" }).click();
    await expect(code).toContainText("data-tempo-form");
    await section.getByRole("tab", { name: "Direct link" }).click();
    await expect(code).toHaveText(`${BASE}/${slug}/contact`);
    await section.getByLabel("Pre-select a service").selectOption({ label: "Haircut pre-selected" });
    await expect(code).toHaveText(`${BASE}/${slug}/contact?service=haircut`);
  });

  test("turning the form off stops messages; a chosen address replaces the owner/admin emails; a bad address is explained", async ({ pageAs, browser }) => {
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/settings`);
    // a mistyped address is caught by the browser before anything is sent
    const notify = page.getByLabel("Email new messages to");
    await notify.fill("not-an-email");
    await page.getByRole("button", { name: "Save changes" }).click();
    expect(await notify.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    await expect(page.getByText("Settings saved")).toHaveCount(0);

    await page.getByLabel("Email new messages to").fill("front-desk@customers.tempo-e2e.test");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();

    const v = await browser.newContext();
    const vp = await v.newPage();
    await vp.goto(`/${slug}/contact`.replace(/^/, BASE));
    const visitor = customerEmail("route");
    await fill(vp, { email: visitor });
    await human(vp);
    await vp.getByRole("button", { name: "Send message" }).click();
    await expect(vp.getByRole("heading", { name: "Message sent" })).toBeVisible();
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 20_000 }).toBe(2);
    const to = (await mock.sent()).emails.map((m) => (Array.isArray(m.to) ? m.to[0] : m.to));
    // the chosen address instead of the owners and admins, plus the visitor's own confirmation
    expect(to.filter((a) => a !== visitor)).toEqual(["front-desk@customers.tempo-e2e.test"]);
    expect(to).toContain(visitor);

    await page.reload();
    await page.getByRole("switch", { name: "Website contact form" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await vp.goto(`${BASE}/${slug}/contact`);
    await expect(vp.getByText(/isn.t taking messages through its website/i)).toBeVisible();
    await page.goto(`/o/${slug}/inquiries`);
    await expect(page.getByText(/contact form is turned off/i)).toBeVisible();
    await v.close();
  });
});

const toOf = (m: any) => (Array.isArray(m.to) ? m.to[0] : m.to) as string;

test.describe("phase 2: the visitor's confirmation, booking from a message, Home and customer history", () => {
  async function ask(page: import("@playwright/test").Page, o: { email: string; name?: string; message?: string; phone?: string; service?: string }) {
    await page.goto(`/${slug}/contact`);
    await fill(page, o);
    await human(page);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
  }

  test("the visitor gets a thank-you email with their message, and no text without their agreement", async ({ page }) => {
    const email = customerEmail("thanks");
    await ask(page, { email, name: "Thea Visitor", phone: "(416) 555-0188", service: "Haircut", message: "Is parking available nearby?" });
    await expect.poll(async () => (await mock.sent()).emails.map(toOf), { timeout: 20_000 }).toContain(email);
    const mail = (await mock.sent()).emails.find((m) => toOf(m) === email)!;
    expect(mail.subject).toBe("We received your message, Thea");
    expect(mail.html).toContain("Is parking available nearby?");
    expect(mail.html).toContain("E2E Salon");
    expect(mail.html).toContain("Haircut");
    expect(mail.html).not.toMatch(/\{\{|undefined|Where:|Price:/); // no leftover placeholders or empty labels
    expect(mail.from).toContain("E2E Salon");
    expect((await mock.sent()).sms).toHaveLength(0); // they never agreed to texts
    const { data: log } = await sb().from("message_log").select("channel, status, inquiry_id, workflow_name").eq("org_id", S.orgA.id).eq("recipient", email);
    expect(log).toMatchObject([{ channel: "email", status: "sent", workflow_name: "Message received" }]);
    expect(log![0].inquiry_id).toBeTruthy();
  });

  test("the same address gets one confirmation a day, however many messages it sends; the team is told every time", async ({ page }) => {
    const email = customerEmail("again");
    await ask(page, { email, message: "First question here" });
    await page.getByRole("button", { name: "Send another message" }).click();
    await page.getByLabel("Full name").fill("Ina Inquirer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Your message").fill("A second question");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
    await expect.poll(async () => (await mock.sent()).emails.filter((m) => toOf(m) === S.people.ownerA.email).length, { timeout: 20_000 }).toBe(2);
    const sent = (await mock.sent()).emails.map(toOf);
    expect(sent.filter((a) => a === email)).toHaveLength(1);
  });

  test("the confirmation is a normal workflow: it is listed, can be switched off, and then nothing is sent", async ({ pageAs, browser }) => {
    await ask(await (await browser.newContext()).newPage(), { email: customerEmail("seedwf") }); // makes sure the built-in workflow exists
    const owner = await pageAs("ownerA");
    await owner.goto(`/o/${slug}/workflows`);
    const card = owner.getByText("Message received").first();
    await expect(card).toBeVisible();
    await expect(owner.getByText("When a website message is received")).toBeVisible();
    await card.click();
    await expect(owner.getByLabel("Send when")).toHaveValue("inquiry_received");

    await sb().from("workflows").update({ active: false }).eq("org_id", S.orgA.id).eq("trigger", "inquiry_received");
    await mock.clear();
    const email = customerEmail("off");
    const ctx = await browser.newContext();
    await ask(await ctx.newPage(), { email });
    await expect.poll(async () => (await mock.sent()).emails.map(toOf), { timeout: 20_000 }).toContain(S.people.ownerA.email);
    expect((await mock.sent()).emails.map(toOf)).not.toContain(email);
    await ctx.close();
  });

  test("a workflow limited to one service only confirms messages about that service", async ({ page, browser }) => {
    await ask(page, { email: customerEmail("prime") }); // creates the built-in workflow
    const { data: wf } = await sb().from("workflows").select("id").eq("org_id", S.orgA.id).eq("trigger", "inquiry_received").single();
    await sb().from("workflows").update({ all_services: false }).eq("id", wf!.id);
    await sb().from("workflow_services").insert({ workflow_id: wf!.id, service_id: S.orgA.services.haircut });
    await mock.clear();
    const other = customerEmail("noservice");
    const match = customerEmail("haircut");
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await ask(p, { email: other, service: "Not sure yet", message: "No service picked" });
    await p.getByRole("button", { name: "Send another message" }).click();
    await p.getByLabel("Full name").fill("Hana Haircut");
    await p.getByLabel("Email").fill(match);
    await p.getByLabel("Service you're interested in").selectOption({ label: "Haircut" });
    await p.getByLabel("Your message").fill("About a haircut");
    await p.getByRole("button", { name: "Send message" }).click();
    await expect(p.getByRole("heading", { name: "Message sent" })).toBeVisible();
    await expect.poll(async () => (await mock.sent()).emails.map(toOf), { timeout: 20_000 }).toContain(match);
    expect((await mock.sent()).emails.map(toOf)).not.toContain(other);
    await ctx.close();
  });

  async function seedMessage(name: string) {
    const email = customerEmail("p2");
    const r = await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!).rpc("create_public_inquiry", {
      p_org: S.orgA.id, p_service: S.orgA.services.haircut, p_name: name, p_email: email, p_phone: "+14165550177", p_message: `Message from ${name}`, p_ip_hash: null,
    });
    expect(r.error).toBeNull();
    return email;
  }

  test("Create booking opens the new-booking form with that customer and service already chosen", async ({ pageAs }) => {
    await seedMessage("Booker Bea");
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/inquiries`);
    await page.getByTestId("inquiry").first().getByRole("link", { name: "Create booking" }).click();
    await expect(page).toHaveURL(/\/calendar\?newFor=/);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "New booking" })).toBeVisible();
    await expect(sheet.locator("button", { hasText: "Booker Bea" })).toContainText("Selected");
    await expect(sheet.getByRole("button", { name: /^Haircut/ })).toHaveClass(/ring-2/);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/calendar$`)); // a reload won't reopen it
  });

  test("a booking made from a message is saved for that customer", async ({ pageAs }) => {
    const email = await seedMessage("Booked Bruno");
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/inquiries`);
    await page.getByTestId("inquiry").first().getByRole("link", { name: "Create booking" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Date").fill(futureDay());
    await sheet.getByRole("button", { name: /Add booking|Create|Save/ }).last().click();
    await expect(page.getByText("Booking added")).toBeVisible({ timeout: 15_000 });
    const { data: cust } = await sb().from("customers").select("id").eq("org_id", S.orgA.id).eq("email", email).single();
    const { data: b } = await sb().from("bookings").select("customer_id, service_name").eq("org_id", S.orgA.id).eq("customer_id", cust!.id);
    expect(b).toHaveLength(1);
    expect(b![0].service_name).toBe("Haircut");
    // answering the message with a booking marks it handled
    await expect(page.getByText("The message is marked as handled")).toBeVisible();
    const { data: inq } = await sb().from("inquiries").select("status, handled_at").eq("org_id", S.orgA.id).eq("customer_id", cust!.id).single();
    expect(inq!.status).toBe("handled");
    expect(inq!.handled_at).toBeTruthy();
  });

  test("Home counts unanswered messages and links to them; handling them clears the line", async ({ pageAs }) => {
    await seedMessage("Home One");
    await seedMessage("Home Two");
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/dashboard`);
    const line = page.getByRole("link", { name: /2 new website messages to answer/ });
    await expect(line).toBeVisible();
    await line.click();
    await expect(page).toHaveURL(/\/inquiries/);
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("inquiry").first().getByRole("button", { name: "Mark handled" }).click();
      await expect(page.getByText("Marked as handled")).toBeVisible();
    }
    await page.goto(`/o/${slug}/dashboard`);
    await expect(page.getByText(/new website message/)).toHaveCount(0);
  });

  test("a customer's sheet lists the messages they sent", async ({ pageAs }) => {
    await seedMessage("History Hal");
    const page = await pageAs("ownerA");
    await page.goto(`/o/${slug}/customers`);
    await page.getByRole("button", { name: /History Hal/ }).click();
    const box = page.getByTestId("customer-messages");
    await expect(box).toBeVisible();
    await expect(box.getByText("Message from History Hal")).toBeVisible();
    await expect(box.getByText("Haircut")).toBeVisible();
    await expect(box.getByRole("link", { name: "Open Inquiries" })).toBeVisible();
  });
});

function futureDay() {
  const d = new Date(Date.now() + 12 * 86400_000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.describe("contact form options: services listed and the thank-you text", () => {
  test("services can be left out of the form's list, and the form shows only the rest", async ({ pageAs, browser }) => {
    const owner = await pageAs("ownerA");
    await owner.goto(`/o/${slug}/settings`);
    const box = owner.locator("#contact-form");
    await expect(box.getByRole("checkbox", { name: "Haircut" })).toBeChecked();
    await box.getByRole("checkbox", { name: "Haircut" }).uncheck();
    await box.getByRole("button", { name: "Save contact form options" }).click();
    await expect(owner.getByText("Contact form options saved")).toBeVisible();

    const ctx = await browser.newContext();
    const v = await ctx.newPage();
    await v.goto(`${BASE}/${slug}/contact`);
    const options = await v.getByLabel("Service you're interested in").locator("option").allTextContents();
    expect(options).toContain("Not sure yet");
    expect(options).not.toContain("Haircut");
    expect(options.length).toBeGreaterThan(1); // the other services are still there

    await owner.reload();
    await expect(owner.locator("#contact-form").getByRole("checkbox", { name: "Haircut" })).not.toBeChecked();
    await ctx.close();
  });

  test("with every service unticked the service question disappears, and the message still sends", async ({ pageAs, browser }) => {
    const owner = await pageAs("ownerA");
    await owner.goto(`/o/${slug}/settings`);
    const box = owner.locator("#contact-form");
    for (const cb of await box.getByRole("checkbox").all()) await cb.uncheck();
    await box.getByRole("button", { name: "Save contact form options" }).click();
    await expect(owner.getByText("Contact form options saved")).toBeVisible();
    const ctx = await browser.newContext();
    const v = await ctx.newPage();
    await v.goto(`${BASE}/${slug}/contact`);
    await expect(v.getByLabel("Service you're interested in")).toHaveCount(0);
    const email = customerEmail("nosvc");
    await v.getByLabel("Full name").fill("Nia NoService");
    await v.getByLabel("Email").fill(email);
    await v.getByLabel("Your message").fill("A general question");
    await human(v);
    await v.getByRole("button", { name: "Send message" }).click();
    await expect(v.getByRole("heading", { name: "Message sent" })).toBeVisible();
    const { data } = await sb().from("inquiries").select("service_id").eq("org_id", S.orgA.id).eq("email", email).single();
    expect(data!.service_id).toBeNull();
    await ctx.close();
  });

  test("the business's own thank-you text is shown after sending; empty goes back to the standard one", async ({ pageAs, browser }) => {
    const owner = await pageAs("ownerA");
    await owner.goto(`/o/${slug}/settings`);
    const box = owner.locator("#contact-form");
    await box.getByLabel("Message after they send").fill("Thanks! Sara will phone you before 5pm today.");
    await box.getByRole("button", { name: "Save contact form options" }).click();
    await expect(owner.getByText("Contact form options saved")).toBeVisible();

    const ctx = await browser.newContext();
    const v = await ctx.newPage();
    await ask(v, { email: customerEmail("custom") });
    await expect(v.getByText("Thanks! Sara will phone you before 5pm today.")).toBeVisible();

    await owner.reload();
    await owner.locator("#contact-form").getByLabel("Message after they send").fill("   ");
    await owner.locator("#contact-form").getByRole("button", { name: "Save contact form options" }).click();
    await expect(owner.getByText("Contact form options saved")).toBeVisible();
    await ask(v, { email: customerEmail("default") });
    await expect(v.getByText(/Thank you\. E2E Salon will get back to you/)).toBeVisible();
    await ctx.close();
  });

  test("a thank-you text with HTML is shown as plain text", async ({ pageAs, browser }) => {
    const owner = await pageAs("ownerA");
    await owner.goto(`/o/${slug}/settings`);
    await owner.locator("#contact-form").getByLabel("Message after they send").fill("<b>bold</b> <script>window.__x=1</script>");
    await owner.locator("#contact-form").getByRole("button", { name: "Save contact form options" }).click();
    await expect(owner.getByText("Contact form options saved")).toBeVisible();
    const ctx = await browser.newContext();
    const v = await ctx.newPage();
    await ask(v, { email: customerEmail("html") });
    await expect(v.getByText("<b>bold</b>")).toBeVisible();
    expect(await v.evaluate(() => (window as any).__x)).toBeUndefined();
    await ctx.close();
  });
});

test.describe("on a phone", () => {
  test("unread website messages show as a dot on More and a count in the menu", async ({ pageAs }) => {
    const email = customerEmail("phone");
    await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!).rpc("create_public_inquiry", {
      p_org: S.orgA.id, p_service: null, p_name: "Phone Pat", p_email: email, p_phone: "", p_message: "Seen on a phone", p_ip_hash: null,
    });
    const page = await pageAs("ownerA");
    await page.setViewportSize({ width: 375, height: 812 }); // the shared signed-in session doesn't inherit the file's viewport
    await page.goto(`/o/${slug}/dashboard`);
    const more = page.getByRole("button", { name: /More/ });
    await expect(more.getByLabel("1 new website message")).toBeVisible();
    await more.click();
    const row = page.getByRole("link", { name: /Inquiries/ });
    await expect(row).toContainText("1");
    await row.click();
    await expect(page).toHaveURL(/\/inquiries/);
    await page.getByTestId("inquiry").first().getByRole("button", { name: "Mark handled" }).click();
    await expect(page.getByText("Marked as handled")).toBeVisible();
    await page.goto(`/o/${slug}/dashboard`);
    await expect(page.getByRole("button", { name: /More/ }).getByLabel(/new website message/)).toHaveCount(0);
  });
});
