/**
 * Primary-Path-kind resolution (ADR-0022 P2) — replaces `travelMode.ts`'s `TravelMode`-based
 * logic under the unified `PathKind` vocabulary. Pure and dependency-free, so it's safe to import
 * from client components (`TripClient.tsx`'s transit caveat needs to know whether a Trip's
 * allowed-kinds set currently resolves to a transit-like kind) as well as server-only code
 * (`googleRoutesProvider.ts` pulls in `fetch`/env vars, `travelCostRegistry.ts` transitively pulls
 * in `better-sqlite3` via `transitGraphStore.ts`'s `getTransitGraph()`, neither of which this
 * module has any part of).
 *
 * `allowedPathKinds`'s "willingness set" reading is gone (ADR-0024 §3): a Trip's kinds are now a
 * static declaration of what's being sourced, composed cell-by-cell across every provider whose
 * declared competence intersects it (`travelCostRegistry.ts`'s `buildTravelMatrix`), not handed
 * whole to one selected provider. `resolvePrimaryPathKind` survives for the narrower callers below
 * that genuinely need one representative kind — `googleRoutesProvider.ts`'s one-mode-per-request
 * collapse now reduces a set the registry has already narrowed to `["bus"]`, so in practice it's a
 * one-element reduction, not a real choice among several.
 */

import type { PathKind } from "@/types/path";

/** A Trip's allowed-kind set, most-preferred first, for `resolvePrimaryPathKind`'s reduction.
 * `rail`/`bus` both precede `driving`/`walking`/`bicycle` — mirroring the old `TravelMode`
 * precedence's "transit first" — with `other` last: it's a real, selectable kind (ADR-0022), but
 * not one anything defaults toward. */
const PATH_KIND_PRECEDENCE: readonly PathKind[] = ["rail", "bus", "driving", "walking", "bicycle", "other"];

/** The default allowed-kind set for a Trip that hasn't set one explicitly — the `PathKind`
 * equivalent of the old default (`transit` expanded to `rail`+`bus`, per ADR-0022's Consequences).
 * `other` is excluded: a real, selectable kind, but not one a Trip defaults into. Mutable
 * (`PathKind[]`, not `readonly`): callers thread it straight into `solve()`/`selectPathProvider`,
 * which take a plain willingness array. */
export const DEFAULT_ALLOWED_PATH_KINDS: PathKind[] = ["rail", "bus", "driving", "walking", "bicycle"];

/** Resolves a Trip's allowed-kind set to one representative kind, for callers that need exactly
 * one — the itinerary's transit caveat (`TripClient.tsx`) and the along-route discovery corridor's
 * mode-fallback chain (`along-route/route.ts`). An empty or unset set falls back to
 * `DEFAULT_ALLOWED_PATH_KINDS`, never to no kind at all. */
export function resolvePrimaryPathKind(allowedPathKinds: readonly PathKind[] | null | undefined): PathKind {
  const kinds = allowedPathKinds && allowedPathKinds.length > 0 ? allowedPathKinds : DEFAULT_ALLOWED_PATH_KINDS;
  return PATH_KIND_PRECEDENCE.find((k) => kinds.includes(k)) ?? DEFAULT_ALLOWED_PATH_KINDS[0];
}
