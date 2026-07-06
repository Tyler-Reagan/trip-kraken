import type { IsoDate, Placement } from "@/types";

/**
 * Pure placement-ordering algorithm (ADR-0015 §2), shared by the DB layer (src/lib/db/index.ts)
 * and the store's optimistic client-side patches (src/store/tripStore.ts) so both apply the exact
 * same reordering semantics — no risk of the client's optimistic guess drifting from what the
 * server actually persists.
 */

/** Shift siblings on `date` at/after `order` up by one, opening a slot. */
function shiftInto(placements: Placement[], date: IsoDate, order: number): Placement[] {
  return placements.map((p) => (p.date === date && p.order >= order ? { ...p, order: p.order + 1 } : p));
}

/** Re-densify `date`'s placements to a gap-free 0..n-1 order sequence. */
function densify(placements: Placement[], date: IsoDate): Placement[] {
  const onDate = [...placements].filter((p) => p.date === date).sort((a, b) => a.order - b.order);
  const orderById = new Map(onDate.map((p, i) => [p.id, i]));
  return placements.map((p) => (orderById.has(p.id) ? { ...p, order: orderById.get(p.id)! } : p));
}

/**
 * Move an existing placement to `date`/`order`. Siblings at/after the target order shift down; if
 * the placement left another date, that date's remaining placements are re-densified.
 */
export function reorderPlacements(
  placements: Placement[],
  placementId: string,
  date: IsoDate,
  order: number
): Placement[] {
  const current = placements.find((p) => p.id === placementId);
  if (!current) throw new Error("Placement not found");
  const sourceDate = current.date;

  let next = shiftInto(placements, date, order);
  next = next.map((p) => (p.id === placementId ? { ...p, date, order } : p));
  if (sourceDate !== date) next = densify(next, sourceDate);
  return next;
}

/**
 * Insert a new placement for `locationId` on `date`. Appends to the end of the date unless `order`
 * is given, in which case siblings at/after it shift down to make room.
 */
export function insertPlacement(
  placements: Placement[],
  tripId: string,
  newPlacement: { id: string; locationId: string; date: IsoDate; order?: number }
): Placement[] {
  const { id, locationId, date } = newPlacement;
  let order = newPlacement.order;
  let next = placements;
  if (order === undefined) {
    order = placements.filter((p) => p.date === date).reduce((max, p) => Math.max(max, p.order), -1) + 1;
  } else {
    next = shiftInto(placements, date, order);
  }
  return [...next, { id, tripId, locationId, date, order }];
}
