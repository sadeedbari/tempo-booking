import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { S, login, logout, watchErrors } from "./helpers";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PASSWORD = "E2e-Invitee-Pass-7!x";

test.describe("accepting an invitation", () => {
  test("the invited person signs in, accepts, and lands in the team; the link can't be reused", async ({ browser }) => {
    const sb = admin();
    const email = "e2e.invitee.ui@tempo-e2e.test";
    await sb.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "Ivy Invitee" } });
    const { data: inv } = await sb.from("invitations").insert({ org_id: S.orgA.id, email, role: "member" }).select("token").single();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const w = watchErrors(page);
    // signed out: asked to create an account or sign in, with the right address shown
    await page.goto(`/invite/${inv!.token}`);
    await expect(page.getByRole("heading", { name: "Join E2E Salon" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("link", { name: "I already have an account" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(new RegExp(`/invite/${inv!.token}`));
    await page.getByRole("button", { name: /Join|Accept/ }).click();
    await page.waitForURL(/\/o\/e2e-salon/);
    const { data: m } = await sb.from("memberships").select("role, display_name").eq("org_id", S.orgA.id).eq("user_id", (await sb.auth.admin.listUsers()).data.users.find((u) => u.email === email)!.id).single();
    expect(m!.role).toBe("member");
    // the same link a second time is a polite dead end
    await page.goto(`/invite/${inv!.token}`);
    await expect(page.getByRole("heading", { name: "Invitation expired" })).toBeVisible();
    w.assertNone();
    await ctx.close();
  });

  test("someone signed in as a different person is told which address the invite is for", async ({ pageAs }) => {
    const sb = admin();
    const { data: inv } = await sb.from("invitations").insert({ org_id: S.orgA.id, email: "someone.else@tempo-e2e.test", role: "member" }).select("token").single();
    const page = await pageAs("stranger");
    await page.goto(`/invite/${inv!.token}`);
    await expect(page.getByText(/This invite is for someone.else@tempo-e2e.test/)).toBeVisible();
  });

  test("expired and made-up invitation links explain themselves", async ({ page }) => {
    const sb = admin();
    const { data: inv } = await sb.from("invitations").insert({ org_id: S.orgA.id, email: "old@tempo-e2e.test", role: "member", expires_at: new Date(Date.now() - 1000).toISOString() }).select("token").single();
    for (const t of [inv!.token, "nonsense", "x".repeat(300)]) {
      await page.goto(`/invite/${t}`);
      await expect(page.getByRole("heading", { name: "Invitation expired" })).toBeVisible();
    }
  });
});

test.describe("forgot password", () => {
  test("the form checks the address and never reveals whether an account exists", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page).toHaveURL(/\/forgot/); // the browser's own check
    await page.getByLabel("Email").fill("nobody.at.all@tempo-e2e.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/If there.s an account for nobody.at.all@tempo-e2e.test/)).toBeVisible();
  });

  test("the reset page without a valid link says it expired, and offers a new one", async ({ page }) => {
    await page.goto("/reset");
    await expect(page.getByRole("heading", { name: "That link has expired" })).toBeVisible();
    await page.getByRole("link", { name: "Send a new link" }).click();
    await expect(page).toHaveURL(/\/forgot/);
    await page.goto("/auth/callback?code=garbage&next=/reset");
    await expect(page).toHaveURL(/\/login\?error=link/);
    await expect(page.getByText(/link has expired/i)).toBeVisible();
  });

  test("a signed-in person can choose a new password, with the two boxes checked", async ({ browser }) => {
    const sb = admin();
    const email = "e2e.resetter@tempo-e2e.test";
    await sb.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto("/reset");
    await page.getByLabel("New password").fill("short");
    await page.getByLabel("Type it again").fill("short");
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page).toHaveURL(/\/reset/);
    await page.getByLabel("New password").fill("A-Brand-New-Pass-5!z");
    await page.getByLabel("Type it again").fill("A-Different-Pass-5!z");
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText(/don.t match/i)).toBeVisible();
    await page.getByLabel("New password").fill("A-Brand-New-Pass-5!z"); // the form clears itself after an error
    await page.getByLabel("Type it again").fill("A-Brand-New-Pass-5!z");
    await page.getByRole("button", { name: "Save password" }).click();
    await page.waitForURL(/\/(app|onboarding|o\/)/, { timeout: 20000 });
    await ctx.close();
    // the new password works, the old one doesn't
    const c2 = await (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    expect((await c2.auth.signInWithPassword({ email, password: "A-Brand-New-Pass-5!z" })).error).toBeNull();
    expect((await c2.auth.signInWithPassword({ email, password: PASSWORD })).error).not.toBeNull();
  });
});

test.describe("signing up", () => {
  test("the sign-up form explains a rate limit or a problem in plain words", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("E2E Signup");
    await page.getByLabel("Email").fill("e2e.signup.attempt@tempo-e2e.test");
    await page.getByLabel("Password").fill("A-Long-Enough-Pass-1!");
    await page.getByRole("button", { name: /create account/i }).click();
    // either the confirmation message (email sent) or a readable explanation; never a raw error code
    await expect(page.locator("form, div").filter({ hasText: /confirmation link|wait a few minutes|already exists|too many|couldn.t reach/i }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("body")).not.toContainText(/over_email_send_rate_limit|AuthApiError|email rate limit exceeded/);
  });
});
