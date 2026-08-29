/**
 * `preflight` tests (ADR-0023 §7). Standalone (no test runner): run with
 * `tsx src/lib/vroom/preflight.test.ts`.
 */

import assert from "node:assert/strict";
import { preflight } from "./preflight";
import type { LocationInput } from "@/lib/solver";

const loc = (
  fields: Partial<LocationInput> & { id: string },
): LocationInput => ({ lat: 0, lng: 0, kind: "activity", ...fields });

// ── #152: ungeocoded + pending → "still looking this place up", not excluded from the reason set ──
{
  const { placeable, unplaced } = preflight(
    [loc({ id: "a", enrichmentStatus: "pending" })],
    [],
    [],
  );
  assert.equal(placeable.length, 0);
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].code, "ungeocoded-pending");
  assert.match(unplaced[0].reason, /looking this place up/);
}

// ── #152: ungeocoded + failed → an actionable reason, distinct from pending ──
{
  const { unplaced } = preflight(
    [loc({ id: "a", enrichmentStatus: "failed" })],
    [],
    [],
  );
  assert.equal(unplaced[0].code, "ungeocoded-failed");
  assert.match(unplaced[0].reason, /couldn't find this place/);
}

// ── The failed/geocoded trap: a "failed" row that DOES carry valid coordinates (findPlaceFromText's
// bias-radius rejection leaves the imported pin's own coordinates standing) must not be excluded —
// the exclusion itself is selected on coordinates, only the *reason* on status. ──
{
  const { placeable, unplaced } = preflight(
    [loc({ id: "a", lat: 35, lng: 139, enrichmentStatus: "failed" })],
    [],
    [],
  );
  assert.equal(
    unplaced.length,
    0,
    "a geocoded row is never dropped just because enrichment failed",
  );
  assert.equal(placeable.length, 1);
  assert.equal(placeable[0].id, "a");
}

// ── No geocoded lodging at all → metro logic skipped entirely; a geocoded activity is placeable
// regardless of how far it is from anything else (optimizer.ts:201's old guard). ──
{
  const { placeable, unplaced, metroOf, lodgingMetros } = preflight(
    [loc({ id: "a", lat: 35.0, lng: 139.0 })],
    [loc({ id: "lodge", lat: 0, lng: 0, enrichmentStatus: "pending" })], // lodging present but ungeocoded
    [],
  );
  assert.deepEqual(
    unplaced,
    [],
    "no coverage reason fires when no lodging is geocoded",
  );
  assert.equal(placeable.length, 1);
  assert.equal(metroOf.size, 0, "metroOf is empty — clustering never ran");
  assert.equal(lodgingMetros.size, 0);
}

// ── Bedless metro (ported from optimizer.test.ts): a metro with zero covering lodgings is
// entirely unplaced, with the ADR-0020 string unchanged; a covered metro places normally. ──
{
  const activities = [
    loc({ id: "osaka1", lat: 34.7, lng: 135.51 }),
    loc({ id: "osaka2", lat: 34.69, lng: 135.5 }),
    loc({ id: "tokyo1", lat: 35.6762, lng: 139.6503 }), // ~400km from the only lodging — orphaned metro
    loc({ id: "tokyo2", lat: 35.68, lng: 139.66 }),
  ];
  const lodgings = [loc({ id: "hotelOsaka", lat: 34.6937, lng: 135.5023 })];
  const { placeable, unplaced, metroOf } = preflight(activities, lodgings, []);

  assert.deepEqual(
    unplaced.map((u) => u.locationId).sort(),
    ["tokyo1", "tokyo2"],
    "the Tokyo activities are unplaced — no lodging covers that metro",
  );
  assert.ok(unplaced.every((u) => u.code === "no-lodging-coverage"));
  assert.ok(
    unplaced.every(
      (u) => u.reason === "No lodging covers this area of the trip.",
    ),
    "the ADR-0020 string is unchanged",
  );
  assert.deepEqual(
    placeable.map((p) => p.id).sort(),
    ["osaka1", "osaka2"],
    "the covered metro's activities are placed as usual",
  );
  assert.equal(
    metroOf.get("osaka1"),
    metroOf.get("osaka2"),
    "both Osaka activities share a metro ordinal",
  );
}

// ── Closed on every Trip date → excluded with the third reason, distinct from the other two ──
{
  const MON = "2026-06-01";
  const activities = [
    loc({
      id: "closed",
      lat: 35.0,
      lng: 139.0,
      hoursJson: { "2": { open: "09:00", close: "17:00" } },
    }), // Tuesday only
    loc({
      id: "open",
      lat: 35.0,
      lng: 139.0,
      hoursJson: { "1": { open: "09:00", close: "17:00" } },
    }), // Monday
  ];
  const { placeable, unplaced } = preflight(activities, [], [MON]); // MON is a Monday
  assert.deepEqual(
    unplaced.map((u) => u.locationId),
    ["closed"],
  );
  assert.equal(unplaced[0].code, "closed-all-days");
  assert.deepEqual(
    placeable.map((p) => p.id),
    ["open"],
  );
}

// ── No hours data at all is unconstrained, not "closed every day" ──
{
  const { placeable, unplaced } = preflight(
    [loc({ id: "a", lat: 35, lng: 139 })],
    [],
    ["2026-06-01"],
  );
  assert.deepEqual(unplaced, []);
  assert.equal(placeable.length, 1);
}

// ── lodgingMetros: a covering lodging's ordinal is recorded, so request.ts can derive per-Day
// reachable metros without re-clustering. ──
{
  const activities = [loc({ id: "a1", lat: 35.0, lng: 139.0 })];
  const lodgings = [loc({ id: "hotel", lat: 35.0, lng: 139.0 })];
  const { lodgingMetros, metroOf } = preflight(activities, lodgings, []);
  assert.ok(lodgingMetros.has("hotel"));
  assert.deepEqual(lodgingMetros.get("hotel"), [metroOf.get("a1")]);
}

// ── ADR-0028 §4: an edge Location with no coordinates warns regardless of enrichment status. The
// only reachable way to end up coordinate-less is a permanently-unenrichable "done" row (no
// placeId, no coords) — every write path that queues "pending" enrichment already has coords.
// Gating the warning on "pending" alone left it unreachable in practice; a real ungeocoded edge
// fell back to lodging silently, with no warning at all. ──
{
  const arrival = loc({ id: "airport", enrichmentStatus: "done" }); // 0,0 = no coords
  const { warnings } = preflight([], [], [], { arrival });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /airport/);
  assert.match(warnings[0], /day 1/i);
}

// ── Same for departure, and for "failed" status too — any ungeocoded edge warns, not only a
// pending one. ──
{
  const departure = loc({ id: "airport2", enrichmentStatus: "failed" });
  const { warnings } = preflight([], [], [], { departure });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /airport2/);
  assert.match(warnings[0], /last day/i);
}

// ── A geocoded edge never warns, regardless of enrichment status. ──
{
  const arrival = loc({
    id: "airport3",
    lat: 35,
    lng: 139,
    enrichmentStatus: "pending",
  });
  const { warnings } = preflight([], [], [], { arrival });
  assert.equal(warnings.length, 0);
}

console.log("✓ preflight.test.ts passed");
