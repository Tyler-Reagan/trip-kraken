# ADR-0034: The map rendering stack stays as-is; station labels are added client-side

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0027 (Stadia replaces CARTO as the basemap provider — this ADR does not
  reopen that choice), ADR-0029 (map renders Path geometry at request time — the overlay this ADR's
  §5 concerns), ADR-0030 (rail geometry traced from the same OSM ways the basemap draws)

## Context

[#144](https://github.com/Tyler-Reagan/trip-kraken/issues/144) chartered three separable questions
under map [#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181): renderer choice, basemap
provenance, and Japan-specific rendering quality — deliberately facts-only, per its own scope rule,
with the actual decision deferred to a grilling session. Two research passes fed that session:
[`docs/research/2026-08-05-map-rendering-stack.md`](../research/2026-08-05-map-rendering-stack.md)
(CARTO-era) and [`docs/research/map-rendering-stack-144-refresh.md`](../research/map-rendering-stack-144-refresh.md)
(2026-08-21, re-measured against Stadia after ADR-0027 replaced CARTO, plus a live-app measurement of
the running dev server). Basemap provenance itself was already decided by ADR-0027, before this map
was chartered; #144 confirmed nothing there had drifted.

The refresh surfaced two concrete, present-tense facts the grilling session had to weigh:

1. **The overlay conflict is a width-and-geometry collision, not a visibility one.** Stadia's
   `railway` layer draws at `#545353`, exactly 3 px wide from z13–z16 — identical to the Path
   overlay's own constant `line-width: 3` (`MapView.tsx:339`), over the same OSM ways ADR-0030
   traces. `STOP_ZOOM = 14` puts every deliberate camera move inside that band.
2. **Every station name is downloaded and thrown away at paint time, under both providers.** The
   measured Tokyo tile carries 46 `class=railway` POIs (6 `subclass=station`, 40 `subclass=subway`),
   all with full `name`/`name:latin`/`name:nonlatin` coverage — but Stadia's style has exactly three
   `poi`-sourced layers, filtered to park/university/hospital, matching 0, 0 and 1 features on that
   tile. `class=railway` appears in no filter in the style. Rail *line* names (山手線, 丸ノ内線) are
   unobtainable from any basemap tile evaluated, under either provider — `transportation` features
   carry no `name` key and `transportation_name` has no rail/transit entries — and can only come from
   the app's own rail graph (ADR-0030 §7, ADR-0032).

## Decision

**We will change nothing about the renderer or basemap provider, and add one new piece of app code:
a client-side station-label layer.**

1. **Renderer stays MapLibre GL JS.** No alternative evaluated (Leaflet, OpenLayers, deck.gl) offers
   a capability MapLibre lacks for this app's actual usage, and each carries a real cost MapLibre
   doesn't: Leaflet's React binding is stale and non-OSI-licensed; OpenLayers has no first-party
   React binding; deck.gl is additive on top of MapLibre, not a replacement for it.
2. **Basemap stays Stadia Maps, on the keyless-localhost path.** ADR-0027's decision is reaffirmed,
   not reopened. The app is deliberately local-only and undeployed (ADR-0025), so the keyless path
   covers all current real usage; a real measured session used 49–232 `.pbf` requests against a
   200,000-credit/month free allowance — two to three orders of magnitude of headroom regardless of
   which end of that range Stadia actually bills.
3. **Self-hosted PMTiles remains deferred.** Its exit condition is the one ADR-0027 already
   recorded — trip-kraken becoming a for-profit product, or usage outgrowing Stadia's free tier —
   not a new one invented here. Nothing found in this ADR's research changes that calculus.
4. **We will add a client-side MapLibre layer that labels railway stations,** sourced from the
   already-loaded `openmaptiles` source rather than by forking Stadia's style document:
   - Filter: `poi` layer, `class == "railway"`, both `subclass` values (`station` and `subway`) —
     both carry full name-field coverage, and excluding `subway` would drop 40 of the 46 measured
     stations, most of what a traveler navigating on foot actually orients by.
   - Label text: `{name:latin}\n{name:nonlatin}`, matching the convention every other label layer in
     this exact style already uses (§A7) — no existing layer in the style picks one script only.
   - Zoom gate: from roughly z13, matching where Stadia's own `railway` line layer begins drawing and
     close to where the app's camera settles (`STOP_ZOOM = 14`). The existing `poi_gen1`/`poi_gen0_*`
     layers filter to `rank <= 3`; our stations measure `rank` 26–71, so this layer's own zoom/rank
     tuning is worked out fresh in implementation rather than copied from an existing layer.
5. **The overlay/rail width collision is left as-is, visually confirmed, and documented rather than
   engineered around.** A real screenshot in Shinjuku confirmed the amber Path line stays separable
   from the grey basemap rail by hue despite the shared 3 px width. `MapView.tsx`'s Path overlay
   style definition gets a one-line comment recording the collision and pointing at the research
   file, so a future `DAY_COLORS` change doesn't blindly lose the separation this ADR verified.

## Alternatives considered

- **Switching renderer (Leaflet, OpenLayers, deck.gl).** Rejected — no defect in MapLibre for this
  app's actual usage, and each alternative has a real, measured cost of its own (§Q2 of the 2026-08-05
  research; re-confirmed unchanged in the refresh's §B).
- **Moving to MapTiler or self-hosted PMTiles now.** Rejected — no near-term for-profit plans, the
  app is undeployed today, and usage headroom against Stadia's free tier is enormous either way. This
  is the same conclusion ADR-0027 reached, reaffirmed rather than re-litigated.
- **Forking Stadia's style document to add station labels.** Rejected — Stadia publishes no licence
  for its style document at all, unlike CARTO's BSD-3-licensed one, so forking carries an unresolved
  legal question. A client-side `addLayer` against the already-loaded source is a distinct act from
  forking the document (only the latter is licence-encumbered) and is strictly simpler besides.
- **Labelling only `subclass=station` (6 of 46 measured stations).** Rejected — would drop nearly
  every metro entrance in central Tokyo, which is most of what a traveler on foot actually orients
  by. Both subclasses carry full name-field coverage, so nothing is lost by including `subway`.
- **A single-script label (English-only, or Japanese-only).** Rejected — every other label layer in
  this exact style already renders both scripts newline-joined; diverging would be visually
  inconsistent with the basemap's own established convention for no benefit, on a tool a bilingual
  traveler is using to plan a trip.
- **Pre-emptively re-tuning the Path overlay's colour or width to guarantee separation from basemap
  rail under any future palette.** Rejected — today's separation is confirmed working by a real
  render; engineering against a hypothetical future recolour is the kind of premature work this
  project avoids. A comment for the next person to consult is proportionate; a new mechanism is not.

## Consequences

- **`MapView.tsx` gains a new symbol layer** — filter, paint and layout worked out against the
  `openmaptiles` source's `poi` layer, distinct from the app's own `stops`/`routes` sources. It rides
  entirely on Stadia's current tile schema (`class`/`subclass` values, `name:latin`/`name:nonlatin`
  fields); if that schema ever changes, or a future basemap swap doesn't carry the same fields, the
  labels silently stop rendering rather than erroring — a real coupling this decision accepts, and
  the layer's own filter is where a future debugger should look first.
- **Self-hosting stays formally deferred** with ADR-0027's exit condition as the only trigger. No new
  ADR is needed to revisit this unless that condition changes.
- **The overlay-collision comment is documentation only** — no rendering change. It creates a real
  obligation: a future change to `DAY_COLORS` or the Path overlay's rail-adjacent hues should check
  the comment (and `docs/research/map-rendering-stack-144-refresh.md` §A4/§F6) before assuming the
  separation still holds.
- **Rail line names remain entirely out of the map canvas's scope.** Confirmed unobtainable from any
  evaluated basemap tile under either provider; that data can only come from the app's own rail graph
  (ADR-0030 §7, ADR-0032) and is #139's territory (itinerary sidebar), not this map's.
