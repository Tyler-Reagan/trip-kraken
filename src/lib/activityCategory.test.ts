/**
 * activityCategory tests. Standalone: run with `tsx src/lib/activityCategory.test.ts`.
 */

import assert from "node:assert/strict";
import { deriveActivityCategory } from "./activityCategory";

assert.equal(deriveActivityCategory(["restaurant", "point_of_interest"]), "food", "a restaurant is food");
assert.equal(deriveActivityCategory(["cafe"]), "food");
assert.equal(deriveActivityCategory(["night_club"]), "nightlife");
assert.equal(deriveActivityCategory(["shopping_mall", "store"]), "shopping");
assert.equal(deriveActivityCategory(["museum"]), "sight");
assert.equal(deriveActivityCategory(["hair_care"]), "other", "an unmatched but known type falls to other, not unknown");
assert.equal(deriveActivityCategory([]), undefined, "no types at all is unknown, not other");
assert.equal(deriveActivityCategory(null), undefined);
assert.equal(deriveActivityCategory(undefined), undefined);

// Priority: a place carrying both a food type and a nightlife type resolves food first — food is
// listed first in CATEGORY_TYPES, matching the "no two dinners" example this vocabulary exists for.
assert.equal(deriveActivityCategory(["bar", "restaurant"]), "food", "food outranks nightlife when both types are present");

console.log("activityCategory.test.ts passed");
