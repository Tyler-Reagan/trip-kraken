/**
 * Per-Trip travel-mode resolution (ADR-0019 §mode, issue #86) — split out of
 * `travelCostRegistry.ts` so this pure, dependency-free logic is safe to import from client
 * components (issue #88's itinerary caveat needs to know whether a Trip's resolved mode is
 * transit). `travelCostRegistry.ts` itself pulls in `better-sqlite3` transitively (via
 * `transitGraphStore.ts`'s `getTransitGraph()`), which cannot run in the browser — this module
 * has no such dependency.
 */

import type { TravelMode } from "@/lib/travelCost";

/** A Trip's allowed-mode set, most-preferred first — transit already blends walking internally,
 * so most allowed-mode combinations collapse to this single primary mode the optimizer runs on. */
const MODE_PRECEDENCE: readonly TravelMode[] = ["transit", "driving", "walking", "bicycle"];

/** The default allowed-mode set for a Trip that hasn't set one explicitly (ADR-0019: "the default
 * set includes transit"). Resolves to `"transit"` via `resolvePrimaryMode` below. */
export const DEFAULT_ALLOWED_MODES: readonly TravelMode[] = ["transit", "driving", "walking", "bicycle"];

/** Resolves a Trip's allowed-mode set to the single primary mode the optimizer runs on — replaces
 * the hardcoded `DEFAULT_MODE` constant at the optimize call site (`optimize.ts`). An empty or
 * unset set falls back to `DEFAULT_ALLOWED_MODES`, never to no mode at all. */
export function resolvePrimaryMode(allowedModes: readonly TravelMode[] | null | undefined): TravelMode {
  const modes = allowedModes && allowedModes.length > 0 ? allowedModes : DEFAULT_ALLOWED_MODES;
  return MODE_PRECEDENCE.find((m) => modes.includes(m)) ?? DEFAULT_ALLOWED_MODES[0];
}
