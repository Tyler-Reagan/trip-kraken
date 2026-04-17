/**
 * Tabelog scraper — TypeScript adapter modeled after the Python gurume reference.
 * https://github.com/narumiruna/gurume
 *
 * ⚠️  Internal use only. Tabelog's Terms of Service likely prohibit scraping.
 *     Use a ≥2s delay between requests (enforced by this module).
 *     Respect robots.txt: do not fetch /rvwr/, /yoyaku/, or /btb/ paths.
 *
 * Data returned maps to NearbyPlace so it slots into the existing nearby search
 * infrastructure without type changes. Coordinates are null — Tabelog listing
 * pages do not expose lat/lng. Run enrichment after adding a Tabelog result to
 * populate coordinates via Google Text Search.
 */

import * as cheerio from "cheerio";
import type { NearbyPlace } from "@/types";

// ─── Prefecture centroid lookup ───────────────────────────────────────────────
// Approximate centroid [lat, lng] for each of Japan's 47 prefectures.
// Used to map an arbitrary coordinate to the correct Tabelog prefecture slug.
const PREFECTURE_CENTROIDS: [string, number, number][] = [
  ["hokkaido",   43.46, 142.83],
  ["aomori",     40.64,  140.87],
  ["iwate",      39.70,  141.15],
  ["miyagi",     38.27,  140.87],
  ["akita",      39.72,  140.10],
  ["yamagata",   38.24,  140.36],
  ["fukushima",  37.36,  140.47],
  ["ibaraki",    36.34,  140.45],
  ["tochigi",    36.57,  139.88],
  ["gunma",      36.39,  139.06],
  ["saitama",    35.86,  139.65],
  ["chiba",      35.61,  140.12],
  ["tokyo",      35.69,  139.69],
  ["kanagawa",   35.45,  139.64],
  ["niigata",    37.35,  138.87],
  ["toyama",     36.70,  137.21],
  ["ishikawa",   36.59,  136.63],
  ["fukui",      35.90,  136.22],
  ["yamanashi",  35.66,  138.57],
  ["nagano",     36.65,  138.18],
  ["shizuoka",   35.00,  138.38],
  ["aichi",      35.18,  137.15],
  ["mie",        34.73,  136.51],
  ["shiga",      35.00,  136.22],
  ["kyoto",      35.21,  135.73],
  ["osaka",      34.69,  135.52],
  ["hyogo",      34.91,  134.82],
  ["nara",       34.39,  135.84],
  ["wakayama",   33.94,  135.47],
  ["tottori",    35.36,  133.83],
  ["shimane",    35.47,  132.97],
  ["okayama",    34.97,  133.72],
  ["hiroshima",  34.40,  132.46],
  ["yamaguchi",  34.19,  131.47],
  ["tokushima",  33.94,  134.34],
  ["kagawa",     34.27,  134.05],
  ["ehime",      33.84,  132.77],
  ["kochi",      33.56,  133.53],
  ["fukuoka",    33.57,  130.97],
  ["saga",       33.31,  130.30],
  ["nagasaki",   32.94,  129.87],
  ["kumamoto",   32.79,  130.74],
  ["oita",       33.24,  131.61],
  ["miyazaki",   31.91,  131.42],
  ["kagoshima",  31.56,  130.56],
  ["okinawa",    26.21,  127.68],
];

/**
 * Return the Tabelog prefecture slug closest to the given coordinates.
 * Uses simple Euclidean distance on lat/lng — sufficient for picking a prefecture
 * since we only need the nearest centroid, not exact boundary detection.
 */
