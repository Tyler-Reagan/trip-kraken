/**
 * `composeTravelMatrix` tests (ADR-0024 §4) — the pure composition core, tested independently of
 * any real provider or registry. Standalone (no test runner): run with
 * `tsx src/lib/travelMatrix.test.ts`. Every entry here is a fake with a call-spy, so these tests
 * assert the composer's *contract* — dispatch order, kind intersection, point subsetting,
 * completion — not any one provider's behaviour.
 */

import assert from "node:assert/strict";
import { composeTravelMatrix, type MatrixEntry } from "./travelMatrix";
import { makeTravelCost, type ProviderId } from "@/types/path";
import type { Point } from "@/lib/geo";
import type { MatrixCell } from "@/lib/pathProvider";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  const cost = (id: ProviderId) =>
    makeTravelCost(1000, 100, "routingService", id);

  interface Call {
    points: Point[];
    kinds: string[];
  }

  /** A fake registry entry: `fill(points)` decides which cells it answers (by local index), the
   * rest are declines. Every call is recorded so tests can assert on invocation count, the exact
   * `kinds` passed, and the exact point subset passed. */
  function fakeEntry(
    id: ProviderId,
    kinds: readonly string[],
    fill: (points: Point[]) => MatrixCell[][],
  ): MatrixEntry & { calls: Call[] } {
    const calls: Call[] = [];
    return {
      id,
      kinds: kinds as MatrixEntry["kinds"],
      calls,
      provider: {
        async costMatrix(points, requestKinds) {
          calls.push({ points, kinds: requestKinds });
          return fill(points);
        },
      },
    };
  }

  const P0: Point = { lat: 0, lng: 0 };
  const P1: Point = { lat: 1, lng: 1 };
  const P2: Point = { lat: 2, lng: 2 };
  const P3: Point = { lat: 3, lng: 3 };

  // ── First-capable-wins per cell; a declining cell falls through to the next entry ──
  {
    const entryA = fakeEntry("osrm", ["walking"], (points) => {
      const n = points.length;
      const m: MatrixCell[][] = Array.from({ length: n }, () =>
        new Array(n).fill(null),
      );
      if (n >= 2) m[0][1] = cost("osrm"); // answers exactly one cell, declines the rest
      return m;
    });
    const entryB = fakeEntry("haversine", ["walking"], (points) => {
      const n = points.length;
      return Array.from({ length: n }, () =>
        new Array(n).fill(cost("haversine")),
      );
    });

    const matrix = await composeTravelMatrix([entryA, entryB], [P0, P1], {
      kinds: ["walking"],
    });

    assert.equal(
      matrix[0][1].answeredBy,
      "osrm",
      "the first entry's answer wins and is never overwritten",
    );
    assert.equal(
      matrix[1][0].answeredBy,
      "haversine",
      "a cell entryA declined falls through to entryB",
    );
    assert.equal(matrix[0][0].answeredBy, "haversine");
    assert.equal(matrix[1][1].answeredBy, "haversine");
  }

  // ── An entry whose kinds don't intersect the request is never invoked at all ──
  {
    const busOnly = fakeEntry("google", ["bus"], (points) => {
      const n = points.length;
      return Array.from({ length: n }, () => new Array(n).fill(cost("google")));
    });
    const terminal = fakeEntry(
      "haversine",
      ["rail", "bus", "walking", "driving", "bicycle", "other"],
      (points) => {
        const n = points.length;
        return Array.from({ length: n }, () =>
          new Array(n).fill(cost("haversine")),
        );
      },
    );

    const matrix = await composeTravelMatrix([busOnly, terminal], [P0, P1], {
      kinds: ["walking"],
    });

    assert.equal(
      busOnly.calls.length,
      0,
      "an entry with no kind overlap is skipped, not called with an empty kind list",
    );
    assert.equal(terminal.calls.length, 1);
    assert.equal(matrix[0][1].answeredBy, "haversine");
  }

  // ── Each entry receives exactly kinds ∩ request.kinds, in the entry's own kind order ──
  {
    const spy = fakeEntry("osrm", ["walking", "driving"], (points) => {
      const n = points.length;
      return Array.from({ length: n }, () => new Array(n).fill(cost("osrm")));
    });

    await composeTravelMatrix([spy], [P0, P1], {
      kinds: ["rail", "bus", "walking"],
    });

    assert.deepEqual(
      spy.calls[0].kinds,
      ["walking"],
      "driving is dropped — it's not in the request",
    );
  }

  // ── No entry is called after the matrix is already complete (early exit) ──
  {
    const fillsEverything = fakeEntry("osrm", ["walking"], (points) => {
      const n = points.length;
      return Array.from({ length: n }, () => new Array(n).fill(cost("osrm")));
    });
    const neverReached = fakeEntry("haversine", ["walking"], (points) => {
      const n = points.length;
      return Array.from({ length: n }, () =>
        new Array(n).fill(cost("haversine")),
      );
    });

    await composeTravelMatrix([fillsEverything, neverReached], [P0, P1], {
      kinds: ["walking"],
    });

    assert.equal(
      neverReached.calls.length,
      0,
      "nothing left to do, so the next entry is never invoked",
    );
  }

  // ── A later entry receives only the point subset still participating in an unfilled cell —
  //    ADR-0024 §7's "exposure bounded by composition," not the full N² ──
  {
    const almostEverything = fakeEntry("osrm", ["walking"], (points) => {
      // First call, so `points` is the full original [P0,P1,P2,P3] in order. Answers every cell
      // except the P2<->P3 pair in both directions, so P0 and P1 end up fully resolved (both their
      // row and column complete) while P2 and P3 do not.
      const n = points.length;
      const m: MatrixCell[][] = Array.from({ length: n }, () =>
        new Array(n).fill(null),
      );
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if ((i === 2 && j === 3) || (i === 3 && j === 2)) continue;
          m[i][j] = cost("osrm");
        }
      }
      return m;
    });
    const spy = fakeEntry("haversine", ["walking"], (points) => {
      const n = points.length;
      return Array.from({ length: n }, () =>
        new Array(n).fill(cost("haversine")),
      );
    });

    const matrix = await composeTravelMatrix(
      [almostEverything, spy],
      [P0, P1, P2, P3],
      { kinds: ["walking"] },
    );

    assert.equal(spy.calls.length, 1);
    assert.equal(
      spy.calls[0].points.length,
      2,
      "only the two still-unresolved points are handed to the next entry",
    );
    assert.equal(spy.calls[0].points[0], P2);
    assert.equal(spy.calls[0].points[1], P3);
    assert.equal(matrix[2][3].answeredBy, "haversine");
    assert.equal(matrix[3][2].answeredBy, "haversine");
    assert.equal(
      matrix[0][3].answeredBy,
      "osrm",
      "cells resolved by the first entry are untouched",
    );
  }

  // ── No terminal entry, matrix stays incomplete: throws rather than returning a hole ──
  {
    const declinesEverything = fakeEntry("osrm", ["walking"], (points) => {
      const n = points.length;
      return Array.from({ length: n }, () => new Array(n).fill(null));
    });

    await assert.rejects(
      () =>
        composeTravelMatrix([declinesEverything], [P0, P1], {
          kinds: ["walking"],
        }),
      /no terminal provider filled cell/,
      "an unfilled cell with nothing left to try throws instead of silently returning null",
    );
  }

  console.log("✓ travelMatrix.test.ts passed");
}
