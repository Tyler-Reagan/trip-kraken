/**
 * Unit test for the encoded-polyline algorithm (#106).
 * Standalone (no test runner): run with `tsx src/lib/polyline.test.ts`.
 */

import assert from "node:assert/strict";
import { encodePolyline } from "@/lib/polyline";

async function main() {
  // Google's own worked example (developers.google.com/maps/documentation/utilities/polylinealgorithm)
  assert.equal(
    encodePolyline([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]),
    "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
    "matches Google's documented example"
  );

  assert.equal(encodePolyline([]), "", "no points → empty string");
  assert.equal(encodePolyline([{ lat: 0, lng: 0 }]), "??", "origin encodes to two zero-deltas");

  console.log("✓ polyline.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
