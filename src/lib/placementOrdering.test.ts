/**
 * Pure-function tests for the shared placement-ordering algorithm (ADR-0015 §2). No DB, no
 * fixtures beyond plain objects. Standalone (no test runner): run with
 * `tsx src/lib/placementOrdering.test.ts`.
 */

import assert from "node:assert/strict";
import { reorderPlacements, insertPlacement } from "@/lib/placementOrdering";
import type { Placement } from "@/types";

const p = (id: string, date: string, order: number, locationId = `loc-${id}`): Placement => ({
  id,
  tripId: "trip-1",
  locationId,
  date,
  order,
});

// ── reorderPlacements: within-day reorder ───────────────────────────────────

{
  const placements = [p("a", "2026-01-01", 0), p("b", "2026-01-01", 1), p("c", "2026-01-01", 2)];
  const next = reorderPlacements(placements, "c", "2026-01-01", 0);
  const byDate = next.filter((x) => x.date === "2026-01-01").sort((x, y) => x.order - y.order);
  assert.deepEqual(
    byDate.map((x) => x.id),
    ["c", "a", "b"],
    "moving the last item to the front shifts the others down"
  );
}

// ── reorderPlacements: cross-day move re-densifies the source day ──────────

{
  const placements = [
    p("a", "2026-01-01", 0),
    p("b", "2026-01-01", 1),
    p("c", "2026-01-01", 2),
    p("d", "2026-01-02", 0),
  ];
  const next = reorderPlacements(placements, "b", "2026-01-02", 1);

  const day1 = next.filter((x) => x.date === "2026-01-01").sort((x, y) => x.order - y.order);
  assert.deepEqual(
    day1.map((x) => x.order),
    [0, 1],
    "source day re-densifies to 0..n-1 after the move"
  );
  assert.deepEqual(
    day1.map((x) => x.id),
    ["a", "c"],
    "source day keeps its remaining relative order"
  );

  const day2 = next.filter((x) => x.date === "2026-01-02").sort((x, y) => x.order - y.order);
  assert.deepEqual(
    day2.map((x) => x.id),
    ["d", "b"],
    "target day inserts the moved placement at the requested order, shifting siblings down"
  );
}

// ── reorderPlacements: moving a placement that's alone on its day ──────────

{
  const placements = [p("a", "2026-01-01", 0), p("b", "2026-01-02", 0)];
  const next = reorderPlacements(placements, "a", "2026-01-02", 0);
  const day1 = next.filter((x) => x.date === "2026-01-01");
  const day2 = next.filter((x) => x.date === "2026-01-02").sort((x, y) => x.order - y.order);
  assert.deepEqual(day1, [], "source day is empty after its only placement moves away");
  assert.deepEqual(day2.map((x) => x.id), ["a", "b"], "moved placement lands ahead of the existing one");
}

assert.throws(
  () => reorderPlacements([], "missing", "2026-01-01", 0),
  /Placement not found/,
  "reordering an unknown placement id throws"
);

// ── insertPlacement: append when order is omitted ───────────────────────────

{
  const placements = [p("a", "2026-01-01", 0), p("b", "2026-01-01", 1)];
  const next = insertPlacement(placements, "trip-1", { id: "c", locationId: "loc-c", date: "2026-01-01" });
  const day1 = next.filter((x) => x.date === "2026-01-01").sort((x, y) => x.order - y.order);
  assert.deepEqual(day1.map((x) => x.id), ["a", "b", "c"], "omitted order appends to the end of the date");
}

// ── insertPlacement: explicit order shifts siblings down ───────────────────

{
  const placements = [p("a", "2026-01-01", 0), p("b", "2026-01-01", 1)];
  const next = insertPlacement(placements, "trip-1", { id: "c", locationId: "loc-c", date: "2026-01-01", order: 0 });
  const day1 = next.filter((x) => x.date === "2026-01-01").sort((x, y) => x.order - y.order);
  assert.deepEqual(day1.map((x) => x.id), ["c", "a", "b"], "explicit order inserts and shifts siblings down");
}

// ── insertPlacement: first placement on an empty date ───────────────────────

{
  const next = insertPlacement([], "trip-1", { id: "a", locationId: "loc-a", date: "2026-01-01" });
  assert.deepEqual(next, [p("a", "2026-01-01", 0, "loc-a")], "first placement on a date gets order 0");
}

console.log("placementOrdering.test.ts: all assertions passed");
