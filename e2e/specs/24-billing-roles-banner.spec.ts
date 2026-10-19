// Who sees what about the plan: the strip at the top of every dashboard page (trial, last days, ended, payment failed,
// cancelled, expired) for owner, admin and staff at three widths; the billing page for non-owners; and the billing server
// actions refusing anyone but the owner. Team A (E2E Salon): owner Olivia, admin Adam, staff Sara.
import { test, expect } from "./fixtures";
import { S, mock, watchErrors } from "./helpers";
import {
  A, B, WIDTHS, billingUrl, bodyText, captureAction, contrast, colours, noHorizontalScroll, openAt, removeExtras, replayAction, restoreSeedPlans, setPlan,
  sizeFor, stripeMock, subRow, type ActionCall, type PlanOpts, type PlanState,
} from "./billing-helpers";

const dash = `/o/${S.orgA.slug}/dashboard`;
const longDate = (d: string | Date) => new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "America/Toronto" }).format(new Date(d));
const banner = (page: import("@playwright/test").Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const ROLES = ["ownerA", "adminA", "staffA1"] as const;
const NOT_OWNER = ["adminA", "staffA1"] as const;
const DATE_RE = /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d/;

test.beforeEach(async () => { await mock.clear(); await stripeMock.reset(); });
test.afterAll(async () => { await stripeMock.reset(); await restoreSeedPlans(); });

type Expect = { owner: string | RegExp | null; others: string | RegExp | null; link?: boolean };
const STATES: { name: string; state: PlanState; opts: PlanOpts; want: Expect }[] = [
  { name: "trial, 10 days left", state: "trial", opts: { days: 10 }, want: { owner: "Free trial: 10 days left.", others: null } },
  { name: "trial, last 3 days", state: "trial", opts: { days: 3 }, want: { owner: "Free trial: 3 days left.", others: null } },
  { name: "trial, last day", state: "trial", opts: { days: 1 }, want: { owner: "Free trial: 1 day left.", others: null } },
  { name: "trial ended", state: "trial-ended", opts: {}, want: { owner: "Your plan isn't active. The dashboard is read-only and your booking page is paused. You can still view and export your data.", others: "This business's plan isn't active, so the dashboard is read-only and the booking page is paused. Ask the account owner to subscribe." } },
  { name: "payment failed, inside the 7 days", state: "past-due", opts: { daysAgo: 2, extraLocations: 3, staffPacks: 2 }, want: { owner: /Your last payment failed\. Update your card before .+ to keep your booking page on\./, others: null } },
  { name: "payment failed, grace over (expired)", state: "past-due", opts: { daysAgo: 9, extraLocations: 3, staffPacks: 2 }, want: { owner: "Your plan isn't active.", others: "This business's plan isn't active" } },
  { name: "cancelled at period end", state: "active", opts: { cancelAtPeriodEnd: true, periodDays: 5, extraLocations: 3, staffPacks: 2 }, want: { owner: /Your plan ends on .+\./, others: null } },
  { name: "cancelled (subscription ended)", state: "cancelled", opts: {}, want: { owner: "Your plan isn't active.", others: "This business's plan isn't active" } },
  { name: "healthy paid plan", state: "active", opts: { extraLocations: 3, staffPacks: 2 }, want: { owner: null, others: null } },
];

test.describe("plan strip on every dashboard page", () => {
  for (const st of STATES) {
    test(`${st.name}: right text for each person, at 375, 768 and 1280px`, async ({ pageAs }) => {
      const row = await setPlan(A(), st.state, st.opts);
      for (const role of ROLES) {
        const page = await pageAs(role);
        const w = watchErrors(page);
        for (const width of WIDTHS) {
          await openAt(page, width, dash);
          const want = role === "ownerA" ? st.want.owner : st.want.others;
          const anyStrip = page.getByRole("status").filter({ hasText: /Free trial|plan isn't active|payment failed|plan ends|Ask the account owner|isn't active/ });
          if (want === null) {
            await expect(anyStrip, `${role} @${width}`).toHaveCount(0);
          } else {
            await expect(banner(page, want), `${role} @${width}`).toBeVisible();
            const strip = banner(page, want);
            if (role === "ownerA") {
              await expect(strip.getByRole("link", { name: "Open billing" })).toHaveAttribute("href", billingUrl(S.orgA.slug));
            } else {
              await expect(strip.getByRole("link")).toHaveCount(0);
              await expect(strip).toContainText("Ask the account owner to manage billing.");
            }
          }
          // nothing about the plan that only an owner may know reaches anyone else (D-011)
          if (role !== "ownerA") {
            const text = await bodyText(page);
            expect(text).not.toMatch(/payment failed|last payment|update your card|Free trial|days? left|plan ends on/i);
            expect(text).not.toMatch(DATE_RE);
          }
          await noHorizontalScroll(page);
        }
        w.assertNone();
      }
      if (st.state === "past-due" && (st.opts.daysAgo ?? 0) < 7) {
        const page = await pageAs("ownerA");
        await page.goto(dash);
        const until = longDate(new Date(new Date(row.past_due_since).getTime() + 7 * 86_400_000));
        await expect(banner(page, "Your last payment failed.")).toContainText(`before ${until} to keep your booking page on.`);
      }
      if (st.opts.cancelAtPeriodEnd) {
        const page = await pageAs("ownerA");
        await page.goto(dash);
        await expect(banner(page, "Your plan ends on")).toContainText(longDate(row.current_period_end));
      }
    });
  }

  test("at 375px the strip does not overlap the page heading, runs inside the screen and keeps its link tappable", async ({ pageAs }) => {
    await setPlan(A(), "past-due", { daysAgo: 2, extraLocations: 3, staffPacks: 2 });
    const page = await pageAs("ownerA");
    await openAt(page, 375, `/o/${S.orgA.slug}/team`);
    const strip = banner(page, "Your last payment failed.");
    await expect(strip).toBeVisible();
    const s = (await strip.boundingBox())!;
    const h1 = (await page.getByRole("heading", { name: "Team", level: 1 }).boundingBox())!;
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x + s.width).toBeLessThanOrEqual(375 + 0.5);
    expect(s.y + s.height, "strip bottom is above the heading").toBeLessThanOrEqual(h1.y + 0.5);
    const clipped = await strip.evaluate((n) => n.scrollWidth > n.clientWidth + 1);
    expect(clipped).toBe(false);
    const link = (await strip.getByRole("link", { name: "Open billing" }).boundingBox())!;
    expect(link.height).toBeGreaterThanOrEqual(16);
    await noHorizontalScroll(page);
    // the long expired text for staff, the longest one
    await setPlan(A(), "trial-ended");
    const staff = await pageAs("staffA1");
    await openAt(staff, 375, dash);
    const long = banner(staff, "This business's plan isn't active");
    await expect(long).toBeVisible();
    const b = (await long.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(375 + 0.5);
    await noHorizontalScroll(staff);
  });

  test("D-019 colour contrast of the strip: blue, orange (last 3 days / payment failed) and red are readable (WCAG AA 4.5:1)", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const results: Record<string, number> = {};
    for (const [name, state, opts, text] of [
      ["blue", "trial", { days: 10 }, "Free trial: 10 days left."],
      ["orange", "trial", { days: 2 }, "Free trial: 2 days left."],
      ["orange-past-due", "past-due", { daysAgo: 1, extraLocations: 3, staffPacks: 2 }, "Your last payment failed."],
      ["red", "trial-ended", {}, "Your plan isn't active."],
    ] as [string, PlanState, PlanOpts, string][]) {
      await setPlan(A(), state, opts);
      await page.goto(dash);
      const strip = banner(page, text);
      await expect(strip).toBeVisible();
      const c = await colours(strip);
      // the strip sits on the page background (white in light mode)
      results[name] = contrast(c.fg, c.bg, c.under);
    }
    console.log("strip contrast ratios:", JSON.stringify(results));
    for (const [name, ratio] of Object.entries(results)) expect.soft(ratio, `${name} strip contrast`).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("the billing page for people who are not the owner", () => {
  const STATES2: [string, PlanState, PlanOpts][] = [
    ["trial", "trial", { days: 5 }],
    ["payment failed", "past-due", { daysAgo: 3, extraLocations: 3, staffPacks: 2 }],
    ["cancelled at period end", "active", { cancelAtPeriodEnd: true, periodDays: 4, extraLocations: 3, staffPacks: 2 }],
    ["healthy plan", "active", { extraLocations: 3, staffPacks: 2 }],
    ["trial ended", "trial-ended", {}],
  ];
  for (const [name, state, opts] of STATES2) {
    test(`${name}: admin and staff typing the billing address get the notice and no plan data`, async ({ pageAs }) => {
      await setPlan(A(), state, opts);
      for (const role of NOT_OWNER) {
        const page = await pageAs(role);
        for (const width of WIDTHS) {
          await openAt(page, width, billingUrl(S.orgA.slug));
          await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
          await expect(page.getByText("Only the account owner can see or change billing. Ask them if you need something changed.")).toBeVisible();
          const text = await bodyText(page);
          expect(text, `${role} @${width}`).not.toMatch(/\$\d|\/month|Subscribe|Manage billing|Cancel at period end|Keep my subscription|Next invoice|Payment failed|What you use|Choose a plan|Change your plan|Update plan|Card and invoices/);
          expect(text).not.toMatch(DATE_RE);
          await expect(page.getByRole("button", { name: /subscribe|update plan|manage billing|cancel/i })).toHaveCount(0);
          await expect(page.getByRole("spinbutton")).toHaveCount(0);
          await noHorizontalScroll(page);
        }
      }
    });
  }

  test("admin and staff do not get the 'Plan and billing' link in Settings; the owner does", async ({ pageAs }) => {
    await setPlan(A(), "trial", { days: 5 });
    const owner = await pageAs("ownerA");
    await owner.goto(`/o/${S.orgA.slug}/settings`);
    await expect(owner.getByRole("heading", { name: "Plan and billing" })).toBeVisible();
    await owner.getByRole("link", { name: /Open billing/ }).first().click(); // the Settings entry point
    await owner.waitForURL(/settings\/billing/);
    await expect(owner.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    const admin = await pageAs("adminA");
    await admin.goto(`/o/${S.orgA.slug}/settings`);
    await expect(admin.getByRole("heading", { name: "Plan and billing" })).toHaveCount(0);
    await expect(admin.getByRole("link", { name: /billing/i })).toHaveCount(0);
    const staff = await pageAs("staffA1");
    await staff.goto(`/o/${S.orgA.slug}/team`);
    await expect(staff.getByRole("link", { name: /billing/i })).toHaveCount(0);
  });

  test("the billing server actions refuse admin, staff and another team's owner, however they are called", async ({ pageAs }) => {
    await setPlan(A(), "active", { extraLocations: 1, staffPacks: 0 }); // team A uses 2 locations and 4 people
    const owner = await pageAs("ownerA");
    await openAt(owner, 1280, billingUrl(S.orgA.slug));
    // capture each action's id from the owner's own use of the page
    const portal = await captureAction(owner, () => owner.getByRole("button", { name: "Manage billing", exact: true }).click());
    await owner.waitForURL(/\/portal\//);
    await owner.goto(billingUrl(S.orgA.slug));
    await owner.getByLabel("Staff packs (5 staff each)").fill("1");
    const change = await captureAction(owner, () => owner.getByRole("button", { name: "Update plan" }).click());
    await expect(owner.getByText("Plan updated")).toBeVisible();
    await owner.getByLabel("Staff packs (5 staff each)").fill("0");
    await owner.getByRole("button", { name: "Update plan" }).click();
    await expect.poll(async () => (await subRow(A())).staff_packs).toBe(0);
    const cancel = await captureAction(owner, async () => {
      const btn = owner.getByRole("button", { name: /Cancel at period end|Tap again to confirm/ });
      await btn.click();
      await expect(async () => { await btn.click({ timeout: 800 }); await expect(owner.getByRole("button", { name: "Keep my subscription" })).toBeVisible({ timeout: 1200 }); }).toPass({ timeout: 8000 });
    });
    expect((await subRow(A())).cancel_at_period_end).toBe(true);
    const resume = await captureAction(owner, () => owner.getByRole("button", { name: "Keep my subscription" }).click());
    await expect(owner.getByText("Subscription resumed")).toBeVisible();
    expect((await subRow(A())).cancel_at_period_end).toBe(false);

    const before = await subRow(A());
    const calls = async () => (await stripeMock.calls("/v1/")).length;
    const stripeBefore = await calls();
    const mine = (c: ActionCall, args: unknown[]) => [c, args] as const;
    const attempts = [
      mine(portal, [S.orgA.slug]),
      mine(change, [S.orgA.slug, { extraLocations: 3, staffPacks: 3 }]),
      mine(resume, [S.orgA.slug]),
      mine(cancel, [S.orgA.slug]),
    ];
    for (const role of NOT_OWNER) {
      const page = await pageAs(role);
      await page.goto(dash);
      for (const [c, args] of attempts) {
        const text = await replayAction(page, c, args);
        expect(text, `${role} ${c.headers["next-action"]}`).toContain("Only the account owner can manage billing.");
        expect(text).not.toMatch(/"url"|cus_|sub_|price_/);
      }
    }
    // the owner of another team asking about this team learns and changes nothing
    const other = await pageAs("ownerB");
    await other.goto(`/o/${S.orgB.slug}/dashboard`);
    for (const [c, args] of attempts) {
      const text = await replayAction(other, c, args);
      expect(text).not.toMatch(/"url":"http|cus_e2e|sub_mock/);
    }
    const after = await subRow(A());
    expect([after.status, after.extra_locations, after.staff_packs, after.cancel_at_period_end, after.stripe_subscription_id]).toEqual([before.status, before.extra_locations, before.staff_packs, before.cancel_at_period_end, before.stripe_subscription_id]);
    expect(await calls(), "Stripe was not called for any refused request").toBe(stripeBefore);
    await removeExtras(B());
  });
});
