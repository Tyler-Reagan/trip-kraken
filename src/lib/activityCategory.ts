/**
 * A small, stable, domain-facing vocabulary for an Activity, derived from the raw Google Places
 * `types[]` already captured at enrichment (`Location.categories`, ADR-0023 §4) — never the raw
 * list itself, whose exact members drift with Google's own taxonomy and are far too granular for a
 * VROOM capacity dimension to key off directly.
 *
 * Priority-ordered: a real place often carries several overlapping types (a `bar` that is also
 * tagged `restaurant`), so the first matching bucket wins rather than every match being kept.
 */
export type ActivityCategory = "food" | "nightlife" | "shopping" | "sight" | "other";

const CATEGORY_TYPES: [ActivityCategory, Set<string>][] = [
  ["food", new Set(["restaurant", "cafe", "bakery", "meal_takeaway", "meal_delivery", "food"])],
  ["nightlife", new Set(["night_club", "bar", "casino"])],
  [
    "shopping",
    new Set([
      "shopping_mall", "store", "clothing_store", "book_store", "jewelry_store",
      "shoe_store", "department_store", "supermarket",
    ]),
  ],
  [
    "sight",
    new Set([
      "tourist_attraction", "museum", "art_gallery", "park", "church", "hindu_temple",
      "mosque", "synagogue", "zoo", "aquarium", "amusement_park", "landmark",
    ]),
  ],
];

/** `undefined` means "not yet known" (no `categories` to derive from) — kept distinct from
 * `"other"`, which is a positive answer ("we looked, and it matched nothing specific"). Every
 * caller that persists this treats the two the same way the rest of enrichment does: `undefined`
 * is never written over an existing value. */
export function deriveActivityCategory(categories: string[] | null | undefined): ActivityCategory | undefined {
  if (!categories || categories.length === 0) return undefined;
  const set = new Set(categories);
  for (const [category, types] of CATEGORY_TYPES) {
    if ([...types].some((t) => set.has(t))) return category;
  }
  return "other";
}
