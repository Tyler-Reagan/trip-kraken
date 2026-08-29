/**
 * Primary-Path-kind resolution tests (ADR-0022 P2). Standalone: run with
 * `tsx src/lib/pathKind.test.ts`. Replaces `travelMode.test.ts` under the unified `PathKind`
 * vocabulary — `transit` splits into `rail`/`bus`, both still precede `driving`/`walking`/`bicycle`.
 */

import assert from "node:assert/strict";
import { resolvePrimaryPathKind } from "./pathKind";

assert.equal(
  resolvePrimaryPathKind(["walking", "rail"]),
  "rail",
  "rail wins over walking when both are given",
);
assert.equal(
  resolvePrimaryPathKind(["bus", "walking"]),
  "bus",
  "bus wins over walking when rail isn't given",
);
assert.equal(
  resolvePrimaryPathKind(["driving", "walking"]),
  "driving",
  "driving wins over walking when neither rail nor bus is given",
);
assert.equal(
  resolvePrimaryPathKind(["bicycle"]),
  "bicycle",
  "falls through to bicycle when nothing higher-precedence is given",
);
assert.equal(
  resolvePrimaryPathKind(["other", "bicycle"]),
  "bicycle",
  "other is a real kind but sits last in precedence",
);
// ADR-0024 deleted the Trip-level allowed-kind column this function used to resolve — an
// empty/unset argument is now just this function's own default, exercised directly rather than
// via any Trip field.
assert.equal(
  resolvePrimaryPathKind(null),
  "rail",
  "an unset argument resolves to the default set, rail first",
);
assert.equal(
  resolvePrimaryPathKind([]),
  "rail",
  "an empty argument also resolves to the default set",
);
assert.equal(
  resolvePrimaryPathKind(["bus"]),
  "bus",
  "googleRoutesProvider's only real caller shape: a single already-narrowed kind",
);

console.log("✓ pathKind.test.ts passed");
