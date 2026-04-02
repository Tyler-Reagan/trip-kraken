/**
 * Debug script — run with:
 *   npx tsx scripts/debug-scraper.ts <url>
 *
 * Saves screenshot.png and page.html to the project root so you can inspect
 * what Playwright actually sees when it opens the URL.
 */
import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { resolve } from "path";

const url = process.argv[2] ?? "https://maps.app.goo.gl/Kd4VoU7hPuidMSx16";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });

  const page = await context.newPage();

  const requests: string[] = [];
  page.on("request", (req) => {
    if (!req.url().includes("maps.gstatic") && !req.url().includes("fonts.g")) {
      requests.push(`${req.method()} ${req.url()}`);
    }
  });

  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  console.log("load event fired, final URL:", page.url());

  await page.waitForTimeout(5_000);

  // Screenshot
  const screenshotPath = resolve("debug-screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log("Screenshot saved:", screenshotPath);

  // HTML
  const html = await page.content();
  const htmlPath = resolve("debug-page.html");
  writeFileSync(htmlPath, html);
  console.log("HTML saved:", htmlPath, `(${(html.length / 1024).toFixed(0)} KB)`);

  // Selector probe
  const probes: Record<string, number> = {
    "[data-place-id]": await page.locator("[data-place-id]").count(),
    "[data-cid]": await page.locator("[data-cid]").count(),
    '[role="article"]': await page.locator('[role="article"]').count(),
    '[role="listitem"]': await page.locator('[role="listitem"]').count(),
    "[jsaction]": await page.locator("[jsaction]").count(),
    ".fontHeadlineSmall": await page.locator(".fontHeadlineSmall").count(),
    "script:not([src])": (await page.$$("script:not([src])")).length,
  };

  console.log("\nSelector counts:");
  for (const [sel, count] of Object.entries(probes)) {
    console.log(`  ${sel.padEnd(30)} ${count}`);
  }

  // First visible text lines
  const bodyText = await page.evaluate(() =>
    document.body.innerText.split("\n").filter((l) => l.trim().length > 2).slice(0, 30)
  );
  console.log("\nFirst 30 non-empty text lines on page:");
  bodyText.forEach((l) => console.log(" ", l.trim()));

  // Any inline script content hints
  const scriptHints = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script:not([src])"))
      .map((s) => s.textContent?.slice(0, 200) ?? "")
      .filter((t) => t.includes("lat") || t.includes("name"))
      .slice(0, 3)
  );
  console.log(`\n${scriptHints.length} script tags containing 'lat' or 'name':`);
  scriptHints.forEach((s, i) => console.log(`  [${i}] ${s.slice(0, 150)}…`));

  console.log(`\nTotal requests made: ${requests.length}`);
  console.log("Last 10 requests:");
  requests.slice(-10).forEach((r) => console.log(" ", r.slice(0, 120)));

  await browser.close();
}

main().catch(console.error);
