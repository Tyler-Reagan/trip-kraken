import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
});
const page = await context.newPage();
await page.goto("https://maps.app.goo.gl/Kd4VoU7hPuidMSx16", { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(3000);

const data = await page.evaluate(() => {
  const els = document.querySelectorAll(".fontHeadlineSmall");
  return Array.from(els).map(el => {
    // Walk up to find a card container (first ancestor with multiple children)
    let card = el.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!card) break;
      if (card.children.length >= 2) break;
      card = card.parentElement;
    }
    card = card || el;

    const allText = Array.from(card.querySelectorAll("*"))
      .map(e => e.textContent?.trim())
      .filter(t => t && t.length > 1)
      .filter((t, i, arr) => arr.indexOf(t) === i) // unique
      .slice(0, 6);

    return {
      name: el.textContent?.trim(),
      cardTag: card.tagName,
      cardClasses: Array.from(card.classList).slice(0, 5),
      cardChildCount: card.children.length,
      allUniqueText: allText,
      hasDataAttrs: Object.keys(card.dataset),
      jsaction: card.getAttribute("jsaction")?.slice(0, 100) ?? "(none)",
    };
  });
});

for (const d of data) {
  console.log("---");
  console.log("Name:", d.name);
  console.log("Card:", d.cardTag, d.cardClasses.join("."), `(${d.cardChildCount} children)`);
  console.log("data-*:", d.hasDataAttrs);
  console.log("jsaction:", d.jsaction);
  console.log("All text:", d.allUniqueText);
}

await browser.close();
