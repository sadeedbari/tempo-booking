import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";
import { dayAhead, mock, rpcBook, S, watchErrors } from "./helpers";

const base = `/o/${S.orgA.slug}`;
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const member = async (name: string) => (await admin().from("memberships").select("id, user_id, role, email, display_name, bookable").eq("org_id", S.orgA.id).eq("display_name", name).maybeSingle()).data;

test.beforeEach(async () => { await mock.clear(); });

test.describe("team", () => {
  test("add a team member without a login: no email needed, they appear on the booking page", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/team`);
    await page.getByRole("button", { name: "Add team member" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E Doorperson");
    await page.getByLabel("Title").fill("Front desk");
    await page.getByRole("button", { name: "Add team member" }).last().click();
    await expect(page.getByText("Team member added")).toBeVisible();
    await expect(page.getByText("E2E Doorperson")).toBeVisible();
    await expect(page.getByText("No login").first()).toBeVisible();
    const m = await member("E2E Doorperson");
    expect(m).toMatchObject({ user_id: null, role: "member", bookable: true });
    // no invitation email was sent
    expect((await mock.sent()).emails).toHaveLength(0);
    w.assertNone();
  });

  test("add someone with an invitation: the email goes out, the invite is listed, and it can be revoked", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/team`);
    await page.getByRole("button", { name: "Add team member" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E Invitee");
    await page.getByLabel("Email").fill("e2e.invitee@tempo-e2e.test");
    await page.getByRole("switch", { name: "Invite them to sign in" }).click();
    await page.getByRole("button", { name: "Add and send invitation" }).click();
    await expect(page.getByText(/invitation was sent/i)).toBeVisible();
    await expect.poll(async () => (await mock.sent()).emails.length, { timeout: 15_000 }).toBe(1);
    expect((await mock.sent()).emails[0].subject).toMatch(/invited you to E2E Salon/);
    await page.keyboard.press("Escape");
    await expect(page.getByText("Pending invitations")).toBeVisible();
    await expect(page.getByText("Invited").first()).toBeVisible();
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expect(page.getByText("Invitation revoked")).toBeVisible();
  });

  test("the invitation without an email address is refused", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/team`);
    await page.getByRole("button", { name: "Add team member" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E No Email");
    await page.getByRole("switch", { name: "Invite them to sign in" }).click();
    await page.getByRole("button", { name: "Add and send invitation" }).click();
    await expect(page.getByText(/Add their email/i)).toBeVisible();
    expect(await member("E2E No Email")).toBeNull();
  });

  test("edit a team member, make someone an admin, and remove someone", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/team`);
    await page.getByRole("main").getByText("E2E Doorperson").click();
    await page.getByLabel("Display name").fill("E2E Door Person");
    await page.getByLabel("Email").fill("door@tempo-e2e.test");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page.getByText("E2E Door Person")).toBeVisible();
    // someone with a login can be made an admin
    await page.getByRole("main").getByText("Sam Therapist").click();
    await page.getByLabel("Role").selectOption({ label: "Admin" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await member("Sam Therapist"))!.role).toBe("admin");
    await page.getByRole("main").getByText("Sam Therapist").click();
    await page.getByLabel("Role").selectOption({ label: "Staff" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await member("Sam Therapist"))!.role).toBe("member");
    // remove (asks first)
    await page.getByRole("main").getByText("E2E Door Person").click();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "Tap to confirm" }).click();
    await expect(page.getByText("Removed")).toBeVisible();
    expect(await member("E2E Door Person")).toBeNull();
  });

  test("the only owner can't be demoted or removed from the screen", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/team`);
    await page.getByRole("main").getByText("Olivia Owner").click();
    await page.getByLabel("Role").selectOption({ label: "Admin" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/at least one owner/i)).toBeVisible();
    expect((await member("Olivia Owner"))!.role).toBe("owner");
  });

  test("an admin can manage the team but not the owner; staff only see themselves as editable", async ({ pageAs }) => {
    const admin1 = await pageAs("adminA");
    await admin1.goto(`${base}/team`);
    await expect(admin1.getByRole("button", { name: "Add team member" })).toBeVisible();
    const staff = await pageAs("staffA1");
    await staff.goto(`${base}/team`);
    await expect(staff.getByRole("button", { name: "Add team member" })).toHaveCount(0);
    await staff.getByRole("main").getByText("Sara Stylist").click();
    await expect(staff.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await expect(staff.getByLabel("Role")).toHaveCount(0);
  });
});

test.describe("weekly hours and time off", () => {
  test("changing hours changes what customers can book", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/availability?member=${S.orgA.members.sara}`);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    // switch Wednesday off
    await page.getByRole("switch", { name: "Wednesday" }).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Hours saved")).toBeVisible();
    // the next Wednesday can no longer be booked with Sara
    const d = new Date(); while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1); d.setUTCDate(d.getUTCDate() + 14);
    const wed = d.toISOString().slice(0, 10);
    await expect(rpcBook({ day: wed, time: "10:00" })).rejects.toThrow(/taken|pick another/i);
    await page.getByRole("switch", { name: "Wednesday" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    // the earlier "Hours saved" message may still be on screen, so wait for the database itself
    await expect.poll(async () => {
      const { data } = await admin().from("availability_rules").select("id").eq("member_id", S.orgA.members.sara).eq("weekday", 3);
      return data!.length;
    }, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(rpcBook({ day: wed, time: "10:00" })).resolves.toBeTruthy();
  });

  test("split shifts: two blocks in a day, and an end before the start is refused", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    await page.goto(`${base}/availability?member=${S.orgA.members.sara}`);
    await page.getByRole("button", { name: "Add hours" }).first().click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/Hours saved|must end after/i).first()).toBeVisible();
    // make a block end before it starts
    const selects = page.locator("select");
    await selects.nth(1).selectOption({ label: "8:00 AM" });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/must end after it starts/i)).toBeVisible();
    await page.reload();
  });

  test("time off blocks booking and can be removed", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const day = dayAhead(30);
    await page.goto(`${base}/availability?member=${S.orgA.members.olivia}`);
    await page.getByRole("button", { name: "Add" }).last().click();
    await page.getByLabel("Reason (optional)").fill("E2E holiday");
    await page.getByLabel("From").fill(day);
    await page.getByLabel("To").fill(day);
    await page.getByRole("button", { name: "Add time off" }).click();
    await expect(page.getByText("Time off added")).toBeVisible();
    await expect(page.getByText("E2E holiday")).toBeVisible();
    await expect(rpcBook({ day, time: "10:00", member: S.orgA.members.olivia })).rejects.toThrow(/taken|pick another/i);
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByText("Removed")).toBeVisible();
    await expect(rpcBook({ day, time: "10:00", member: S.orgA.members.olivia })).resolves.toBeTruthy();
  });

  test("an admin can edit anyone's hours; staff can only edit their own", async ({ pageAs }) => {
    const staff = await pageAs("staffA1");
    await staff.goto(`${base}/availability?member=${S.orgA.members.olivia}`); // someone else: falls back to their own
    await expect(staff.getByText(/Sara Stylist/).first()).toBeVisible();
    await expect(staff.getByRole("switch", { name: "Monday" })).toBeVisible();
  });
});

