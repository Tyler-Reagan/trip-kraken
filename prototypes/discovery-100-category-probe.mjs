// PROTOTYPE — throwaway (issue #100). Not wired into product paths; kept as a
// primary-source artifact on branch proto/discovery-100-category only.
// Assesses Google Places for category-based discovery.
// Empirically answers: does freeform category lookup return specific-enough results,
// and does Google support "category X along a route" natively?
// Run: node discovery-100-category-probe.mjs   (reads GOOGLE_MAPS_API_KEY from repo .env.local)
//
// VERDICT (2026-07-11, confirmed with user): INTEGRATE, both primitives.
//  A) Freeform category lookup — Google Text Search is strong across easy→hard
//     categories (kissaten, heritage-denim/Minamihorie, natural-wine, third-wave
//     roasters all on-target). The "category-taxonomy" fear is a free-text-query
//     problem, not a type-taxonomy problem; Google's text ranking absorbs it.
//     Wrinkle: Places API (New) returned ZERO on some phrasings ("art museum in
//     Osaka", "natural wine bar Tokyo") where legacy succeeded — New is stricter.
//  B) Along-route — native via Places(New) searchAlongRouteParameters + a Routes
//     API polyline. No bespoke corridor logic needed. Detour-ranked; clusters at
//     dense origin ends (validate ranking spread before shipping).

import { readFileSync } from "node:fs";

// ── load key from repo .env.local ────────────────────────────────────────────
const ENV_PATH = "/Users/tylerreagan/Projects/trip-kraken/.env.local";
const KEY = readFileSync(ENV_PATH, "utf8")
  .split("\n")
  .find((l) => l.startsWith("GOOGLE_MAPS_API_KEY="))
  ?.split("=")[1]
  ?.trim()
  ?.replace(/^["']|["']$/g, "");
if (!KEY) throw new Error("no key");

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// ── legacy Text Search (what the codebase uses today) ────────────────────────
async function legacyText(query) {
  const u = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  u.searchParams.set("query", query);
  u.searchParams.set("key", KEY);
  const r = await fetch(u);
  const d = await r.json();
  if (d.status !== "OK" && d.status !== "ZERO_RESULTS")
    return { err: d.status + " " + (d.error_message ?? "") };
  return {
    results: (d.results ?? []).slice(0, 5).map((x) => ({
      name: x.name,
      types: (x.types ?? []).filter((t) => t !== "point_of_interest" && t !== "establishment").slice(0, 3),
      rating: x.rating ?? null,
      reviews: x.user_ratings_total ?? null,
      addr: x.formatted_address ?? "",
    })),
  };
}

// ── Places API (New) Text Search — the migration target ──────────────────────
async function newText(query, extra = {}) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask":
        "places.displayName,places.types,places.rating,places.userRatingCount,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5, ...extra }),
  });
  const d = await r.json();
  if (d.error) return { err: `${d.error.status} ${d.error.message}` };
  return {
    results: (d.places ?? []).slice(0, 5).map((x) => ({
      name: x.displayName?.text ?? "?",
      types: (x.types ?? []).filter((t) => t !== "point_of_interest" && t !== "establishment").slice(0, 3),
      rating: x.rating ?? null,
      reviews: x.userRatingCount ?? null,
      addr: x.formattedAddress ?? "",
    })),
  };
}

function printResults(res) {
  if (res.err) return console.log("   " + dim("ERROR: " + res.err));
  if (!res.results.length) return console.log("   " + dim("(zero results)"));
  for (const p of res.results) {
    const rr = p.rating !== null ? `★${p.rating} (${p.reviews})` : dim("no rating");
    console.log(`   • ${bold(p.name)}  ${rr}  ${dim(p.types.join(","))}`);
    console.log(`     ${dim(p.addr)}`);
  }
}

// ── PART A: category specificity, easy → deliberately hard ───────────────────
const CATEGORIES = [
  ["EASY  generic",      "coffee shops in Kyoto"],
  ["EASY  typed",        "art museum in Osaka"],
  ["MED   cuisine",      "ramen in Shinjuku Tokyo"],
  ["MED   retail",       "vintage clothing stores Shimokitazawa Tokyo"],
  ["HARD  cultural",     "kissaten in Tokyo"],                       // Showa-era retro coffee house
  ["HARD  niche-cluster","heritage denim boutique Minamihorie Osaka"], // the test case — do NOT overfit
  ["HARD  vibe",         "natural wine bar Tokyo"],
  ["HARD  specialist",   "specialty third-wave coffee roaster Osaka"],
];

async function partA() {
  console.log(bold("\n════════ PART A — category specificity (legacy vs New) ════════"));
  for (const [tag, q] of CATEGORIES) {
    console.log(`\n${bold(tag)}  ${dim("“" + q + "”")}`);
    console.log(dim(" legacy Text Search:"));
    printResults(await legacyText(q));
    console.log(dim(" Places API (New):"));
    printResults(await newText(q));
  }
}

// ── PART B: along-route probe ────────────────────────────────────────────────
// Route: Osaka (Namba) → Kyoto Station. Get a polyline from Routes API, then ask
// Places (New) for a category ALONG that polyline. Compare vs the naive fallback
// (Nearby at the two endpoints only).
const ORIGIN = { lat: 34.6659, lng: 135.5019 };   // Namba, Osaka
const DEST   = { lat: 34.9858, lng: 135.7588 };   // Kyoto Station

async function routePolyline() {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: ORIGIN.lat, longitude: ORIGIN.lng } } },
      destination: { location: { latLng: { latitude: DEST.lat, longitude: DEST.lng } } },
      travelMode: "DRIVE",
    }),
  });
  const d = await r.json();
  if (d.error) return { err: `${d.error.status} ${d.error.message}` };
  const route = d.routes?.[0];
  return { poly: route?.polyline?.encodedPolyline, dist: route?.distanceMeters };
}

async function partB() {
  console.log(bold("\n════════ PART B — along-route discovery ════════"));
  const route = await routePolyline();
  if (route.err) return console.log(" Routes API " + dim("ERROR: " + route.err));
  console.log(` route Osaka(Namba)→Kyoto: ${(route.dist / 1000).toFixed(1)}km, polyline ${route.poly.length} chars`);

  console.log(dim("\n Places (New) searchText WITH searchAlongRouteParameters — “bakery”:"));
  const along = await newText("bakery", {
    searchAlongRouteParameters: { polyline: { encodedPolyline: route.poly } },
    maxResultCount: 8,
  });
  printResults(along);

  console.log(dim("\n For contrast — same query, NO route param (global text bias) — “bakery”:"));
  printResults(await newText("bakery near Osaka to Kyoto route", { maxResultCount: 8 }));
}

await partA();
await partB();
console.log();
