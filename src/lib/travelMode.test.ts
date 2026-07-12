/**
 * Per-Trip travel-mode resolution tests (ADR-0019 §mode, issue #86). Standalone: run with
 * `tsx src/lib/travelMode.test.ts`. Split out of `travelCostRegistry.test.ts` (issue #88) since
 * this pure logic now lives in its own client-safe module (`travelMode.ts`), separate from the
 * provider registry's server-only (better-sqlite3-dependent) selection logic.
 */

import assert from "node:assert/strict";
import { resolvePrimaryMode, DEFAULT_ALLOWED_MODES } from "./travelMode";

assert.equal(resolvePrimaryMode(["walking", "transit"]), "transit", "transit wins over walking when both are allowed");
assert.equal(resolvePrimaryMode(["driving", "walking"]), "driving", "driving wins over walking when transit isn't allowed");
assert.equal(resolvePrimaryMode(["bicycle"]), "bicycle", "falls through to bicycle when nothing higher-precedence is allowed");
assert.equal(resolvePrimaryMode(null), "transit", "an unset Trip resolves to the default set, transit first");
assert.equal(resolvePrimaryMode([]), "transit", "an empty allowed-mode set also resolves to the default set");
assert.equal(DEFAULT_ALLOWED_MODES.includes("transit"), true, "the default allowed-mode set includes transit");

console.log("✓ travelMode.test.ts passed");
