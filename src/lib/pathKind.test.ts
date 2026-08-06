/**
 * Primary-Path-kind resolution tests (ADR-0022 P2). Standalone: run with
 * `tsx src/lib/pathKind.test.ts`. Replaces `travelMode.test.ts` under the unified `PathKind`
 * vocabulary — `transit` splits into `rail`/`bus`, both still precede `driving`/`walking`/`bicycle`.
 */

import assert from "node:assert/strict";
import { resolvePrimaryPathKind, DEFAULT_ALLOWED_PATH_KINDS } from "./pathKind";

assert.equal(resolvePrimaryPathKind(["walking", "rail"]), "rail", "rail wins over walking when both are allowed");
assert.equal(resolvePrimaryPathKind(["bus", "walking"]), "bus", "bus wins over walking when rail isn't allowed");
assert.equal(resolvePrimaryPathKind(["driving", "walking"]), "driving", "driving wins over walking when neither rail nor bus is allowed");
assert.equal(resolvePrimaryPathKind(["bicycle"]), "bicycle", "falls through to bicycle when nothing higher-precedence is allowed");
assert.equal(resolvePrimaryPathKind(["other", "bicycle"]), "bicycle", "other is a real kind but sits last in precedence");
assert.equal(resolvePrimaryPathKind(null), "rail", "an unset Trip resolves to the default set, rail first");
assert.equal(resolvePrimaryPathKind([]), "rail", "an empty allowed-kind set also resolves to the default set");
assert.equal(DEFAULT_ALLOWED_PATH_KINDS.includes("rail"), true, "the default allowed-kind set includes rail");
assert.equal(DEFAULT_ALLOWED_PATH_KINDS.includes("bus"), true, "the default allowed-kind set includes bus");
assert.equal(DEFAULT_ALLOWED_PATH_KINDS.includes("other"), false, "other is not part of the default set");

console.log("✓ pathKind.test.ts passed");
