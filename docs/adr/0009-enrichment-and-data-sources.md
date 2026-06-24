# ADR-0009: Enrichment & external data sources

- **Status:** Accepted
- **Date:** 2026-06-24
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0007 (background stage), ADR-0008 (persistence)
- **Note:** Decided in the 2026-06-24 grilling session.

## Context

Two distinct flows consume external data:

- **Enrichment** — filling a candidate Location's real-world data (identity, coordinates,
  address, rating, categories, phone, opening hours) from Google Places. Runs in the
  background after import (the one automatic stage, ADR-0007).
- **Discovery** — finding *new* candidate Locations near an anchor. Runs synchronously on
  user request via `/nearby`, drawing on Google Nearby Search and a Tabelog scraper, with
  a static stations table to approximate distances.

Two problems to settle: enrichment's job durability (the queue is an in-memory
`globalThis` singleton whose pending items are lost on restart — its own comment flags
this), and how the sources compose (Google is hardcoded; Tabelog is special-cased and
Japan-only, but nothing enforces that gating).

## Decision

### Enrichment durability: pending rows *are* the queue

The durable work-list is the set of Locations with `enrichmentStatus = 'pending'` — no
separate jobs table. A consumer drains pending rows; **on server startup, re-scan for any
leftover `pending` and re-enqueue them automatically.** The in-memory queue remains only
as an immediate fast-path, never the system of record. This removes the restart
data-loss limitation with no new schema. Manual "Retry" becomes automatic recovery for
`pending`; it is retained for `failed` rows (where a human may want to force a re-attempt).

### Source strategy: Google is the canonical resolver; discovery is pluggable

- **Enrichment is single-provider.** Google Places is *authoritative* for canonical
  identity (`placeId`), coordinates, and opening hours — the spine the optimizer depends
  on. Enrichment is not a multi-source merge.
- **Discovery sits behind a `DiscoveryProvider` interface.** Google Nearby Search is the
  global default. Tabelog is a **regional** provider that **declares its applicability**
  (Japan) and is skipped where it doesn't apply — replacing the incidental
  `nearestPrefecture` gating with an explicit contract. The stations table is a helper a
  provider may use for distance approximation without spending API calls.
- All providers return the common `NearbyPlace` shape. A candidate from a regional
  provider (e.g. a Tabelog result, which has no coordinates) is **resolved to canonical
  Google identity when added to a trip** — so once committed, every Location is
  Google-canonical regardless of where it was discovered.
- COALESCE-style merge (never overwrite good data with null) remains the write rule.

## Alternatives considered

- **Keep in-memory queue + manual Retry.** Rejected: leaves the known restart data-loss
  in place.
- **Dedicated `enrichment_jobs` table.** Rejected: redundant with the `pending` status,
  which already encodes the same work-list.
- **Hardcoded Google + special-cased Tabelog.** Rejected: every new source is bespoke
  wiring and region-gating stays ad-hoc.
- **Symmetric multi-provider merge with precedence.** Rejected: fights the real asymmetry
  (Google is the resolver, not one-of-N) and invites merge-conflict complexity with no
  current payoff.

## Consequences

- Enrichment recovery becomes automatic; the consumer must run a startup scan for
  `pending` rows (and the durable queue is now restart-safe).
- A `DiscoveryProvider` interface is introduced; Google Nearby and Tabelog become its
  implementations, with Tabelog declaring `region: Japan`. Adding Yelp / another regional
  source is a contained new provider, not a route rewrite.
- Tabelog's ToS sensitivity (scraping, ≥2s throttle, robots paths) stays the provider's
  internal concern, isolated behind the interface.
- Enrichment stays Google-only and authoritative; if a future source should *contribute*
  fields (not just discover), that is a new decision, not assumed here.
- Time-varying data (weather, live conditions) is **not** enrichment (it isn't a static
  property of a place) and is out of scope for this ADR.
