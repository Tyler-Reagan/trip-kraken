# ADR-0035: Surfaced Transit is `Transit.authored: false`, not a new kind, projected by a standalone function

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0015 (`Location` as the one place primitive, `LocationBase` and the
  kind-narrowed union), ADR-0022 (`PathEndpoint` — "identity plus coordinates, deliberately not a
  full `Location`" — the precedent this ADR follows for an ephemeral, ADR-0032-derived endpoint),
  ADR-0028 (§6 named Surfaced Transit and rejected materializing it as a stored `Location`; its
  Consequences listed the three blockers this ADR confirms are now clear), ADR-0030 (§7 — `RideStep`
  and `TransferStep` now carry the stop-node and station-cluster ids this ADR's projection reads),
  ADR-0032 (decomposition — `PathEndpoint.stationName` is the field this projection reads)

## Context

[#194](https://github.com/Tyler-Reagan/trip-kraken/issues/194), under map
[#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181), picks up where ADR-0028 §6 left off.
CONTEXT.md's **Authored / surfaced (Transit)** entry already carries the definition: two ways one
kind reaches the read model, on opposite sides of the solve — Authored Transit is a traveller-written
optimizer input, at most two per Trip; Surfaced Transit is a station a Journey's rail Path passes
through, derived from the Plan, projected every read, never stored, and therefore an optimizer
output. The entry ends: *"Surfaced Transit is not built yet."*

ADR-0028's Consequences named three blockers: `osmTransitProvider` discarding the station identity it
computes, "the registry's deferred per-Path chaining," and no first consumer for `describeJourney`.
Tracing the current code confirms the first and third are gone — ADR-0030 §7 widened `RideStep` with
`fromStopId`/`toStopId` and `TransferStep` with `clusterId`, and ADR-0032 populates
`PathEndpoint.stationName` from them on every decomposed rail Path; ADR-0029's `path-geometry` route
is a live `describeJourney` consumer. The second blocker's literal precondition — `osmTransitProvider`
exposing its snapped station endpoints — is met by the same ADR-0030 §7 change; `travelCostRegistry.ts`'s
docblock still reads "which it does not yet," which is stale prose, not current behaviour. The
broader feature that docblock describes — per-Path multi-provider chaining, routing a decomposed
walk/transfer leg through `osrm` instead of haversine — remains genuinely unbuilt and unticketed, but
Surfaced Transit was never blocked on that feature, only on the station-identity data it would have
unlocked as a side effect.

Two further facts, traced directly rather than assumed, shaped this decision:

- **The data already reaches the client with no backend change.** `/api/trips/[id]/path-geometry`
  calls `describeJourney` and returns the resulting `Path[]` verbatim — `stationName` included,
  nothing stripped. `usePathGeometry`'s held `PathGeometryMap` already carries everything this
  projection needs.
- **That hook has exactly one caller today: `MapView.tsx`.** If a future consumer (most plausibly
  #139, the itinerary sidebar's transit detail) needs this data outside the Map, threading it there
  is a real decision with its own tradeoffs — not one this ticket should make on that consumer's
  behalf before it exists.

## Decision

**Surfaced Transit is `Transit.authored: false` — a flag on the existing `transit` kind, not a new
kind — produced by a standalone pure function over an already-fetched `Path[]`. Nothing is added to
the stored schema, to `DerivedDay`, or to `trip.locations`.**

1. **`kind: "transit"` is unchanged; `Transit` gains an `authored: boolean` field.** CONTEXT.md's own
   vocabulary treats Authored and Surfaced as two ways the one `transit` kind reaches the read model,
   not two kinds — which argues directly against a fourth `Location` union member like
   `kind: "surfaced-transit"`. A new top-level kind would widen `Location = Activity | Transit |
   Lodging` for every consumer of that type: the optimizer's input builder, the repository's DB-row
   narrowing, `isTransit()`, VROOM request construction — all of which today assume every `Location`
   is either a real DB row or optimizer input, which a surfaced station is never. `authored: true` on
   every stored `Transit` row keeps that assumption intact; `authored: false` marks an entry this
   ADR's projection produced, never a DB row.
2. **A surfaced entry is `Transit`-shaped and satisfies `LocationBase` with sentinel values, not by
   loosening the type.** `LocationBase` requires `id`, `tripId`, and thirteen more fields — several
   of them enrichment/place metadata that means nothing for a station that was never searched or
   enriched. A surfaced entry supplies concrete stubs (`null` for enrichment/place fields, a
   synthetic deterministic id) rather than making those fields optional on `LocationBase` itself,
   which would ripple into every existing `Activity`/`Transit`/`Lodging` consumer to accommodate one
   structurally different kind. `PathEndpoint` already chose this shape for the same problem —
   `locationId` is the optional field on the outlier, not a hole punched in `Point`.
3. **Only the stations strictly between a Journey's own endpoints surface.** A rail Path's `from`/`to`
   also carries `stationName` at the Journey's own boarding/alighting ends — but those coordinates
   already belong to a real, Authored Location, which is what made them the Journey's endpoint in the
   first place. Surfacing them again would be exactly the duplication ADR-0028 §6 named as the reason
   surfaced stations need the `Location` shape at all — a traveller seeing the same place rendered
   twice through two different type paths. Only Path boundaries *between* those two endpoints — the
   transfer points `TransferStep.clusterId` already records — are genuinely new information.
4. **The projection is one standalone function, not a field on `DerivedDay`.** `surfacedTransitOf(paths:
   Path[]): Transit[]`, called directly by whichever future consumer has `Path[]` in hand. Nothing
   about the existing read model changes: `trip.locations`, `day.stops`, and `deriveTripPlanDays` are
   untouched, and no call site is threaded with new data for a feature nothing consumes yet.

## Alternatives considered

- **A new `kind: "surfaced-transit"` union member.** Rejected — contradicts CONTEXT.md's own framing
  of Authored/Surfaced as one kind reaching the read model two ways, and widens `Location` for every
  consumer that currently assumes the union is closed to DB-row-or-optimizer-input-eligible members.
- **Naming the new field `provenance` or `origin`.** Rejected on a vocabulary collision, not a design
  one: CONTEXT.md's **Answered by** entry already reserves both words (`_Avoid_: source, origin,
  provenance`) for a different concept — which registry answered a travel cost. Reusing either here
  would read as a synonym for that, not for this. `authored: boolean` names the actual distinction
  CONTEXT.md's glossary already uses in prose, with no collision.
- **Keeping surfaced stations entirely outside the `Location` primitive**, as rail-graph vocabulary
  (a stop node / station cluster id) surfaced as a property of the Journey instead. This was already
  considered and rejected in ADR-0028 §6's own Alternatives, on the same reasoning restated here: a
  station is a place, and rendering it through a second type path duplicates what the Timeline
  already knows how to draw.
- **Loosening `LocationBase`'s fields to accommodate a sparser kind.** Rejected — the fields in
  question (enrichment status, place metadata) are meaningful and required for every kind that
  actually goes through search/enrichment; punching optional holes in the base type to fit one
  structurally different kind is the wrong end of the tradeoff, and `PathEndpoint` already
  established the alternative pattern for exactly this shape of problem.
- **Surfacing the Journey's own endpoint stations, not just transfer points.** Rejected as a genuine
  duplication of a place the Timeline already renders as a real, Authored Location — see Decision §3.
- **A `DerivedDay.surfacedTransit` field, computed inside `deriveTripPlanDays`.** Would give a future
  consumer a discoverable read-model location without needing to know about `usePathGeometry` — but
  requires threading `Path[]` into `deriveTripPlanDays`, which today reads only stored facts, and
  updating every one of its six call sites across the store and components, for a feature with no
  consumer yet. Rejected as plumbing built ahead of a demonstrated need; the standalone function
  leaves that decision to whichever ticket first needs it wired up.
- **Building per-Path provider chaining first**, on the theory that ADR-0028's second blocker was
  literally about that feature. Rejected once traced: the blocker's precondition (station-identity
  data) is already satisfied by ADR-0030 §7 independent of whether chaining itself is ever built.
  Chaining remains a real, separate, unticketed idea — tracked in #181's Decisions-so-far, not
  resolved or required by this ADR.

## Consequences

- **`isTransit()` never needs to check `authored` in practice.** Every current call site
  (`src/types/index.ts`, `TransitEdgeSlots.tsx`, `optimize.ts`, `tripStore.ts`) operates exclusively
  on `trip.locations` — a real, stored array. Because a surfaced entry is never merged into
  `trip.locations` or `DerivedDay`, none of those call sites can ever see one; the exhaustiveness
  question a shared `kind: "transit"` might otherwise raise is closed by construction, not by
  discipline at each call site. Every stored `Transit` row is written with `authored: true`.
- **`#194` ships a pure function and a type change, no UI change.** The first real rendering consumer
  — most plausibly #139 — decides where `usePathGeometry`'s data (or an equivalent fetch) needs to
  reach, informed by what it actually needs to render; this ADR does not pre-decide that.
- **CONTEXT.md's "Authored / surfaced (Transit)" entry drops "Surfaced Transit is not built yet"** —
  the projection exists once #194 ships, even though nothing renders it yet.
- **The per-Path provider-chaining idea stays exactly where #181 already left it**: real, sharpened,
  not yet ticketed. This ADR resolves Surfaced Transit without touching it.
