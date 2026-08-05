# ADR-0021: Leg renamed to Path — the travel primitive on the edge axis

- **Status:** Accepted
- **Date:** 2026-08-05
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0004 (introduces "Leg" informally), ADR-0018 (formally adopts "Leg" as
  domain vocabulary, defines its interface shape), ADR-0019 (uses "Leg" throughout; adds the
  rail-graph vocabulary this ADR builds on)
- **Constrained by:** ADR-0009 (Location as the one place primitive — the precedent this ADR
  extends to the edge axis)
- **Note:** Decided in the 2026-08-05 grilling session for
  [Surface OSM-Japan transit leg detail in the itinerary UI (#139)](https://github.com/Tyler-Reagan/trip-kraken/issues/139),
  once designing that ticket's UI exposed that "Leg" was carrying more than one concept.

## Context

Charting how transit detail should surface in the itinerary UI (#139) forced two questions
CONTEXT.md's existing **Leg** entry couldn't answer: what *kind* of travel a Leg was (rail?
bus? walking?), and who *operates* it — a fact Japan's transit reality needs directly, since
JR splits into regional operators (JR East, JR West, ...) standing alongside private
railways, and through-services can change operator mid-line.

Modeling "kind" and "Operator" onto Leg directly would have worked structurally, but it
would have quietly duplicated a shape the domain already has: Location is one primitive
narrowed by `kind`, with kind-specific fields (ADR-0009). The travel segment between two
Placements wanted the same treatment on the edge axis — one primitive, narrowed by `kind`,
carrying kind-specific fields like Operator — and "Leg" was already taken by the older,
narrower definition (CONTEXT.md: "the travel segment between consecutive Placements... within
a Day").

Two names for adjacent concepts were considered and rejected before "Path": **"Leg"** for the
new primitive would have *inverted* the meaning of every sentence in ADR-0018 and ADR-0019
that used it, which is worse than an outdated name — those ADRs are immutable, and a future
reader taking their "Leg" at face value would build on a meaning this ADR abolishes.
**"Route"** collides head-on with OSM's own vocabulary: a rail line is modeled in OSM as a
`route=*` relation, so naming the travel-primitive "Route" would have put this project's
central travel concept and its own ingestion pipeline's tag name in direct opposition.

## Decision

**Leg retires as a domain term.** What it named — the single travel segment between two
consecutive Placements (or a Day's Anchor and its first/last Placement) — is renamed **Path**,
mirroring Location's shape: one travel primitive, narrowed by a `kind` (`rail` · `bus` ·
`walking` · `driving` · `bicycle`), carrying kind-specific fields. `kind` is optional — a
Path whose Basis is `straightLine` had no route computed, so it has no honest kind to claim.

A Path stays **atomic per edge**, not decomposed into sub-Paths: ADR-0018 §3 already defines
a transit journey as the composite door-to-door trip (walk to the station, ride, walk from),
and nothing in the current graph (buses are excluded — ADR-0019) produces a genuinely mixed
multi-kind journey that would need decomposing. This can be revisited without breaking the
rename if that changes.

**Operator** joins the vocabulary as a field the `rail`/`bus` kinds carry (walking never has
one; driving may not) — explicitly *not* a property of a rail line, since a through-service
can change Operator along one line's length. Where an Operator boundary falls within a line
is not yet modeled; nothing in the current graph or providers computes it.

**Rail line** and **Basis (Path)** are formalized as glossary terms (see CONTEXT.md), both
already implicit in `osmTransitProvider.ts`'s `lineNames`/`transferCount` fields and the
routed/fallback split, but never named as domain concepts before now.

No day-wide replacement term is introduced. "Leg" used to mean one edge, not a Day's whole
travel, and nothing in this reshape needed a name for the latter — CONTEXT.md keeps "the
Day's Paths" as a phrase, not a concept, until something actually operates on that
collection as a unit.

**Scope: vocabulary only, this ADR.** The `Leg`/`LegDetail`/`describeLeg` identifiers in
`src/lib` (`travelCost.ts`, `travelCostRegistry.ts`, `osmTransitProvider.ts`,
`googleRoutesProvider.ts`, `transitGraph.ts`, and their tests — 63 references across 11
files) are renamed to `Path`/`PathDetail`/`describePath` in a **separate, purely mechanical
follow-up PR**, sequenced ahead of #139's UI build so that build is written against the new
names from the start. This ADR's own reasoning stands regardless of when that rename lands.

## Alternatives considered

- **Keep "Leg", model kind/Operator as fields on it.** Rejected: works, but forgoes the
  Location-primitive symmetry for no reason other than not wanting to rename — and the
  rename cost is one contained, mechanical PR.
- **Promote "Leg" to the day-wide collection, coin a new word for the single edge.**
  Considered directly in the grilling session. Rejected: inverts ADR-0018/0019's accepted
  text rather than merely outdating it, and common usage ("a leg of the journey") already
  means one segment, not a day's worth.
- **"Route" for the edge primitive.** Rejected: collides with OSM's `route=*` relation tag,
  which this project's own ingestion pipeline reads directly (`transitGraphIngest.ts`).
- **Amend ADR-0018/ADR-0019 in place to say "Path".** Rejected: violates ADR immutability —
  those records should keep describing the decision as it was actually made, at the vocabulary
  that was current then. CONTEXT.md's Path entry carries the mapping note instead.

## Consequences

- CONTEXT.md's **Leg** entry is replaced by **Path**, **kind (Path)**, **Operator**, and
  **Basis (Path)**; **Rail line** is promoted from an implicit fact to a formal entry;
  **Station cluster** and **Rail graph** are lightly resharpened; **Travel mode** gains an
  explicit contrast clause against Path kind.
- `src/lib`'s `Leg`/`LegDetail`/`describeLeg` symbols are stale until the follow-up rename
  PR lands; that PR is a prerequisite for #139's build, not an independent cleanup.
- ADR-0004, ADR-0018, and ADR-0019 keep using "Leg" in their original text, unaltered — a
  reader encountering it there should treat it as this ADR's "Path".
- **Bills that come due later:** the Operator-boundary-within-a-line question (where a
  through-service actually changes operator) is real and unmodeled — flagged to
  [Wayfinder: Japan transit Phase 2 (#140)](https://github.com/Tyler-Reagan/trip-kraken/issues/140)
  as a fog item, since it's what an accurate inter-operator transfer cost would need. Route
  *geometry* for a Path (as opposed to the inter-station distance the graph already carries)
  is a distinct, unstarted capability — tracked as a fresh decision ticket on #140, not this
  ADR.
