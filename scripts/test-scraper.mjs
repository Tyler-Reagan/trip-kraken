/**
 * Quick end-to-end test of the DOM extraction logic against the live URL.
 * Mirrors exactly what extractFromDOM does in scraper.ts.
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
});
const page = await context.newPage();
await page.goto("https://maps.app.goo.gl/Kd4VoU7hPuidMSx16", { waitUntil: "load", timeout: 60_000 });

// Wait for .fontHeadlineSmall (mirrors scraper logic)
await page.waitForSelector(".fontHeadlineSmall", { timeout: 20_000 }).catch(() => null);
await page.waitForTimeout(2000);

const results = await page.evaluate(() => {
  const found = [];

  document.querySelectorAll(".fontHeadlineSmall").forEach(nameEl => {
    const name = nameEl.textContent?.trim() ?? "";
    if (!name) return;

    let card = nameEl.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!card) break;
      if (card.children.length >= 2) break;
      card = card.parentElement;
    }

    let secondary;
    if (card) {
      const bodyEl = card.querySelector(".fontBodySmall") || card.querySelector(".fontBodyMedium");
      if (bodyEl && bodyEl !== nameEl) {
        secondary = bodyEl.textContent?.trim() || undefined;
      }
    }

    if (!found.some(r => r.name === name)) {
      found.push({ name, address: secondary });
    }
  });

  return found;
});

console.log(`Found ${results.length} places:\n`);
results.forEach((p, i) => console.log(`${i + 1}. ${p.name}${p.address ? ` — ${p.address}` : ""}`));

await browser.close();
