/**
 * `anchorsOnDate` tests (ADR-0028) — the one shared rule for which Location bookends a Day.
 * Standalone (no test runner): run with `tsx src/lib/anchors.test.ts`.
 */

import assert from "node:assert/strict";
import { anchorsOnDate } from "./anchors";

const base = { wokeLodgingId: null, sleepLodgingId: null, arrivalId: null, departureId: null };

// ── No edges designated: today's lodging-only behaviour, unchanged ──
{
  const { startId, endId } = anchorsOnDate({ ...base, dayNumber: 1, numDays: 3, wokeLodgingId: "hotel" });
  assert.equal(startId, "hotel", "with no arrival, day 1 starts at whatever lodging you woke at");
  assert.equal(endId, null, "no sleep lodging and no departure — no end anchor");
}

// ── Arrival wins day 1's start over the woke lodging ──
{
  const { startId } = anchorsOnDate({ ...base, dayNumber: 1, numDays: 3, wokeLodgingId: "hotel", arrivalId: "airport" });
  assert.equal(startId, "airport", "an arrival designated for day 1 outranks the lodging Anchor");
}

// ── Arrival does not apply past day 1 ──
{
  const { startId } = anchorsOnDate({ ...base, dayNumber: 2, numDays: 3, wokeLodgingId: "hotel", arrivalId: "airport" });
  assert.equal(startId, "hotel", "the arrival only ever bookends day 1 — day 2 falls back to the woke lodging");
}

// ── Departure wins the last day's end over the sleep-lodging travel-day condition ──
{
  const { endId } = anchorsOnDate({
    ...base,
    dayNumber: 3,
    numDays: 3,
    wokeLodgingId: "hotel",
    sleepLodgingId: null,
    departureId: "airport",
  });
  assert.equal(endId, "airport", "the last day ends at the departure even with no sleep lodging that night");
}

// ── Departure does not apply before the last day ──
{
  const { endId } = anchorsOnDate({ ...base, dayNumber: 1, numDays: 3, departureId: "airport" });
  assert.equal(endId, null, "a departure designated for the last day is inert on day 1 (ADR-0028 §2)");
}

// ── Mid-trip travel day is unaffected by edges designated elsewhere ──
{
  const { startId, endId } = anchorsOnDate({
    dayNumber: 2,
    numDays: 4,
    wokeLodgingId: "hotel-a",
    sleepLodgingId: "hotel-b",
    arrivalId: "airport-in",
    departureId: "airport-out",
  });
  assert.equal(startId, "hotel-a", "day 2 is not day 1 — the woke lodging still starts it");
  assert.equal(endId, "hotel-b", "the travel-day condition (sleep differs from woke) still ends it");
}

// ── Sleeping at the same lodging you woke at produces no end anchor (unchanged) ──
{
  const { endId } = anchorsOnDate({ ...base, dayNumber: 2, numDays: 4, wokeLodgingId: "hotel", sleepLodgingId: "hotel" });
  assert.equal(endId, null, "same lodging both nights is not a travel day — no end anchor");
}

// ── Single-day trip: arrival and departure both apply to day 1 = numDays ──
{
  const { startId, endId } = anchorsOnDate({
    dayNumber: 1,
    numDays: 1,
    wokeLodgingId: null,
    sleepLodgingId: null,
    arrivalId: "airport",
    departureId: "airport",
  });
  assert.equal(startId, "airport", "a one-day trip's single day still starts at the arrival");
  assert.equal(endId, "airport", "and still ends at the departure — the round-trip-through-one-airport case");
}

console.log("✓ anchors.test.ts passed");