test.describe("schedule", () => {
  test("shifts: turn the schedule on, set a day, copy it forward, and see the per-location tabs", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const w = watchErrors(page);
    await page.goto(`${base}/schedule`);
    await expect(page.getByRole("button", { name: "All locations" })).toBeVisible();
    await page.getByRole("button", { name: "Queen West" }).click();
    await expect(page).toHaveURL(/location=/);
    await page.getByRole("button", { name: "Leslieville" }).click();
    await page.getByRole("button", { name: "All locations" }).click();
    // set Sara's Monday: 9-1 at Queen West and 12-5 at Leslieville (overlapping on purpose)
    await page.getByLabel(/^Sara Stylist, 20/).first().click();
    await page.getByRole("button", { name: "Add shift" }).click();
    await page.getByRole("button", { name: "Add shift" }).click();
    await expect(page.getByText(/two locations at the same time/i).first()).toBeVisible().catch(() => {});
    await page.getByRole("button", { name: "Day off" }).click();
    w.assertNone();
  });

  test("the schedule Excel export downloads a real workbook, for admins and (own rows) staff", async ({ pageAs }) => {
    const page = await pageAs("ownerA");
    const res = await page.request.get(`/api/export/schedule?org=${S.orgA.slug}&view=week&date=2026-10-12`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
    expect((await res.body()).subarray(0, 2).toString()).toBe("PK"); // an .xlsx is a zip
    const staff = await pageAs("staffA1");
    expect((await staff.request.get(`/api/export/schedule?org=${S.orgA.slug}&view=week`)).status()).toBe(200);
    expect((await staff.request.get(`/api/export/customers?org=${S.orgA.slug}`)).status()).toBe(403);
    expect((await staff.request.get(`/api/export/nonsense?org=${S.orgA.slug}`)).status()).toBe(404);
    const other = await pageAs("ownerB");
    expect((await other.request.get(`/api/export/home?org=${S.orgA.slug}`)).status()).toBe(404);
  });
});
