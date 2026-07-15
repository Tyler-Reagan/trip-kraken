/**
 * dedupeName tests. Standalone: run with `tsx src/lib/dedupeName.test.ts`.
 */

import assert from "node:assert/strict";
import { dedupeName } from "./dedupeName";

assert.equal(dedupeName("Honeymoon", []), "Honeymoon", "no collision — name passes through unchanged");
assert.equal(dedupeName("Honeymoon", ["Osaka"]), "Honeymoon", "no collision with unrelated names");
assert.equal(dedupeName("Honeymoon", ["Honeymoon"]), "Honeymoon (2)", "first collision suffixes with (2)");
assert.equal(
  dedupeName("Honeymoon", ["Honeymoon", "Honeymoon (2)"]),
  "Honeymoon (3)",
  "skips past an already-taken (2) to the next free number"
);
assert.equal(
  dedupeName("Honeymoon", ["Honeymoon", "Honeymoon (3)"]),
  "Honeymoon (2)",
  "reuses a gap (2) rather than jumping past it to (4)"
);

console.log("✓ dedupeName.test.ts passed");
