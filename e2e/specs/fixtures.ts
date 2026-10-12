import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { login, S } from "./helpers";

type Role = keyof typeof S.people;

/**
 * `pageAs("ownerA")` gives a fresh page already signed in as that person. Each person signs in once per run
 * (not once per test), which keeps the suite quick.
 */
export const test = base.extend<{ pageAs: (who: Role) => Promise<Page> }, { sessions: Map<Role, BrowserContext> }>({
  sessions: [async ({ browser }, use) => {
    const map = new Map<Role, BrowserContext>();
    await use(map);
    for (const c of map.values()) await c.close();
  }, { scope: "worker" }],
  pageAs: async ({ browser, sessions }, use) => {
    const opened: Page[] = [];
    await use(async (who) => {
      let ctx = sessions.get(who);
      if (!ctx) {
        ctx = await browser.newContext();
        const p = await ctx.newPage();
        await login(p, who);
        await p.close();
        sessions.set(who, ctx);
      }
      const page = await ctx.newPage();
      opened.push(page);
      return page;
    });
    for (const p of opened) await p.close().catch(() => {});
  },
});
export { expect } from "@playwright/test";
