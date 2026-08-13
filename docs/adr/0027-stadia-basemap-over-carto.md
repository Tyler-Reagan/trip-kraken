# ADR-0027: Stadia Maps replaces CARTO as the basemap provider

- **Status:** Accepted
- **Date:** 2026-08-12
- **Supersedes:** —
- **Superseded by:** —

## Context

`MapView.tsx` has hardcoded `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` — a
keyless CARTO endpoint — as the app's only basemap since the map view was built. CARTO's own
`LICENSE.md` restricts that tile service to enterprise customers and non-profit grantees and states
plainly it is "not available for free public use." There is no self-serve or free tier to move into;
enterprise is the only published tier, and CARTO publishes no price for it. The endpoint answering
keyless HTTP 200 is not a grant of licence — it is simply not gated technically. Full citations:
`docs/research/2026-08-05-map-rendering-stack.md` §3a (measured 2026-08-05); terms re-verified
2026-08-12 while making this decision.

Separately, ODbL §4.3 obliges an attribution notice wherever OSM-derived data reaches a user. The
app's footer (`src/app/layout.tsx`) already carries a base OSM credit for the Japan rail graph
(ADR-0019), but `MapView.tsx` itself asserted no attribution control — it relied on whatever the
tile provider's TileJSON happened to declare, and CARTO's own TileJSON omits the OpenMapTiles credit
its license requires. Issues [#145](https://github.com/Tyler-Reagan/trip-kraken/issues/145) and
[#150](https://github.com/Tyler-Reagan/trip-kraken/issues/150) track the provider violation and the
attribution gap respectively; both land in the same file and the same change.

## Decision

We will replace the CARTO basemap with **Stadia Maps' Alidade Smooth Dark** style
(`https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json`), and force `MapView.tsx`'s
`AttributionControl` into its non-compact form (`compact={false}`) rather than leave MapLibre's
default compact one, which needs a click to reveal — the OSMF guideline this closes is that
attribution "should not require individuals to interact with the map." We deliberately do **not**
hardcode the attribution text: Stadia's style JSON declares an accurate, complete string (verified
2026-08-12, unlike CARTO's, which silently omitted a credit its own license required), and a second,
hand-written string next to it would duplicate what the control already renders — confirmed as a
real bug during implementation (visually, the corner showed the credit twice) and reverted before
landing. `compact={false}` is the whole fix; the text itself stays sourced from the style.

Stadia's keyless-localhost path (no API key required, subject to a strict but unpublished rate
limit) covers all current dev/personal use with no account or key management. An optional
`NEXT_PUBLIC_STADIA_API_KEY` env var is wired for when a key is later warranted (production
domain-based auth, or exceeding the localhost rate limit) — none exists today.

Credit-cost math for our actual usage (verified 2026-08-12, `docs.stadiamaps.com`/
`stadiamaps.com/pricing`): a standard vector basemap tile costs **1 credit**; the free tier grants
200,000 credits/month. Geocoding and routing, which cost far more per request (20+ credits), stay
with Google and OSRM respectively and are never routed through Stadia. ⚠️ **Not independently
measured**: the exact tiles-per-session figure was left as an estimate. Tile fetches happen inside
MapLibre's Web Worker, which doesn't surface in the main document's Resource Timing API — the tool
used for this session's browser verification couldn't count them, though visual verification (Tokyo
metro area, several tiles, multiple zoom levels) confirmed rendering with zero errors. A rough bound
holds regardless: even a generous 200 tiles/session is 1,000 sessions/month of headroom, and the
keyless-localhost path (all current usage) bills no credits at all — there's no account behind it.
If this ever needs a precise number, Chrome DevTools' Network tab filtered to `tiles.stadiamaps.com`
during a real session is the direct way to get one.

## Alternatives considered

- **MapTiler Flex.** Free tier explicitly forbids commercial use ("suitable for testing, personal
  or non-commercial use"); cheapest commercial tier is $30/mo. Rejected for now — no cheaper than
  Stadia and no better fit for a project that isn't commercial today anyway.
- **Raw OSM raster tiles (`tile.openstreetmap.org`).** No published rate limit or SLA, prohibits
  any pre-emptive/bulk fetching, raster-only, and has no dark style — a straight downgrade from the
  current vector, dark-themed rendering (`LODGING_COLOR = "#e5e7eb"`, dark tooltip chrome, etc.).
  Rejected on rendering-quality grounds alone.
- **Self-hosted PMTiles (Protomaps).** The only option with zero third-party terms — its sole
  obligation is the same ODbL attribution every option here owes. Rejected *for now*, not
  permanently: it requires a `pmtiles extract` from Protomaps' daily planet build, a hosting
  decision (S3/Cloudflare/etc.), and porting a dark style, none of which is justified while a
  free, zero-maintenance hosted option (Stadia) already satisfies personal-scale usage. This is the
  documented exit if trip-kraken ever needs commercial use — see Consequences.
  (`docs/research/2026-08-05-map-rendering-stack.md` §4c/§4d.)
- **Attribution-control-only, keep CARTO.** Would close #150's remainder but leave #145's actual
  licence violation untouched. Rejected — the point of #145 is that the provider itself is
  out of bounds, not just under-credited.

## Consequences

- **The basemap now has a compliant, if commercial-restricted, provider.** Stadia's free tier
  explicitly forbids commercial use and use by any for-profit organization; trip-kraken is neither
  today, so this is a real fit, not a workaround. If that changes, Stadia Starter is $20/mo
  (1,000,000 credits/mo) — budget for that cost, or migrate to self-hosted PMTiles (the alternative
  above) as the terms-free exit.
- **`MapView.tsx` now forces attribution to be visibly present, but the text itself still comes
  from the provider's style.** A future basemap swap inherits whatever that provider declares — if
  it is ever incomplete (as CARTO's was), the fix is a hardcoded `customAttribution` override at
  that point, not a standing one kept here pre-emptively.
- **An optional API key path exists but is unused.** `NEXT_PUBLIC_STADIA_API_KEY` is read if
  present; nothing today sets it. If localhost rate limits become a problem, or the app is ever
  deployed off `localhost`, a free Stadia account and key are the fix — no code change needed.
- **The footer's three-clause OSM/OSRM/VROOM credit (ADR-0024) is unaffected.** It still ships only
  once OSRM and VROOM are actually wired in (PR 3/5); this ADR only changes the basemap's own
  on-map attribution.
