/**
 * Round-trip tests for the rail geometry BLOB encoding (ADR-0030 §5). Standalone (no test
 * runner): run with `tsx src/lib/geometryCodec.test.ts`.
 *
 * The property that matters is not "decode(encode(x)) === x" — it cannot be, the format is lossy
 * by design — but that the loss is bounded at the 5th decimal place and never accumulates along a
 * line. A drifting decoder would bend long Shinkansen segments off the map by metres per vertex
 * while every individual vertex still looked fine.
 */

import assert from "node:assert/strict";
import { encodeLineString, decodeLineString } from "./geometryCodec";

/** Half a unit at 5 decimal places — the most a coordinate can move under rounding. */
const TOLERANCE_DEGREES = 0.5e-5 + 1e-12;

function line(coordinates: [number, number][]): GeoJSON.LineString {
  return { type: "LineString", coordinates };
}

function assertRoundTrip(original: GeoJSON.LineString, label: string): GeoJSON.LineString {
  const decoded = decodeLineString(encodeLineString(original));
  assert.equal(decoded.type, "LineString", `${label}: type survives`);
  assert.equal(decoded.coordinates.length, original.coordinates.length, `${label}: vertex count survives`);
  for (let i = 0; i < original.coordinates.length; i++) {
    const [lng, lat] = original.coordinates[i];
    const [gotLng, gotLat] = decoded.coordinates[i];
    assert.ok(Math.abs(gotLng - lng) <= TOLERANCE_DEGREES, `${label}: vertex ${i} lng within 5dp (${gotLng} vs ${lng})`);
    assert.ok(Math.abs(gotLat - lat) <= TOLERANCE_DEGREES, `${label}: vertex ${i} lat within 5dp (${gotLat} vs ${lat})`);
  }
  return decoded;
}

// ── A real-shaped segment ───────────────────────────────────────────────────────────────
// Tokyo Station northward along the Yamanote alignment, at the vertex spacing real track has.
assertRoundTrip(
  line([
    [139.767125, 35.681236],
    [139.767891, 35.683102],
    [139.768340, 35.685455],
    [139.770012, 35.688901],
    [139.771233, 35.690112],
  ]),
  "urban segment"
);

// ── Direction is not privileged ─────────────────────────────────────────────────────────
// Deltas go negative travelling south and west; zigzag exists so those stay one byte.
assertRoundTrip(
  line([
    [139.771233, 35.690112],
    [139.768340, 35.685455],
    [139.767125, 35.681236],
    [135.495951, 34.702485],
  ]),
  "southwestward segment"
);

// ── Rounding must not accumulate ────────────────────────────────────────────────────────
// 2,000 vertices each offset by a third of a unit at the 5th decimal place — the pattern that
// breaks a decoder deltaing against the raw previous coordinate instead of the quantized one.
// The last vertex has to be as accurate as the first.
const drifting = line(
  Array.from({ length: 2000 }, (_, i): [number, number] => [
    139.7 + i * 0.0000033,
    35.6 + i * 0.0000033,
  ])
);
const decodedDrift = assertRoundTrip(drifting, "2,000-vertex drift check");
const lastError = Math.abs(decodedDrift.coordinates[1999][1] - drifting.coordinates[1999][1]);
assert.ok(lastError <= TOLERANCE_DEGREES, `no accumulated drift at vertex 1999 (off by ${lastError})`);

// ── Encoding is the lever (§5) ──────────────────────────────────────────────────────────
// The claim the whole storage decision rests on: binary beats GeoJSON text severalfold. Measured
// nationally at 3.7×; asserted loosely here so the test reports a regression, not noise.
const real = line(
  Array.from({ length: 500 }, (_, i): [number, number] => [
    139.767 + i * 0.00021 + (i % 7) * 0.000004,
    35.681 + i * 0.00018 - (i % 5) * 0.000006,
  ])
);
const binaryBytes = encodeLineString(real).length;
const textBytes = Buffer.byteLength(JSON.stringify(real.coordinates), "utf8");
assert.ok(
  binaryBytes * 3 < textBytes,
  `binary is at least 3x smaller than GeoJSON text (${binaryBytes} B vs ${textBytes} B)`
);

// ── Degenerate inputs ───────────────────────────────────────────────────────────────────
assert.equal(encodeLineString(line([])).length, 0, "an empty line encodes to an empty buffer");
assert.deepEqual(decodeLineString(Buffer.alloc(0)).coordinates, [], "an empty buffer decodes to no vertices");
assertRoundTrip(line([[139.767125, 35.681236], [139.767125, 35.681236]]), "two identical vertices");

// ── A truncated buffer is loud, not silently short ──────────────────────────────────────
// Corruption that drops trailing bytes must not decode as a valid, shorter line: that would draw
// a real-looking track that stops in a field.
const truncated = encodeLineString(real).subarray(0, encodeLineString(real).length - 1);
assert.throws(() => decodeLineString(truncated), /varint runs past the end/, "a truncated buffer throws");

console.log("geometryCodec.test.ts passed");
