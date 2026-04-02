/**
 * Scrapes a Google Maps shared list URL and extracts place names + addresses.
 *
 * Google Maps is a heavily JS-rendered, continuously-polling SPA — it never
 * reaches "networkidle". We navigate with waitUntil:"load" (fires after the
 * initial HTML + subresources), then explicitly wait for place-card elements
 * to appear before extracting.
 *
 * Extraction strategies (tried in order):
 *   1. Embedded <script> data  — Google bakes the list payload into the page
 *      HTML as window._REQS or AF_initDataCallback blobs. We try to pull
 *      lat/lng + names from there.
 *   2. DOM scraping — wait for place-card elements with stable attributes
 *      (data-place-id, aria-label, role="article") and extract text.
 */

export interface ScrapedPlace {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export async function scrapeGoogleMapsList(
  url: string
): Promise<ScrapedPlace[]> {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // Match a common real-world Chrome UA to reduce bot detection friction
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });

  const page = await context.newPage();

  // -----------------------------------------------------------------------
  // Strategy 1 — intercept XHR/fetch responses that carry list place data
  // -----------------------------------------------------------------------
  const capturedPlaces: ScrapedPlace[] = [];

  page.on("response", async (response) => {
    const respUrl = response.url();
    if (
      respUrl.includes("maps/placelists") ||
      respUrl.includes("place/list") ||
      respUrl.includes("listplaceprovider") ||
      respUrl.includes("listItemsQuery") ||
      // Common internal Maps RPC endpoint
      (respUrl.includes("maps/api/js/") && respUrl.includes("ListItem"))
    ) {
      try {
        const text = await response.text();
        const parsed = parseMapsApiResponse(text);
        if (parsed.length > 0) capturedPlaces.push(...parsed);
      } catch {
        // ignore non-parseable responses
      }
    }
  });

  try {
    // "load" fires when the initial document + all synchronous subresources
    // are ready — well before Google Maps stops making background requests.
    // Use a generous 60-second timeout to handle slow redirects from short URLs.
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });

    // Give the Maps SPA a moment to fire its initial data requests
    await page.waitForTimeout(3_000);

    // Return XHR-captured data if we got any
    if (capturedPlaces.length > 0) {
      return capturedPlaces;
    }

    // -----------------------------------------------------------------------
    // Strategy 2 — extract from data embedded in <script> tags
    // -----------------------------------------------------------------------
    const scriptPlaces = await extractFromScriptTags(page);
    if (scriptPlaces.length > 0) return scriptPlaces;

    // -----------------------------------------------------------------------
    // Strategy 3 — DOM scraping
    // -----------------------------------------------------------------------

    // Google Maps shared-list pages render place names into .fontHeadlineSmall
    // elements (confirmed via live DOM inspection). We wait for at least one to
    // appear, then scroll to load any virtualised tail items.
    const found = await page
      .waitForSelector(".fontHeadlineSmall", { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (!found) {
      await page.waitForTimeout(5_000);
    } else {
      await page.waitForTimeout(2_000);
    }

    // Scroll to trigger lazy rendering of items below the fold
    await scrollListPanel(page);

    const domPlaces = await extractFromDOM(page);
    return domPlaces;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Embedded script-tag extraction
// ---------------------------------------------------------------------------

async function extractFromScriptTags(
  page: import("playwright").Page
): Promise<ScrapedPlace[]> {
  try {
    const blobs: string[] = await page.evaluate(() => {
      // Google Maps serialises page data as one or more JS callback blobs
      // inside inline <script> tags. The most common patterns are:
      //   window.AF_initDataCallback({...})
      //   window._REQS = [...]
      //   )]}'\n[...json...]
      return Array.from(document.querySelectorAll("script:not([src])"))
        .map((s) => s.textContent ?? "")
        .filter(
          (t) =>
            (t.includes('"lat"') || t.includes('"latitude"') || t.includes("\\\"lat\\\"")) &&
            t.length > 500
        );
    });

    for (const blob of blobs) {
      // Pull every lat/lng pair from the blob with a regex sweep — more
      // reliable than trying to parse Google's non-standard serialisation
      const places = extractCoordsFromBlob(blob);
      if (places.length > 0) return places;
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * Uses a regex to find objects that look like { "lat": N, "lng": N, "name": "..." }
 * scattered through a Google Maps script blob.
 */
function extractCoordsFromBlob(blob: string): ScrapedPlace[] {
  const results: ScrapedPlace[] = [];

  // Match latitude/longitude pairs with an optional nearby string (place name)
  // Example: ["Place Name", null, null, [null, lat, lng, ...]]
  // We look for numeric pairs that are plausible coordinates: lat ±90, lng ±180
  const latLngRe = /(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})/g;
  let m: RegExpExecArray | null;

  // Collect all coordinate pairs
  const coords: { lat: number; lng: number; pos: number }[] = [];
  while ((m = latLngRe.exec(blob)) !== null) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      coords.push({ lat, lng, pos: m.index });
    }
  }

  if (coords.length === 0) return [];

  // For each coordinate, look backwards up to 300 chars for a quoted string
  // that is likely the place name
  const nameRe = /"([^"]{3,80})"/g;

  for (const coord of coords) {
    const window = blob.slice(Math.max(0, coord.pos - 300), coord.pos);
    const names: string[] = [];
    let nm: RegExpExecArray | null;
    nameRe.lastIndex = 0;
    while ((nm = nameRe.exec(window)) !== null) {
      const candidate = nm[1];
      // Filter out obvious non-names (URLs, CSS, JS keywords, numeric strings)
      if (
        !candidate.includes("/") &&
        !candidate.includes("\\") &&
        !candidate.includes("function") &&
        !/^\d+$/.test(candidate) &&
        candidate.length >= 3
      ) {
        names.push(candidate);
      }
    }
    // The last qualifying string before the coords is most likely the name
    const name = names.at(-1);
    if (name) {
      results.push({ name, lat: coord.lat, lng: coord.lng });
    }
  }

  // Deduplicate by coordinate
  const seen = new Set<string>();
  return results.filter((p) => {
    const key = `${p.lat!.toFixed(4)},${p.lng!.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// DOM extraction
// ---------------------------------------------------------------------------

async function extractFromDOM(
  page: import("playwright").Page
): Promise<ScrapedPlace[]> {
  return page.evaluate(() => {
    const results: Array<{ name: string; address?: string }> = [];

    function addIfNew(name: string, address?: string) {
      name = name.trim();
      if (!name || name.length < 2) return;
      if (results.some((r) => r.name === name)) return;
      results.push({ name, address: address?.trim() || undefined });
    }

    // -- Primary: .fontHeadlineSmall holds place names in shared-list pages --
    // The card container is the nearest ancestor with ≥2 children. The
    // sibling text node next to the name contains rating + category
    // (e.g. "4.24-star hotel") which we use as the address hint for geocoding.
    document.querySelectorAll(".fontHeadlineSmall").forEach((nameEl) => {
      const name = nameEl.textContent?.trim() ?? "";
      if (!name) return;

      // Walk up to the card root
      let card: Element | null = nameEl.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!card) break;
        if (card.children.length >= 2) break;
        card = card.parentElement;
      }

      // Extract secondary text from the card (category / rating line)
      let secondary: string | undefined;
      if (card) {
        const bodyEl =
          card.querySelector(".fontBodySmall") ||
          card.querySelector(".fontBodyMedium");
        if (bodyEl && bodyEl !== nameEl) {
          secondary = bodyEl.textContent?.trim() || undefined;
        }
      }

      addIfNew(name, secondary);
    });

    if (results.length > 0) return results;

    // -- Fallback: aria-label / role="article" (search results, other views) --
    document
      .querySelectorAll('[role="article"], [role="listitem"], [data-place-id]')
      .forEach((el) => {
        if (el.closest("header") || el.closest("nav")) return;
        const label = el.getAttribute("aria-label");
        if (label && label.length >= 3) {
          addIfNew(label);
          return;
        }
        const lines = (el.textContent ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines[0] && lines[0].length >= 3) {
          addIfNew(lines[0], lines[1]);
        }
      });

    return results;
  });
}

// ---------------------------------------------------------------------------
// Panel scrolling helper
// ---------------------------------------------------------------------------

async function scrollListPanel(page: import("playwright").Page) {
  try {
    await page.evaluate(async () => {
      // The list panel in Google Maps is a scrollable div — not the window
      const scrollable = document.querySelector<HTMLElement>(
        '[role="main"] [tabindex="-1"], .m6QErb[tabindex="-1"], [data-scroll-top]'
      );
      const target = scrollable ?? document.documentElement;
      for (let i = 0; i < 8; i++) {
        target.scrollBy(0, 400);
        await new Promise((r) => setTimeout(r, 300));
      }
    });
    await page.waitForTimeout(1_000);
  } catch {
    // scrolling failure is non-fatal
  }
}

// ---------------------------------------------------------------------------
// Network response parsing (XSSI-wrapped JSON)
// ---------------------------------------------------------------------------

function parseMapsApiResponse(text: string): ScrapedPlace[] {
  const stripped = text.replace(/^\)\]\}'\n?/, "").trim();
  if (!stripped.startsWith("[") && !stripped.startsWith("{")) return [];
  try {
    const json = JSON.parse(stripped);
    return extractPlacesFromJson(json);
  } catch {
    return [];
  }
}

function extractPlacesFromJson(json: unknown): ScrapedPlace[] {
  const results: ScrapedPlace[] = [];

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.name === "string" && obj.name.length > 0) {
      const place: ScrapedPlace = { name: obj.name };
      if (typeof obj.address === "string") place.address = obj.address;
      if (typeof obj.lat === "number" && typeof obj.lng === "number") {
        place.lat = obj.lat;
        place.lng = obj.lng;
      }
      results.push(place);
    }
    Object.values(obj).forEach(walk);
  }

  walk(json);
  return results;
}
