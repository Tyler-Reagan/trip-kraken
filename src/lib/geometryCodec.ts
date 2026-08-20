/**
 * Binary encoding for a rail segment's shape (ADR-0030 §5) — the format `transitGraphStore.ts`
 * writes into `RideEdge.geometry`. Pure and I/O-free, kept apart from the store because the store
 * is SQLite and this is arithmetic.
 *
 * Delta + zigzag + varint, at 5 decimal places. Measured against eleven alternatives on real
 * national data (research §G10–G14): this puts `db/transit-japan.db` at 12.78 MB where the naive
 * shape — GeoJSON text at 6 decimal places — costs 47.03 MB. **Encoding is the lever.** Binary
 * beats text 3.7×, which is why none of the deduplication schemes were worth their correctness
 * hazard.
 *
 * Three properties make it small, and each one only works because of what rail track is:
 *  - **5 decimal places.** Worst-case positional error is under a metre, which is immaterial for a
 *    railway at any zoom the map offers — and MapLibre re-simplifies per zoom level regardless of
 *    what is stored, so finer input is discarded before it is ever drawn.
 *  - **Deltas.** Consecutive vertices of real track are metres apart (national median spacing is
 *    254 m), so each delta is a small number even though the absolute coordinate is not.
 *  - **Varint.** A small number then costs one or two bytes instead of eight.
 *
 * Deltas run against the *quantized* previous vertex, never the raw one, so rounding cannot
 * accumulate along a long line.
 *
 * There is no header and no vertex count: the decoder reads coordinate pairs until the buffer is
 * exhausted. A count would be a second statement of the same fact, and a chance for the two to
 * disagree.
 */

/** 5 decimal places (ADR-0030 §5). One unit is ~1.1 m of latitude, so a coordinate is stored
 * within half of that — comfortably under the metre the ADR budgets. */
const SCALE = 1e5;

/** Maps a signed integer onto the unsigned range so that small negatives stay small: -1 becomes 1,
 * 1 becomes 2. Without it every westward or southward step would cost the full varint width. */
function zigzag(value: number): number {
  return (value << 1) ^ (value >> 31);
}

function unzigzag(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}

function writeVarint(bytes: number[], value: number): void {
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
}

export function encodeLineString(line: GeoJSON.LineString): Buffer {
  const bytes: number[] = [];
  let previousLat = 0;
  let previousLng = 0;
  for (const [lng, lat] of line.coordinates) {
    const quantizedLat = Math.round(lat * SCALE);
    const quantizedLng = Math.round(lng * SCALE);
    writeVarint(bytes, zigzag(quantizedLat - previousLat));
    writeVarint(bytes, zigzag(quantizedLng - previousLng));
    previousLat = quantizedLat;
    previousLng = quantizedLng;
  }
  return Buffer.from(bytes);
}

export function decodeLineString(buffer: Buffer): GeoJSON.LineString {
  const coordinates: GeoJSON.Position[] = [];
  let offset = 0;
  let latitude = 0;
  let longitude = 0;

  const readVarint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (offset >= buffer.length) throw new Error("geometryCodec: varint runs past the end of the buffer");
      const byte = buffer[offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
  };

  while (offset < buffer.length) {
    latitude += unzigzag(readVarint());
    longitude += unzigzag(readVarint());
    coordinates.push([longitude / SCALE, latitude / SCALE]);
  }

  return { type: "LineString", coordinates };
}