function nearestPrefecture(lat: number, lng: number): string {
  let best = PREFECTURE_CENTROIDS[0];
  let bestDist = Infinity;
  for (const entry of PREFECTURE_CENTROIDS) {
    const dlat = entry[1] - lat;
    const dlng = entry[2] - lng;
    const dist = dlat * dlat + dlng * dlng;
    if (dist < bestDist) { bestDist = dist; best = entry; }
  }
  return best[0];
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

let lastRequestMs = 0;

async function tabelogFetch(url: string): Promise<string> {
  const gap = Date.now() - lastRequestMs;
  if (gap < 2000) await new Promise((r) => setTimeout(r, 2000 - gap));
  lastRequestMs = Date.now();

  console.log("[tabelog] fetching:", url);

  const res = await fetch(url, {
    cache: "no-store", // prevent Next.js fetch cache from returning stale HTML
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  console.log("[tabelog] response status:", res.status, res.url);
  if (!res.ok) throw new Error(`Tabelog HTTP ${res.status} for ${url}`);
  const html = await res.text();
  // Log first result name to quickly verify location relevance
  const firstMatch = html.match(/list-rst__rst-name-target[^>]*>([^<]+)</);
  console.log("[tabelog] first result name:", firstMatch?.[1]?.trim() ?? "(none parsed)");
  console.log("[tabelog] .list-rst count:", (html.match(/class="list-rst"/g) ?? []).length);
  return html;
}

// ─── Field helpers ────────────────────────────────────────────────────────────

/**
 * Extract the 8-digit Tabelog restaurant ID from a detail URL.
 * e.g. "/en/tokyo/A1301/A130101/13305528/" → "13305528"
 */
function extractTabelogId(href: string): string | null {
  const m = href.match(/\/(\d{8})\/?(?:[?#]|$)/);
  return m ? m[1] : null;
}

/**
 * Map Tabelog budget string (e.g. "JPY 8,000 - JPY 9,999") to a 0–4 price level.
 * Uses the lower bound of the range as the reference price.
 */
function budgetToPriceLevel(budget: string | null): number | null {
  if (!budget) return null;
  const match = budget.match(/[\d,]+/);
  if (!match) return null;
  const yen = parseInt(match[0].replace(/,/g, ""), 10);
  if (isNaN(yen)) return null;
  if (yen < 1000)  return 0;
  if (yen < 3000)  return 1;
  if (yen < 6000)  return 2;
  if (yen < 15000) return 3;
  return 4;
}

/**
 * Parse genres from the cuisine portion of the area/genre text cell.
 * Expects only the text after the "/" separator (e.g. "Yakiniku, Sushi, Izakaya").
 * Tabelog also uses the Japanese comma 「、」 in Japanese-locale pages.
 */
function parseGenres(text: string): string[] {
  return text
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ─── HTML parser ─────────────────────────────────────────────────────────────

function parseRestaurants(html: string): NearbyPlace[] {
  const $ = cheerio.load(html);
  const results: NearbyPlace[] = [];

  $(".list-rst").each((_i, el) => {
    try {
      const container = $(el);

      // Name + URL
      const nameEl = container.find("a.list-rst__rst-name-target").first();
      const name = nameEl.text().trim();
      const href = nameEl.attr("href") ?? "";
      if (!name) return;

      const id = extractTabelogId(href);
      if (!id) return;
      const placeId = `tabelog:${id}`;

      // Rating
      const ratingText = container.find("span.c-rating__val").first().text().trim();
      const rating = ratingText ? parseFloat(ratingText) : null;

      // Review count
      const reviewText = container.find("em.list-rst__rvw-count-num").first().text().trim();
      const reviewCount = reviewText ? parseInt(reviewText.replace(/,/g, ""), 10) : null;

      // Area/genre cell format: "Station Xm / Genre1, Genre2, ..."
      const areaGenreText = container.find("div.list-rst__area-genre, span.list-rst__area-genre").first().text().trim();
      const slashIdx = areaGenreText.search(/[/／]/);
      const address = (slashIdx > -1 ? areaGenreText.slice(0, slashIdx) : areaGenreText).trim();
      const genreRaw = slashIdx > -1 ? areaGenreText.slice(slashIdx + 1) : "";
      const categories = parseGenres(genreRaw);

      // Station distance: "Shimbashi Sta. 337m" → 337
      const mMatch = address.match(/(\d+)m$/);
      const distanceMeters = mMatch ? parseInt(mMatch[1], 10) : null;

      // Budget → price level. Dinner icon sibling is the discriminator; fall back
      // to first price span if no dinner entry is present.
      const dinnerIcon = container.find("i.c-rating-v3__time--dinner");
      const dinnerBudget = dinnerIcon.length
        ? dinnerIcon.closest("li").find("span.c-rating-v3__val").text().trim() || null
        : container.find("span.c-rating-v3__val").first().text().trim() || null;
      const priceLevel = budgetToPriceLevel(dinnerBudget);

      results.push({
        placeId,
        name,
        address,
        lat: null,   // Tabelog listings do not expose coordinates
        lng: null,
        rating: rating !== null && !isNaN(rating) ? rating : null,
        reviewCount: reviewCount !== null && !isNaN(reviewCount) ? reviewCount : null,
        categories,
        priceLevel,
        distanceMeters,
        detailUrl: href || undefined,
      });
    } catch {
      // Skip malformed entries silently
    }
  });

  return results;
}

// ─── Sort tab mapping ─────────────────────────────────────────────────────────

// Live-probed from #rstlst-sort ul li[href] on tabelog.com/en.
// "trend" (travellers) is the default when SrtT is omitted.
const SRT_T: Partial<Record<TabelogSort, string>> = {
  "trend-jp": "inbound_vacancy_net_yoyaku",
  "access":   "inbound_access",
  "rank":     "rt",
};

type TabelogSort = "trend" | "trend-jp" | "access" | "rank";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search Tabelog for restaurants near the given coordinates.
 *
 * @param lat     Anchor latitude  (WGS84)
 * @param lng     Anchor longitude (WGS84)
 * @param opts    keyword  — `sk` filter (restaurant name or cuisine type)
 *                limit    — max results returned from the parsed page (default 20, cap 30)
 *                sort     — result ordering tab (default "trend-jp": most reserved by locals)
 *                           "trend"    most reserved by travellers
 *                           "trend-jp" most reserved by locals  ← default
 *                           "access"   most viewed
 *                           "rank"     highest rated
 *
 * Key URL parameters:
 *   Srt=D        activates the reservation-sort family; required for all four tabs
 *   SrtT         selects the sub-sort within Srt=D; omit for "trend" (travellers default)
 *   Sokuchi=WGS  declare WGS84 coordinate system so Tabelog interprets lat/lng correctly
 *   LstCount     results per page
 *
 * Results have null lat/lng. Add to trip and run Enrich to populate coordinates
 * via Google Text Search cross-referencing.
 */
export async function searchTabelog(
  lat: number,
  lng: number,
  opts: { keyword?: string; limit?: number; sort?: TabelogSort } = {}
): Promise<NearbyPlace[]> {
  try {
    const limit = Math.min(opts.limit ?? 20, 30);
    const sort  = opts.sort ?? "trend-jp";

    const prefecture = nearestPrefecture(lat, lng);
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      Srt: "D",
      Sokuchi: "WGS",
      LstCount: String(limit),
    });
    const srtT = SRT_T[sort];
    if (srtT) params.set("SrtT", srtT);
    if (opts.keyword?.trim()) params.set("sk", opts.keyword.trim());

    // Prefecture-scoped path is required for location-relevant results.
    // The national /en/rstLst/ URL ignores lat/lng even with Srt=D.
    const url = `https://tabelog.com/en/${prefecture}/rstLst/?${params}`;
    const html = await tabelogFetch(url);
    return parseRestaurants(html);
  } catch (err) {
    // Scraping failures are soft — return empty rather than surfacing as 500
    console.error("[tabelog] search failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Fetch the street address from a Tabelog restaurant detail page.
 * The address lives in the 5th row of #rst-data-head > table.
 * Returns null on any failure (network error, selector miss, rate-limited).
 */
export async function fetchTabelogAddress(detailHref: string): Promise<string | null> {
  try {
    const html = await tabelogFetch(detailHref);
    const $ = cheerio.load(html);
    const addr = $("#rst-data-head > table > tbody > tr:nth-child(5) > td").text().trim();
    return addr || null;
  } catch (err) {
    console.error("[tabelog] address fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Enrich a list of NearbyPlaces by replacing each Tabelog result's station-area
 * address with the actual street address from its detail page.
 *
 * Fetches are sequential and rate-limited (≥2s each via tabelogFetch).
 * Non-Tabelog places and places without a detailUrl pass through unchanged.
 * Never throws.
 */
export async function enrichTabelogAddresses(places: NearbyPlace[]): Promise<NearbyPlace[]> {
  const enriched: NearbyPlace[] = [];
  for (const place of places) {
    if (!place.detailUrl || !place.placeId.startsWith("tabelog:")) {
      enriched.push(place);
      continue;
    }
    const street = await fetchTabelogAddress(place.detailUrl);
    enriched.push(street ? { ...place, address: street } : place);
  }
  return enriched;
}
