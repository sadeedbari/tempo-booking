// Renders scripts/og-image.html to src/app/opengraph-image.png (1200x630) and copies it to twitter-image.png.
// Run: node scripts/build-og-image.mjs   (uses the Playwright Chromium already installed for the e2e tests; no network)
import { chromium } from "@playwright/test";
import { copyFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(root, "scripts", "og-image.html");
const out = path.join(root, "src", "app", "opengraph-image.png");
const MAX_BYTES = 300 * 1024;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(html).href);
  await page.evaluate(() => document.fonts.ready);
  let png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
  // Optional: sharp ships with Next.js; if present, a palette PNG is much smaller than the gradient's truecolour one.
  try {
    const { default: sharp } = await import("sharp");
    png = await sharp(png).png({ palette: true, quality: 90, effort: 10, dither: 1.0 }).toBuffer();
  } catch { /* keep the plain screenshot */ }
  await writeFile(out, png);
} finally {
  await browser.close();
}
await copyFile(out, path.join(root, "src", "app", "twitter-image.png"));
const size = (await stat(out)).size;
console.log(`opengraph-image.png: ${size} bytes`);
if (size > MAX_BYTES) { console.error("Image is over 300 KB"); process.exit(1); }
