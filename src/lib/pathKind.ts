/**
 * Primary-Path-kind resolution (ADR-0022 P2) — replaces `travelMode.ts`'s `TravelMode`-based
 * logic under the unified `PathKind` vocabulary. Pure and dependency-free, safe to import from
 * client components as well as server-only code.
 *
 * The Trip-level "allowed-kind set" this module used to resolve is gone (ADR-0024 §3, deleted by
 * PR 3b): a Trip's kinds are now a static declaration of what's being sourced, composed
 * cell-by-cell across every provider whose declared competence intersects it
 * (`travelCostRegistry.ts`'s `buildTravelMatrix`), not handed whole to one selected provider, and
 * neither `TripClient.tsx`'s transit caveat nor the along-route discovery corridor resolve a
 * Trip's kinds through this module anymore. `resolvePrimaryPathKind` survives for exactly one
 * caller: `googleRoutesProvider.ts`'s one-mode-per-request collapse, reducing a `kinds` array the
 * registry has already narrowed to `["bus"]` — in practice a one-element reduction, not a real
 * choice among several, kept rather than hardcoded so the provider's own defensive plumbing
 * doesn't assume anything about what it's handed.
 */

import type { PathKind } from "@/types/path";

/** Precedence order for `resolvePrimaryPathKind`'s reduction, most-preferred first. `rail`/`bus`
 * both precede `driving`/`walking`/`bicycle` — mirroring the old `TravelMode` precedence's
 * "transit first" — with `other` last: a real, selectable kind (ADR-0022), but not one anything
 * defaults toward. */
const PATH_KIND_PRECEDENCE: readonly PathKind[] = ["rail", "bus", "driving", "walking", "bicycle", "other"];

/** The fallback set when a caller passes nothing to resolve — kept module-private now that no
 * Trip-level column feeds this function; only `resolvePrimaryPathKind`'s own empty/unset case
 * uses it. */
const DEFAULT_KINDS: readonly PathKind[] = ["rail", "bus", "driving", "walking", "bicycle"];

/** Resolves a kind set to one representative kind — `googleRoutesProvider.ts`'s only remaining
 * use, since Google's matrix/routes calls take exactly one `travelMode` per request. An empty or
 * unset set falls back to `DEFAULT_KINDS`, never to no kind at all. */
export function resolvePrimaryPathKind(kinds: readonly PathKind[] | null | undefined): PathKind {
  const effective = kinds && kinds.length > 0 ? kinds : DEFAULT_KINDS;
  return PATH_KIND_PRECEDENCE.find((k) => effective.includes(k)) ?? DEFAULT_KINDS[0];
}
