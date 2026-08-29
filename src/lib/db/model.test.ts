/**
 * Integration test for the ADR-0015 model: Locations typed by `kind`, lodging dates as constraint
 * fields, the plan as `Placement`s, and day-presence as a derived projection (not stored). Standalone
 * (no test runner): run with `tsx src/lib/db/model.test.ts`. It points the repository's global Drizzle
 * handle at a throwaway temp DB, then exercises the kind-aware repository end-to-end and checks the
 * projection helpers in @/types against what the repository returns.
 *
 * ADR-0037: the repository is fully async now (Turso/libSQL), so this file — like diagnose.test.ts
 * — runs its body inside an async main() rather than as a flat top-level script.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/lib/db/schema";
import {
  createTripWithLocations,
  TripNameCollisionError,
  getPendingLocationIds,
  createLocation,
  setLodgingDates,
  clearLodging,
  setTripArrival,
  setTripDeparture,
  clearTripEdge,
  setPlacements,
  addPlacement,
  movePlacement,
  removePlacement,
  setDayLabel,
  setJourneyRoadKind,
  importBookingLodging,
  getTripWithDetails,
  updateTrip,
  LodgingValidationError,
  TransitValidationError,
} from "@/lib/db";
import {
  isActivity,
  isLodging,
  isTransit,
  rolesOf,
  lodgingOnNight,
  lodgingCoversNight,
  numDaysOf,
  tripDates,
  dayNumberOf,
  addDaysIso,
  type Lodging,
} from "@/types";
import { parseBookingConfirmation } from "@/lib/bookingImport";

async function expectRejected(fn: () => Promise<unknown>, label: string) {
  await assert.rejects(fn(), (e) => e instanceof LodgingValidationError, `expected ${label} to be rejected`);
}

async function expectTransitRejected(fn: () => Promise<unknown>, label: string) {
  await assert.rejects(fn(), (e) => e instanceof TransitValidationError, `expected ${label} to be rejected`);
}

async function main() {
  // Stand up a temp DB and install it as the repository's connection BEFORE any repo call.
  // (The repo's getDrizzle() is lazy, so the static import above never opens the real dev DB.)
  const dir = fs.mkdtempSync(path.join(tmpdir(), "tk-test-"));
  const client = createClient({ url: `file:${path.join(dir, "test.db")}` });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
  (globalThis as unknown as { _drizzle?: Promise<typeof db> })._drizzle = Promise.resolve(db);

  // ── Pure date helpers: the single projection axis (ADR-0015 §3) ──
  assert.equal(numDaysOf("2026-06-24", "2026-06-26"), 3, "inclusive day count");
  assert.deepEqual(tripDates("2026-06-24", "2026-06-26"), ["2026-06-24", "2026-06-25", "2026-06-26"], "every trip date");
  assert.equal(dayNumberOf("2026-06-24", "2026-06-26"), 3, "1-based day number");
  assert.equal(addDaysIso("2026-06-24", 2), "2026-06-26", "add days (UTC, no DST drift)");

  // ── Fixture: a required-date 3-day trip with two imported places ──
  const trip = await createTripWithLocations({
    name: "Test trip",
    sourceUrl: "",
    startDate: "2026-06-24",
    endDate: "2026-06-26",
    locations: [{ name: "A" }, { name: "B" }],
  });
  assert.equal(trip.startDate, "2026-06-24", "trip carries its required start date");
  assert.equal(trip.endDate, "2026-06-26", "trip carries its required end date");
  const A = trip.locations.find((l) => l.name === "A")!.id;
  const B = trip.locations.find((l) => l.name === "B")!.id;

  // ── roadProfile (ADR-0024, amended 2026-08-11): defaults to walking, round-trips through
  //    updateTrip, and allowedPathKinds no longer exists on the returned shape at all ──
  assert.equal(trip.roadProfile, "walking", "a Trip created without one defaults to walking");
  assert.equal("allowedPathKinds" in trip, false, "the deleted column has no trace in the returned shape");
  const withDriving = await updateTrip(trip.id, { roadProfile: "driving" });
  assert.equal(withDriving.roadProfile, "driving", "updateTrip round-trips roadProfile");
  assert.equal((await getTripWithDetails(trip.id))!.roadProfile, "driving", "the change persists across a fresh read");

  // ── hasJrPass (issue #211): defaults to false, round-trips through updateTrip ──
  assert.equal(trip.hasJrPass, false, "a Trip created without one defaults to no JR Pass");
  const withJrPass = await updateTrip(trip.id, { hasJrPass: true });
  assert.equal(withJrPass.hasJrPass, true, "updateTrip round-trips hasJrPass");
  assert.equal((await getTripWithDetails(trip.id))!.hasJrPass, true, "the change persists across a fresh read");

  // ── Default kind: imported places are activities until a constraint elevates them (ADR-0015 §1) ──
  assert.ok(trip.locations.every(isActivity), "imported places default to kind=activity");
  assert.deepEqual(rolesOf(trip.locations[0]), [], "a plain activity has no role (candidate)");

  // ── The kind-elevating gesture: attaching dates makes a place a lodging (ADR-0015 §2) ──
  await setLodgingDates(trip.id, A, { checkInDate: "2026-06-24", checkOutDate: "2026-06-26" }); // nights 24, 25
  await setLodgingDates(trip.id, B, { checkInDate: "2026-06-26", checkOutDate: "2026-06-27" }); // night 26 (adjacent switch)

  const details = (await getTripWithDetails(trip.id))!;
  const a = details.locations.find((l) => l.id === A)!;
  assert.ok(isLodging(a), "A narrowed to kind=lodging");
  assert.deepEqual(rolesOf(a), ["lodging"], "a lodging derives the lodging role");
  if (isLodging(a)) {
    assert.equal(a.checkInDate, "2026-06-24", "lodging carries its check-in date");
    assert.equal(a.checkOutDate, "2026-06-26", "lodging carries its check-out date");
  }

  // ── Day-presence is a derived projection over the date fields — never stored (ADR-0015 §2) ──
  const lodgings: Lodging[] = details.locations.filter(isLodging);
  assert.equal(lodgingOnNight(lodgings, "2026-06-24")?.id, A, "night 24 → A");
  assert.equal(lodgingOnNight(lodgings, "2026-06-25")?.id, A, "night 25 → A");
  assert.equal(lodgingOnNight(lodgings, "2026-06-26")?.id, B, "night 26 → B (the switch)");
  assert.ok(!lodgingCoversNight(lodgings.find((l) => l.id === A)!, "2026-06-26"), "half-open: checkout night is not covered");

  // ── The plan: setPlacements writes activities; re-optimize replaces wholesale (ADR-0015 §5) ──
  const C = (await createLocation(trip.id, { name: "C (activity)" })).id;
  await setPlacements(trip.id, [{ locationId: C, date: "2026-06-25", order: 0 }]);
  let plan = (await getTripWithDetails(trip.id))!.placements;
  assert.equal(plan.length, 1, "one placement stored");
  assert.deepEqual(
    { locationId: plan[0].locationId, date: plan[0].date, order: plan[0].order },
    { locationId: C, date: "2026-06-25", order: 0 },
    "placement round-trips"
  );
  // Wholesale replace: a second setPlacements discards the prior plan entirely (no diff, no locks).
  await setPlacements(trip.id, [{ locationId: C, date: "2026-06-24", order: 0 }]);
  plan = (await getTripWithDetails(trip.id))!.placements;
  assert.equal(plan.length, 1, "re-optimize replaced, not appended");
  assert.equal(plan[0].date, "2026-06-24", "placement moved to the new plan");

  // ── Lodging validation (LodgingValidationError) ──
  await expectRejected(() => setLodgingDates(trip.id, B, { checkInDate: "2026-06-25", checkOutDate: "2026-06-24" }), "checkIn >= checkOut");
  await expectRejected(() => setLodgingDates(trip.id, B, { checkInDate: "2026-06-25", checkOutDate: "2026-06-27" }), "overlaps A's nights");
  await expectRejected(() => setLodgingDates(trip.id, "not-a-location", { checkInDate: "2026-06-24", checkOutDate: "2026-06-25" }), "location not in trip");
  // A stay that covers none of the trip's nights is silently dropped by optimize.ts ("Empty ranges
  // (outside the trip) drop"), leaving a Location that is a lodging by kind — so filtered out of the
  // activity list — but has no night to render on. Reject it at the only write path instead.
  await expectRejected(() => setLodgingDates(trip.id, B, { checkInDate: "2026-07-10", checkOutDate: "2026-07-12" }), "stay entirely after the trip");
  await expectRejected(() => setLodgingDates(trip.id, B, { checkInDate: "2026-06-01", checkOutDate: "2026-06-03" }), "stay entirely before the trip");
  // Boundary: checking out the morning after the final night is normal and must stay legal — B's
  // own 2026-06-26..27 booking above already relies on it.
  await setLodgingDates(trip.id, B, { checkInDate: "2026-06-26", checkOutDate: "2026-06-27" });

  // ── Manual placement edits: hand placements that persist until the next optimize (ADR-0015) ──
  const P = (await createLocation(trip.id, { name: "P (activity)" })).id;
  const Q = (await createLocation(trip.id, { name: "Q (activity)" })).id;
  const orderOn = (t: Awaited<ReturnType<typeof getTripWithDetails>>, date: string) =>
    t!.placements.filter((p) => p.date === date).sort((a, b) => a.order - b.order).map((p) => p.locationId);

  await addPlacement(trip.id, P, "2026-06-25"); // appends → order 0
  const afterQ = await addPlacement(trip.id, Q, "2026-06-25", 0); // inserts at 0 → P shifts to 1
  assert.deepEqual(orderOn(afterQ, "2026-06-25"), [Q, P], "explicit order inserts and shifts siblings down");

  const pId = afterQ.placements.find((p) => p.locationId === P)!.id;
  const afterMove = await movePlacement(trip.id, pId, "2026-06-26", 0); // P leaves the 25th
  assert.deepEqual(orderOn(afterMove, "2026-06-25"), [Q], "source date re-densifies after a move");
  assert.deepEqual(orderOn(afterMove, "2026-06-26"), [P], "P landed on the new date");

  const qId = afterMove.placements.find((p) => p.locationId === Q)!.id;
  const afterRemove = await removePlacement(trip.id, qId);
  assert.ok(!afterRemove.placements.some((p) => p.id === qId), "removed placement is gone");
  assert.ok(afterRemove.locations.some((l) => l.id === Q), "but its Location stays a candidate");

  // clearLodging relegates a lodging back to a plain activity (removing its constraint).
  const relegated = await clearLodging(trip.id, B);
  assert.ok(isActivity(relegated.locations.find((l) => l.id === B)!), "cleared lodging is an activity again");

  // ── Transit trip edges (ADR-0028): arriveAt/departAt are the kind-elevating gesture, the same as
  // lodging's dates. At most one Location per Trip may hold each — this temp DB runs the real
  // migrations, so the partial unique index backing that is genuinely present, not just asserted;
  // the write path's own release-prior-holder transaction is what's exercised below. ──
  const R = (await createLocation(trip.id, { name: "R (activity)" })).id;
  const S = (await createLocation(trip.id, { name: "S (activity)" })).id;

  const withArrival = await setTripArrival(trip.id, R, "14:00");
  const r1 = withArrival.locations.find((l) => l.id === R)!;
  assert.ok(isTransit(r1), "setting arriveAt elevates R to kind=transit");
  if (isTransit(r1)) assert.equal(r1.arriveAt, "2026-06-24T14:00", "the date is the trip's own start date, composed server-side");

  // Assigning a different Location as the arrival releases R in the same transaction.
  const withNewArrival = await setTripArrival(trip.id, S, null);
  const rAfter = withNewArrival.locations.find((l) => l.id === R)!;
  const sAfter = withNewArrival.locations.find((l) => l.id === S)!;
  assert.ok(isActivity(rAfter), "R lost its only edge field and relegated back to an activity");
  assert.ok(isTransit(sAfter), "S is now transit");
  if (isTransit(sAfter)) assert.equal(sAfter.arriveAt, "2026-06-24", "no time given — a bare date, still a designated edge");

  // A Location can hold both edges at once — the round-trip-through-one-airport case.
  const withDeparture = await setTripDeparture(trip.id, S, "09:15");
  const sBoth = withDeparture.locations.find((l) => l.id === S)!;
  if (isTransit(sBoth)) {
    assert.equal(sBoth.arriveAt, "2026-06-24", "the arrival is untouched by setting the departure");
    assert.equal(sBoth.departAt, "2026-06-26T09:15", "the departure uses the trip's own end date");
  }

  // Clearing one of two edges leaves the Location transit; clearing the last relegates it.
  const afterClearArrival = await clearTripEdge(trip.id, S, "arrival");
  const sOneEdge = afterClearArrival.locations.find((l) => l.id === S)!;
  assert.ok(isTransit(sOneEdge), "S still holds departAt — still transit");
  if (isTransit(sOneEdge)) assert.equal(sOneEdge.arriveAt, null, "arriveAt cleared");
  const afterClearBoth = await clearTripEdge(trip.id, S, "departure");
  assert.ok(isActivity(afterClearBoth.locations.find((l) => l.id === S)!), "clearing the last edge relegates S to an activity");

  await expectTransitRejected(() => setTripArrival(trip.id, R, "9pm"), "malformed time");
  await expectTransitRejected(() => setTripArrival(trip.id, "not-a-location", "09:00"), "location not in trip");

  // A Trip date-range change re-stamps a stored edge's date component, preserving its time
  // (ADR-0028 §3) — the edge date is never independently editable.
  await setTripArrival(trip.id, R, "07:45");
  const moved = await updateTrip(trip.id, { startDate: "2026-06-23" });
  const rMoved = moved.locations.find((l) => l.id === R)!;
  if (isTransit(rMoved)) assert.equal(rMoved.arriveAt, "2026-06-23T07:45", "the date follows the trip's new start date; the time is preserved");

  // ── Day labels live in a {date → label} map on the Trip (days are not an entity, ADR-0015) ──
  const labelled = await setDayLabel(trip.id, "2026-06-25", "Museum day");
  assert.deepEqual(labelled.dayLabels, { "2026-06-25": "Museum day" }, "label stored under its date");
  const cleared = await setDayLabel(trip.id, "2026-06-25", "");
  assert.deepEqual(cleared.dayLabels, {}, "empty label clears the entry");

  // ── Journey road kinds (#217): a rider's chosen roadProfile override for one Location pair, keyed unordered ──
  const chosenPQ = await setJourneyRoadKind(trip.id, P, Q, "driving");
  assert.equal(chosenPQ.journeyRoadKinds.length, 1, "one choice stored");
  assert.equal(chosenPQ.journeyRoadKinds[0].kind, "driving");
  const reversedLookup = await setJourneyRoadKind(trip.id, Q, P, "walking");
  assert.equal(reversedLookup.journeyRoadKinds.length, 1, "naming the pair in the opposite order updates the same choice, not a second one");
  assert.equal(reversedLookup.journeyRoadKinds[0].kind, "walking", "upsert overwrites the existing choice's kind");
  const clearedChoice = await setJourneyRoadKind(trip.id, P, Q, null);
  assert.equal(clearedChoice.journeyRoadKinds.length, 0, "kind: null clears the choice");

  // ── Booking import (ADR-0010, #57): property → lodging Location with dates ──
  const parsed = parseBookingConfirmation(
    ["Your stay at Hotel Sakura", "Check-in: August 3, 2026", "Check-out: 2026-08-06", "Confirmation #ABC"].join("\n")
  );
  assert.ok(parsed.ok, "clean confirmation parses");
  if (parsed.ok) {
    assert.equal(parsed.booking.property, "Hotel Sakura", "property parsed");
    assert.equal(parsed.booking.checkInDate, "2026-08-03", "check-in parsed from a month-name date");
    assert.equal(parsed.booking.checkOutDate, "2026-08-06", "check-out parsed from an ISO date");
  }
  assert.equal(parseBookingConfirmation("no dates or property here").ok, false, "malformed confirmation reports an error");

  const it = await createTripWithLocations({ name: "Import trip", sourceUrl: "", startDate: "2026-08-03", endDate: "2026-08-08", locations: [] });
  const imp1 = await importBookingLodging(it.id, { property: "Hotel Sakura", checkInDate: "2026-08-03", checkOutDate: "2026-08-06" });
  const sakura = imp1.locations.find((l) => l.name === "Hotel Sakura")!;
  assert.ok(sakura && isLodging(sakura), "the property became a lodging Location");
  // Re-importing the same property name resolves the existing Location (no duplicate).
  const imp2 = await importBookingLodging(it.id, { property: "hotel sakura", checkInDate: "2026-08-06", checkOutDate: "2026-08-08" });
  assert.equal(imp2.locations.filter((l) => l.name.toLowerCase() === "hotel sakura").length, 1, "same property resolves — no duplicate");
  assert.equal(imp2.locations.filter(isLodging).length, 1, "still one lodging (dates extended, not duplicated)");
  await expectRejected(
    () => importBookingLodging(it.id, { property: "Hotel Overlap", checkInDate: "2026-08-04", checkOutDate: "2026-08-07" }),
    "overlapping booking import"
  );

  // ── Blank-slate trip (ADR-0010): null sourceUrl, no locations, but still a required date range ──
  const blank = await createTripWithLocations({ name: "Blank trip", sourceUrl: null, startDate: "2026-09-01", endDate: "2026-09-05", locations: [] });
  assert.equal(blank.sourceUrl, null, "blank-slate trip has a null sourceUrl");
  assert.equal(blank.locations.length, 0, "blank-slate trip starts with no locations");
  assert.equal(numDaysOf(blank.startDate, blank.endDate), 5, "blank trip still has a real calendar");

  // ── #124: getPendingLocationIds is the durable work-list ADR-0009 decided on — every 'pending'
  // Location, across every Trip, regardless of 'done'/'failed' rows in between ──
  {
    const t1 = await createTripWithLocations({ name: "Pending scan trip A", sourceUrl: null, startDate: "2026-11-01", endDate: "2026-11-02", locations: [] });
    const t2 = await createTripWithLocations({ name: "Pending scan trip B", sourceUrl: null, startDate: "2026-11-01", endDate: "2026-11-02", locations: [] });
    const before = new Set(await getPendingLocationIds());
    const pendingA = await createLocation(t1.id, { name: "Still looking this up", enrichmentStatus: "pending" });
    const doneA = await createLocation(t1.id, { name: "Already enriched", enrichmentStatus: "done" });
    const failedB = await createLocation(t2.id, { name: "Gave up", enrichmentStatus: "failed" });
    const pendingB = await createLocation(t2.id, { name: "Also still looking", enrichmentStatus: "pending" });
    const after = new Set(await getPendingLocationIds());
    const newlyPending = [...after].filter((id) => !before.has(id));
    assert.deepEqual(newlyPending.sort(), [pendingA.id, pendingB.id].sort(), "only the two pending rows, from either trip, not done/failed");
    assert.ok(!after.has(doneA.id) && !after.has(failedB.id));
  }

  // ── #121: DB-layer trip-name uniqueness closes the race checkTripNameCollision alone can't ──
  // (a concurrent create that never went through the app-level pre-check).
  await createTripWithLocations({ name: "Race trip", sourceUrl: null, startDate: "2026-10-01", endDate: "2026-10-03", locations: [] });
  await assert.rejects(
    createTripWithLocations({ name: "Race trip", sourceUrl: null, startDate: "2026-10-01", endDate: "2026-10-03", locations: [] }),
    (e) => e instanceof TripNameCollisionError,
    "a second create with the same name is rejected even without the app-level pre-check running first"
  );
  try {
    await createTripWithLocations({ name: "Race trip", sourceUrl: null, startDate: "2026-10-01", endDate: "2026-10-03", locations: [] });
    assert.fail("expected TripNameCollisionError");
  } catch (e) {
    assert.ok(e instanceof TripNameCollisionError);
    assert.equal(e.collision.duplicate, true);
    assert.equal(e.collision.existingTrips.length, 1, "the one existing 'Race trip' is reported");
    assert.equal(e.collision.suggestedName, "Race trip (2)", "carries the same suggestion checkTripNameCollision would compute");
  }
  // A distinct name is unaffected.
  const raceTrip2 = await createTripWithLocations({ name: "Race trip (2)", sourceUrl: null, startDate: "2026-10-01", endDate: "2026-10-03", locations: [] });
  assert.equal(raceTrip2.name, "Race trip (2)");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("✓ model.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
