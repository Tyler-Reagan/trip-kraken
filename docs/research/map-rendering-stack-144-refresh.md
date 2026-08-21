# Research refresh: the map rendering stack against Stadia, not CARTO

**Date:** 2026-08-21
**Feeds:** [#144 — Evaluate the map rendering stack and OSM data ownership](https://github.com/Tyler-Reagan/trip-kraken/issues/144) (part of #181)
**Status:** Facts only. This document deliberately makes **no recommendation** — no renderer verdict,
no basemap verdict, no self-hosting verdict. That is a later grilling session's job. Where a fact
looked like it wanted to become advice, it is written instead as a constraint the decision must
respect.

## What this refresh supersedes, and what it does not

This is a **refresh of [`2026-08-05-map-rendering-stack.md`](./2026-08-05-map-rendering-stack.md)**,
not a replacement. That file is still the reference for most of #144. Go there, not here, for:

| still stands — read it there | where |
|---|---|
| Renderer-independence of our own overlay geometry; the `ol/format/Polyline` refutation; axis-order caveats | §Q1 |
| Renderer comparison on capability, React-binding maturity, vector/raster support, `MapView.tsx` ergonomics, licensing and governance, the MapLibre/Mapbox history | §Q2 (2b re-measured below) |
| CARTO's licence position, MapTiler's tiers, `tile.openstreetmap.org`'s policy, ODbL/OSMF attribution obligations | §Q3a, §3b, §3e, §3f |
| planetiler's input/requirements/flags, the Protomaps `pmtiles extract` path, PMTiles hosting | §Q4a–§4d (re-checked below, unchanged) |
| Protomaps' documented localization model (`name`/`name2`/`name3` + `script`) | §5d |
| Shared-machinery analysis between the rail-graph and basemap pipelines | §Q6 |

**Superseded by this file, and why:**

1. **§Q5 in its entirety** — it measured **CARTO Dark Matter**, which
   [ADR-0027](../adr/0027-stadia-basemap-over-carto.md) (2026-08-12) removed from the app. The style
   `MapView.tsx` loads today is Stadia's Alidade Smooth Dark. Every §Q5 number — layer count, rail
   colour, script-selection rule, per-layer feature counts — is about a style the app no longer
   loads. §A below redoes it with the same method against the live style and a live tile.
2. **§Q3c (Stadia)** — that subsection was written as one row in an alternatives table. Stadia is
   now the shipped provider, and ADR-0027 explicitly left one measurement open. §C below re-verifies
   the terms and closes the arithmetic half of that gap.
3. **§Q2b's version table and §Q2a's bundle numbers** — version drift only. §B below re-measures.
   Nothing structural moved.
4. **§Q3a's "the current basemap is used outside its published licence"** — a status fact about
   `main` on 2026-08-05. It is no longer a status fact about `main`. CARTO's *terms* as quoted there
   are unchanged and still correct as a description of CARTO.

Two smaller drifts worth flagging so old citations resolve: the pinned Geofabrik snapshot has moved
out of `scripts/ingest-transit-graph.sh` into **`scripts/osm-snapshot.env`** (`OSM_SNAPSHOT="260101"`,
`OSM_RAIL_REGION="asia/japan"`), and §Q5c's overlay-conflict paragraph was written when #142's traced
rail geometry was hypothetical. It has since shipped —
[ADR-0030](../adr/0030-rail-segment-geometry-ingest-and-partial-path-shapes.md) and
[ADR-0032](../adr/0032-rail-journey-decomposes-per-shift.md) — so §A4 restates that conflict as a
present-tense measurement rather than a forecast.

## How these findings were produced

The same two evidence classes as the prior pass, kept distinct throughout:

1. **Documentation** — official docs, licence files and READMEs for Stadia Maps, planetiler,
   Protomaps, MapLibre and OpenMapTiles. Cited by URL. Quoted verbatim where the wording is
   load-bearing.
2. **Measurement** — the npm registry and published `dist` artifacts measured directly; the *exact*
   style URL `MapView.tsx` loads fetched and parsed; the TileJSON it transitively loads fetched and
   parsed; a real Mapbox Vector Tile over Tokyo Station downloaded and decoded feature-by-feature;
   HTTP status codes and headers observed directly; and MapLibre's own published style-spec
   evaluator run against the style's own paint values.

The tile measurement corpus is **z14/14552/6451**, the Stadia `openmaptiles` tile containing Tokyo
Station (35.6812 N, 139.7671 E) — **708,440 bytes raw, 380,035 bytes gzipped**. Decoded with a
hand-rolled MVT reader (protobuf wire-format walk; layers → keys/values → per-feature tag pairs),
the same method §Q5c used, so the two tiles are directly comparable.

Everything marked **⚠️ unverified** is something I could not tie to a primary source. They are
enumerated at the end.

**Split of work:** §A–§E were produced without starting a dev server or using browser tooling. The
live-app half — everything requiring the running application — was measured separately and is §F.
§C covers only the terms and the arithmetic; §F covers what the app itself does, and records why the
one figure ADR-0027 wanted **still could not be taken**.

---

## A. Japan-specific rendering quality, measured against Stadia

**Bottom line: the decisive CARTO finding survives the provider swap unchanged — every station name
is in the tile and thrown away at paint time. Measured on the Tokyo Station tile: 46 `class=railway`
POIs, all 46 carrying `name`, `name:en`, `name:latin` and `name:nonlatin` (東京 / Tokyo), against a
style whose only three `poi` layers filter to park, university and hospital. Rail *line* names remain
unobtainable: 173 `class=rail` features, **zero** with a `name` key, and zero rail entries in
`transportation_name`. Two things did change, and both matter. First, script selection is no longer
an either/or: Stadia selects on `name:latin` + `name:nonlatin` and renders **both, stacked on two
lines**, so the OpenMapTiles `name_en` deprecation the prior pass flagged against CARTO does not
apply here at all. Second, the overlay conflict got sharper, not softer. Stadia draws rail from the
same `minzoom: 13` as CARTO but in `#545353` on a `#333333` canvas — a 1.65:1 luminance ratio where
CARTO's `#1a1a1a` on `#0e0e0e` was 1.11:1 — plus a lighter `#7f7d7e` dash on top at 3.09:1. And the
width collides exactly: MapLibre's own evaluator puts Stadia's `railway` line at 3.000 px for every
zoom from 13 through 16, which is the identical constant `"line-width": 3` our Path overlay uses.**

### A1. What the style contains — measured

`GET https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json` → **HTTP 200, 29,820 bytes**, no
API key, no `Referer`, no `Origin`.

| property | value | CARTO, for comparison (§5a) |
|---|---|---|
| `name` | **`Alidade Smooth`** | `Dark Matter` |
| `version` | 8 | 8 |
| `metadata` | `{"mapbox:autocomposite": false, "openmaptiles:version": "3.x"}` | — |
| sources | one: `openmaptiles` → `https://tiles.stadiamaps.com/data/openmaptiles.json` (**vector**) | one: `carto` (vector) |
| source maxzoom | **14** (overzoomed above) | 14 |
| tile URL | `https://tiles.stadiamaps.com/data/openmaptiles/{z}/{x}/{y}.pbf` | `…/carto.streets/v1/…` |
| glyphs | `https://tiles.stadiamaps.com/fonts/{fontstack}/{range}.pbf` | — |
| sprite | `https://tiles.stadiamaps.com/styles/alidade-smooth-dark/sprite` | — |
| background | `hsl(0, 0%, 20%)` = **`#333333`** | `#0e0e0e` |
| total layers | **53** (24 symbol, 19 line, 8 fill, 1 background, 1 `ref`-only) | 93 |
| rail-related layers | **4** | 4 |

Two oddities, both factual and neither consequential on its own:

- The style's own `name` field reads **`Alidade Smooth`**, the *light* variant's name, while the
  `sprite` URL correctly points at `alidade-smooth-dark`. The dark style identifies itself by the
  light style's name.
- One layer, `railway_dashline`, has **no `type`, `source`, `source-layer`, `filter` or `minzoom` of
  its own** — it is a `{"ref": "railway"}` layer, inheriting all of them from `railway` and
  overriding only `paint`.

### A2. The four rail layers, verbatim

All read `source-layer: transportation`, filtered on `class == "rail"`.

| layer | type | minzoom | filter beyond `class=rail` | `line-color` | `line-width` |
|---|---|---:|---|---|---|
| `railway` | line | **13** | `["!has","service"]`, LineString | **`#545353`** | `{base: 1.3, stops: [[16,3],[20,7]]}` |
| `railway_dashline` | *(inherits `railway` via `ref`)* | **13** | *(inherited)* | **`#7f7d7e`**, `line-dasharray: [3,3]` | `{base: 1.3, stops: [[16,2],[20,6]]}` |
| `railway_service` | line | 16 | `["has","service"]`, LineString | `#545353` | `3` (constant) |
| `railway_service_dashline` | line | 16 | `["has","service"]`, LineString | `#7f7d7e`, `line-dasharray: [3,3]` | `2` (constant) |

There is no `tunnel_rail` equivalent — Stadia draws tunnelled rail with the same layers as surface
rail, so the `brunnel: tunnel` features (the majority of them on this tile, see A5) render
identically to at-grade track.

**Measured contrast against the style's own background `#333333`** (WCAG relative-luminance ratio,
computed from the style's own hex values):

| | Stadia | CARTO (§5a values) |
|---|---:|---:|
| rail stroke vs. background | `#545353` on `#333333` = **1.65:1** | `#1a1a1a` on `#0e0e0e` = **1.11:1** |
| rail dash vs. background | `#7f7d7e` on `#333333` = **3.09:1** | `#111111` on `#0e0e0e` = **1.02:1** |

The prior pass's characterisation of CARTO — "a hair above black … present but visually recessive by
design" — does not transfer. Stadia's rail is drawn to be seen.

### A3. Rendered line width across zoom — measured with MapLibre's own evaluator

The `stops` arrays above are legacy function objects; what they evaluate to below their first stop is
not stated in the style-spec prose. Rather than assume, I ran them through
`@maplibre/maplibre-gl-style-spec@26.2.1`'s `convertFunction` + `createPropertyExpression`. The
converted expression is `["interpolate",["exponential",1.3],["zoom"],16,3,20,7]`, and it evaluates to:

| zoom | `railway` px | `railway_dashline` px |
|---:|---:|---:|
| 13 | **3.000** | 2.000 |
| 14 | **3.000** | 2.000 |
| 15 | 3.000 | 2.000 |
| 16 | 3.000 | 2.000 |
| 17 | 3.647 | 2.647 |
| 18 | 4.487 | 3.487 |
| 20 | 7.000 | 6.000 |

### A4. The overlay conflict, now concrete

`src/components/MapView.tsx` today:

- `const STOP_ZOOM = 14;` (line 39) — used as the `flyTo` zoom for a single-stop focus target
  (line 399) **and** as the `maxZoom` ceiling on every `fitBounds` (line 405).
- `computeInitialViewState` (lines 89–107) returns `zoom: 10` for a Trip with no valid coordinates,
  `zoom: 14` for exactly one, and `zoom: 11` for a fitted multi-Location bounds.
- `routeLayer.paint` (lines 336–341): `"line-width": 3`, constant, with `line-color` and
  `line-opacity` read per-feature via `["get","color"]` / `["get","alpha"]`.

So, factually:

1. **The basemap starts drawing rail at z13.** Of the app's three initial-camera cases, two sit
   *below* that threshold (z10 with no valid coordinates, z11 for a fitted multi-Location bounds) and
   one sits *above* it (z14 for a Trip with exactly one valid Location). Every deliberate focus
   thereafter lands at z14 or below — `flyTo` at exactly `STOP_ZOOM = 14`, `fitBounds` capped at 14.
   The app's most-used zoom range therefore *straddles* the z13 threshold, exactly as §5c found for
   CARTO. The threshold has not moved; only what is drawn at it has.
2. **The widths are identical at the zooms that matter.** Our Path lines are a constant 3 px. Stadia's
   `railway` is 3.000 px from z13 through z16. At z13–14 the two are the same stroke weight.
3. **The geometry is the same geometry.** ADR-0030 traces rail shapes from `way` members of OSM route
   relations inside the pinned `260101` Japan Extract; Stadia's `transportation` layer is OpenMapTiles
   built from the same OSM ways. Where a rail Path has real spans, they lie on top of basemap lines
   derived from the same source data — not merely nearby.
4. **What separates them is hue and opacity, not luminance.** The overlay palette
   (`src/lib/dayColors.ts`) is 14 saturated hues at a fixed HSL(_, 62%, 58%); the basemap rail is
   near-neutral grey. Composited over `#333333`, the measured luminance ratios against the basemap's
   rail stroke are:

   | day-alpha tier (`MapView.tsx:47-51`) | vs. background `#333333` | vs. `railway` `#545353` | vs. `railway_dashline` `#7f7d7e` |
   |---|---|---|---|
   | `ALPHA_ACTIVE = 1` | 2.16–7.53 | 1.31–4.57 | 1.02–2.44 |
   | `ALPHA_METRO = 0.55` | 1.49–3.42 | 1.02–2.07 | 1.01–2.07 |
   | `ALPHA_REST = 0.28` | 1.21–1.91 | 1.01–1.37 | 1.62–2.56 |

   Ranges are across all 14 day colours. Luminance ratio ignores hue, so these numbers understate how
   separable a saturated colour is from grey; they are reported because they are the part that can be
   computed from primary values. The visual question they cannot answer is ⚠️ unverified here — see
   the ⚠️ list.

### A5. Tile-data measurement — z14/14552/6451, Tokyo Station

**Fetching it required a header the prior pass did not need.** Bare `GET` on the tile URL returns
**HTTP 401** with a 14,885-byte 512×512 PNG error tile reading *"401 Error / Invalid Authentication /
Learn more at docs.stadiamaps.com/authentication"*. Adding either `Referer: http://localhost:3000/`
or `Origin: http://localhost:3000` returns **HTTP 200, `content-type: application/vnd.mapbox-vector-tile`,
708,440 bytes** (380,035 gzipped). The style JSON, by contrast, serves keyless with no header at all.

Decoded, 13 layers:

| layer | features | keys |
|---|---:|---:|
| `poi` | **5,212** | 73 |
| `transportation` | **3,685** | 15 |
| `building` | 1,416 | 7 |
| `transportation_name` | **679** | 77 |
| `landcover` | 335 | 2 |
| `housenumber` | 227 | 1 |
| `place` | 184 | 73 |
| `boundary` | 73 | 5 |
| `landuse` | 48 | 1 |
| `water` | 39 | 3 |
| `aeroway` | 17 | 2 |
| `waterway` | 16 | 72 |
| `water_name` | 4 | 71 |

All layers are MVT `version 2`, `extent 4096`.

**Rail lines — the finding is identical to CARTO's, at 10× the feature count:**

```
transportation: 3,685 features
  class=rail:            173
  ├─ with a `name` key:    0      ← the decisive number
  ├─ with `service`:      62      (Stadia's railway_service layer, minzoom 16)
  └─ without `service`:  111      (Stadia's railway layer, minzoom 13)
  keys ever seen on a rail feature: brunnel, class, layer, oneway, ramp, service, subclass
  subclass: all 173 are `rail`
```

Sample features, verbatim:

```json
{"class": "rail", "subclass": "rail", "oneway": 1, "ramp": 0, "brunnel": "tunnel", "layer": -5}
{"class": "rail", "subclass": "rail", "oneway": 0, "ramp": 0, "brunnel": "tunnel", "service": "siding", "layer": -5}
{"class": "rail", "subclass": "rail", "oneway": 0, "ramp": 0, "brunnel": "tunnel", "service": "crossover", "layer": -5}
```

There is also a **`class=transit` group with 47 features, every one `subclass=subway`** — a class
CARTO's `carto.streets` tile did not carry and which **no Stadia layer references**. Tokyo's subway
lines are in the tile as their own class and are drawn by nothing.

`transportation_name`: 679 features, **0 rail and 0 transit**. Its class histogram is roads only
(`path` 497, `secondary` 67, `motorway` 32, `trunk` 23, `tertiary` 19, `service` 14, `minor` 14,
`primary` 11, `motorway_construction` 2). Same as CARTO: **line identity — 山手線, 丸ノ内線 — is not
obtainable from these tiles at any zoom, and can only come from our own rail graph.**

**Station POIs — present, complete, and unrendered:**

```
poi: 5,212 features
  class=railway: 46      (subclass: subway 40, station 6; all geometry-type Point)
  rank range on those 46: 26–71
  name-key coverage across all 46 class=railway features:
    name 46/46   name:en 46/46   name:latin 46/46   name:nonlatin 46/46
    name_en 46/46  name_de 46/46  name_int 46/46   name:ja 45/46   name:ko 46/46
    name:ru 41/46  name:es 43/46  name:zh 25/46    name:fr 16/46   name:th 8/46
```

The six `subclass=station` features, verbatim (four separate operator nodes for Tokyo Station):

```json
{"name": "東京",   "name:en": "Tokyo",     "name:ja": "東京",   "name:latin": "Tokyo",     "name:nonlatin": "東京",   "subclass": "station", "rank": 35}
{"name": "神田",   "name:en": "Kanda",     "name:ja": "神田",   "name:latin": "Kanda",     "name:nonlatin": "神田",   "subclass": "station", "rank": 40}
{"name": "有楽町", "name:en": "Yurakucho", "name:ja": "有楽町", "name:latin": "Yurakucho", "name:nonlatin": "有楽町", "subclass": "station", "rank": 41}
{"name": "東京",   "name:en": "Tokyo",     "name:ja": "東京",   "name:latin": "Tokyo",     "name:nonlatin": "東京",   "subclass": "station", "rank": 47}
{"name": "東京",   "name:en": "Tokyo",     "name:ja": "東京",   "name:latin": "Tokyo",     "name:nonlatin": "東京",   "subclass": "station", "rank": 50}
{"name": "東京",   "name:en": "Tōkyō",     "name:ja": "東京",   "name:latin": "Tōkyō",     "name:nonlatin": "東京",   "subclass": "station", "rank": 63}
```

Sample `subclass=subway`, verbatim and complete:

```json
{"name": "大手町", "name_en": "Otemachi", "name_de": "大手町", "name:en": "Otemachi", "name:es": "Otemachi",
 "name:fr": "Ōtemachi", "name:ja": "大手町", "name:ko": "오테마치", "name:ru": "Отэмати", "name:zh": "大手町",
 "name_int": "Otemachi", "name:latin": "Otemachi", "name:nonlatin": "大手町",
 "class": "railway", "subclass": "subway", "agg_stop": 1, "rank": 28}
```

### A6. Does the style render `class=railway` POIs at all? — no

The style has exactly three `poi`-sourced layers, and their filters are the whole answer:

| layer | minzoom | filter |
|---|---:|---|
| `poi_gen1` | 15 | `["in","class","park"]`, `["<=","rank",3]`, `Point` |
| `poi_gen0_parks` | — | `["==","subclass","park"]`, `["==","rank",1]`, `Point` |
| `poi_gen0_other` | — | `["in","subclass","university","hospital"]`, `["<=","rank",3]`, `Point` |

Running those three filters over the decoded tile's own `poi` layer: **0, 0 and 1 matching features
respectively.** Of 5,212 POIs in the tile — including all 46 stations — this style paints exactly one
label (a university or hospital). `class=railway` appears in no filter in the style.

**The CARTO verdict transfers verbatim: the station names are shipped in every tile and thrown away
at paint time.** The one thing that differs is the remedy's cost. CARTO's style JSON is BSD-3-licensed
and forkable (§3a); Stadia's style JSON carries **no licence declaration of any kind** — the fetched
document has no `metadata` licence field, and `stadiamaps.com` publishes no equivalent of CARTO's
`basemap-styles/LICENSE.md`. ⚠️ Whether Stadia's style JSON may be forked and self-served is
unverified — see the ⚠️ list. Note that a *style layer added client-side* is a different act from
forking the style document: MapLibre can `addLayer` a `poi`/`class=railway` symbol layer against the
already-loaded `openmaptiles` source without copying Stadia's JSON at all.

### A7. Script selection — Stadia does not use `{name}`, `{name_en}` or `{name:en}`

Enumerating all 24 symbol layers' `text-field`:

| pattern | layers | which |
|---|---:|---|
| `["let","latin",["coalesce",["get","name:latin"],""],"nonlatin",…]` — **latin + nonlatin, newline-joined** | 18 | `water_name_line/nonocean/ocean`, `poi_gen1`, `poi_gen0_parks`, `poi_gen0_other`, `place_other`, `place_suburb`, `place_village`, `place_town`, `place_city`, `place_city_large`, `place_capital_gen0/gen1`, `place_state`, `place_country_other/major`, `airport_label_gen0` |
| `["concat",["get","name:latin"], …nonlatin space-joined]` — same idea, one line | 2 | `highway_name_other`, `highway_name_major` |
| `"{ref}"` | 3 | `highway_shield_other`, `highway_shield_us_other`, `highway_shield_us_interstate` |
| `"{name:latin}"` — latin only | 1 | `place-continent` |

The dominant expression, verbatim:

```json
["let",
  "latin",    ["coalesce", ["get", "name:latin"], ""],
  "nonlatin", ["case",
                ["all", ["has", "name:nonlatin"],
                        ["is-supported-script", ["get", "name:nonlatin"]]],
                ["get", "name:nonlatin"], ""],
  ["case",
    ["all", ["!=", ["var", "latin"], ""], ["!=", ["var", "nonlatin"], ""]],
    ["concat", ["var", "latin"], "\n", ["var", "nonlatin"]],
    ["concat", ["var", "latin"], ["var", "nonlatin"]]]]
```

Four factual consequences:

1. **There is no zoom-switching.** CARTO's `{name_en}`@z8 → `{name}`@z13 flip (§5b) has no analogue
   here. Every one of the 18 layers uses the same rule at every zoom.
2. **It is not an either/or.** Where both fields exist, the label is `name:latin` **`\n`**
   `name:nonlatin` — romaji on line one, kanji on line two. On this tile 3,451 of 5,212 POIs carry
   both keys, and **all 46 `class=railway` POIs do.**
3. **The `name_en` deprecation the prior pass flagged does not apply.** OpenMapTiles documents
   `name_en` as *"deprecated and will be removed in a future release in favor of `name:en`"*
   ([openmaptiles.org/schema](https://openmaptiles.org/schema/)). CARTO selects on `name_en`. Stadia
   selects on neither `name_en` nor `name:en` — it uses `name:latin` / `name:nonlatin`, which are
   OpenMapTiles' own derived script-split fields and carry no deprecation notice. The tile carries all
   of them: `name`, `name_en`, `name_de`, `name_int`, `name:en`, `name:latin`, `name:nonlatin` and ~70
   `name:{lang}` variants.
4. **The `is-supported-script` gate does not suppress kanji.** The
   [style spec](https://maplibre.org/maplibre-style-spec/expressions/) defines it as returning `false`
   *"if the input string contains sections that cannot be rendered without potential loss of meaning
   (e.g. Indic scripts that require complex text shaping, or right-to-left scripts if the
   `mapbox-gl-rtl-text` plugin is not in use…)"* — CJK is not among the named exclusions. Separately,
   `maplibre-gl@5.24.0`'s published `dist` sets `localIdeographFontFamily: "sans-serif"` as its
   default, so CJK ideographs are rasterised from the browser's local font rather than fetched from
   Stadia's glyph server — the single-font `text-font: ["Stadia Regular"]` stack does not gate them.
   `MapView.tsx` does not override `localIdeographFontFamily`, so the default applies.

   **All of which is moot for stations**, because A6 established that no station label is drawn at
   all. The two-script rule governs the place, POI, water and road labels that *do* render.

### A8. What changed vs CARTO, and what did not

| | CARTO Dark Matter (§Q5, 2026-08-05) | Stadia Alidade Smooth Dark (measured today) | changed? |
|---|---|---|---|
| Source type / maxzoom | vector, 14 | vector, 14 | no |
| Total style layers | 93 | 53 | yes |
| Rail minzoom | 13 | 13 | **no** |
| Rail colour vs. background | `#1a1a1a` on `#0e0e0e` (1.11:1) | `#545353` on `#333333` (1.65:1), plus `#7f7d7e` dash (3.09:1) | **yes — rail is now clearly visible** |
| Rail line features in tile | 16 | 173 | yes |
| Rail features carrying `name` | 0 | **0** | no |
| `transportation_name` rail entries | 0 of 419 | **0 of 679** | no |
| Station POIs in tile | 45 `class=railway` | 46 `class=railway` | no |
| Station POIs rendered by style | **0** | **0** | **no** |
| Script rule | zoom-switched `{name_en}` → `{name}` | `name:latin` + `\n` + `name:nonlatin`, all zooms | **yes** |
| Selects on a deprecated field? | yes (`name_en`) | no | **yes** |
| Style JSON licence | BSD-3-Clause, published | **none published** | **yes** |
| Keyless tile fetch | HTTP 200, no headers needed | **HTTP 401 without `Referer`/`Origin`** | **yes** |
| Tile size (Tokyo z14) | 695,110 raw / 403,601 gz | 708,440 raw / 380,035 gz | marginal |

The two tilesets are both OpenMapTiles schema 3.x but are built by different producers with different
generalisation settings, which is why the per-layer feature counts differ so widely (`transportation`
3,685 vs 839; `place` 184 vs 432). That is a difference between the tilesets, not a difference in what
OSM holds.

---

## B. Version drift re-measured

**Bottom line: nothing structural moved. Every staleness finding in §Q2b still holds, verbatim.
`react-leaflet@5.0.0` is still the latest, still published 2024-12-14, still Hippocratic-2.1. Leaflet
core is still 1.9.4 from 2023-05-18 with `2.0.0-alpha.1` still the only alpha. `rlayers@3.9.0` still
pins `ol` to exactly `=10.8.0` while `ol` ships 10.10.0. Bundle sizes are within three bytes of the
prior measurements. The only movement is upstream version numbers, and one of them is same-day:
`maplibre-gl` published **6.5.0 today, 2026-08-21**.**

### B1. Bundle sizes — re-measured from `unpkg` + `gzip -9`

| package | version | file(s) | raw | gzip | §2a said |
|---|---|---|---:|---:|---|
| `leaflet` | 1.9.4 | `dist/leaflet.js` | 147,552 | **42,440** | 42,437 |
| `maplibre-gl` | 5.24.0 (installed) | `dist/maplibre-gl.js` (UMD) | 1,056,837 | **275,167** | 275,164 |
| `maplibre-gl` | 5.24.0 | `dist/maplibre-gl.css` | 70,024 | 10,084 | 10,081 |
| `maplibre-gl` | 6.5.0 (latest) | `.mjs` + `-shared.mjs` + `-worker.mjs` | 1,073,467 | **282,701** | 277,351 @ 6.1.0 |
| `ol` | 10.10.0 | `dist/ol.js` (full bundle) | 1,043,059 | **289,583** | 289,580 |
| `deck.gl` | 9.3.10 | `dist.min.js` | 1,648,135 | **470,158** | 469,860 @ 9.3.7 |

The ±3-byte deltas on unchanged versions are gzip-implementation noise, not content change. §Q2a's
⚠️ caveat about `ol`'s 3.4× tree-shaking spread is untouched and still applies.

### B2. Registry state — re-measured from `registry.npmjs.org`

| package | latest | published | licence | peer deps | moved since 2026-08-05? |
|---|---|---|---|---|---|
| `maplibre-gl` | **6.5.0** | **2026-08-21** | BSD-3-Clause | — | yes (was 6.1.0 / 2026-07-30) |
| `ol` | 10.10.0 | 2026-07-27 | BSD-2-Clause | — | **no** |
| `deck.gl` | 9.3.10 | 2026-08-11 | MIT | `react >=16.3`, `react-dom >=16.3`, `@arcgis/core ^4` | yes (was 9.3.7) |
| `react-map-gl` | 8.1.2 | 2026-07-29 | MIT | `react >=16.3`, `maplibre-gl >=1.13.0`, `mapbox-gl >=1.13.0` | **no** |
| `leaflet` | **1.9.4** | **2023-05-18** | BSD-2-Clause | — | **no** |
| `react-leaflet` | **5.0.0** | **2024-12-14** | **Hippocratic-2.1** | `leaflet ^1.9.0`, `react ^19.0.0` | **no** |
| `rlayers` | 3.9.0 | 2026-02-11 | ISC | **`ol` pinned `=10.8.0`**, `react >=18` | **no** |

- Leaflet's `dist-tags` still read `{latest: 1.9.4, beta: 1.8.0-beta.3, alpha: 2.0.0-alpha.1}`. The
  2.0 alpha has now been the only 2.x artifact for **just over a year** (published
  `2025-08-16T10:01:13Z`), and the package's registry `time.modified` is that same timestamp —
  **nothing at all has been published to `leaflet` since**.
- `maplibre-gl`'s `dist-tags` are `{latest: 6.5.0, next: 6.0.0-22, v1: 1.15.3}`.
- **`package.json` pins `maplibre-gl: ^5.24.0`, and 5.24.0 (2026-04-23) is the last 5.x published** —
  the caret resolves to exactly 5.24.0 with no newer in-range release available. `react-map-gl` moved
  from `^8.1.0` to `^8.1.2`, which is the current latest.

---

## C. Stadia's terms and the credit arithmetic

**Bottom line: every figure ADR-0027 recorded on 2026-08-12 still reads the same on the live pages
today — 1 credit per standard vector basemap tile, 200,000 free credits/month with a hard stop,
Starter at $20/mo for 1,000,000, and "Commercial use not allowed" on Free. Two things the ADR did not
have: the free tier's commercial bar is broader than "not allowed" — Stadia defines commercial use to
include *"use by an organization that is for-profit (regardless of whether the usage generates
revenue or not)"*, with named carve-outs for development, testing and demonstration. And the
keyless-localhost limit does have a published sentence after all, just not a number:
`docs.stadiamaps.com/limits` states *"While we do not publish exact limits for local development, it
should be usable without issue for most applications."* Measured, keyless access is enforced by
`Referer`/`Origin`, not by hostname alone: a tile request with no `Referer` and no `Origin` returns
HTTP 401 regardless of what it asks for.**

### C1. Credit schedule — [stadiamaps.com/pricing](https://stadiamaps.com/pricing/)

| product | credits |
|---|---|
| **Standard Vector Basemaps** | **1 / tile** |
| Standard Raster Basemaps | 1 / tile |
| Satellite Imagery | 4 / tile |
| Static Maps | 20 / req |
| Cacheable Static Maps | 2,000 / req |
| Autocomplete Search (v1 / v2) | 20 / 1 per req |
| Forward / Structured / Reverse / Bulk Geocoding | 20 / req |
| Place Lookup | 20 / GID |
| Time Zones | 5 / req |
| Standard Routing / Nearest Roads / Map Matching / Trace Attributes / Isochrones | 20 / req |
| Optimized Routing | 40 / req |
| Time/Distance Matrix | 10 / element |
| Traffic-Influenced Profiles | 60 / req or element |
| Premium Traffic-Influenced Profiles | 120 / req or element |
| Elevation | 5 / req |

Confirms ADR-0027's premise exactly: the app draws only Standard Vector Basemaps from Stadia, at
1 credit each, and routes geocoding (Google) and routing (OSRM/VROOM) elsewhere — the 20–40 credit
rows never apply.

### C2. Plans

| tier | price | credits/mo | overage | commercial use |
|---|---:|---:|---|---|
| Free | $0 | **200,000** | *"No additional usage allowed"* — hard stop | **"Commercial use not allowed"** |
| Starter | $20/mo | 1,000,000 | +3¢ / 1,000 | allowed |
| Standard | $80/mo | 7,500,000 | +2¢ / 1,000 | allowed |
| Professional | $250/mo | 25,000,000 | +1.5¢ / 1,000 | allowed |

New accounts get a 14-day Professional evaluation with no credit card, then drop to Free
automatically. Identical to §Q3c and to ADR-0027.

**The arithmetic ADR-0027 left half-open, stated cleanly:** at 1 credit per tile and 200,000 credits
per month, the free grant is exactly **200,000 basemap tile fetches per calendar month**, hard-stopped.
Sessions/month = 200,000 ÷ (tiles per session). The ADR's "generous 200 tiles/session" assumption
gives 1,000 sessions/month. The multiplicand is the parent session's measurement, not mine; the
divisor and the ceiling are settled here.

**And a fact that changes what the arithmetic is *for*:** the keyless-localhost path bills against no
account, so it consumes none of the 200,000. The credit ceiling binds only once an API key exists —
i.e. once the app runs anywhere but `localhost`. Today `NEXT_PUBLIC_STADIA_API_KEY` is unset
(`MapView.tsx:24`) and no key is provisioned, so current usage draws down nothing.

### C3. Commercial use — verbatim, and broader than the pricing table's three words

[stadiamaps.com/faqs](https://stadiamaps.com/faqs/) defines commercial use as *any* of:

> "Use in a product or service that is sold or generates revenue (including via advertising or content
> monetization)"

> "Use by an organization that is for-profit (regardless of whether the usage generates revenue or
> not)"

with limited exceptions that survive even for a commercial entity: *"Development and testing
purposes"* and *"Demonstration purposes (products and pages which are exclusively for demonstration
purposes)"*. Asked directly whether a for-profit org with a non-revenue use qualifies, the FAQ answers
*"Yes, however, in both cases, you meet our criteria of Commercial Use and are required to have an
active paid subscription."*

The free tier is described as usable *"for non-commercial or evaluation purposes, including but not
limited to development of a proof of concept or a personal site."* Stadia also states it can make
exceptions per project via `support@stadiamaps.com`.

This is consistent with, and more specific than, ADR-0027's Consequences ("forbids commercial use and
use by any for-profit organization"). **The trigger is organisational form, not revenue.**

### C4. The keyless path — documented and measured

**Documented** ([docs.stadiamaps.com/authentication](https://docs.stadiamaps.com/authentication/)):

> "As long as you're running via a development server accessed via `localhost` or `127.0.0.1`, you
> don't need an API key!"

> "Requests made this way are subject to strict rate limits. If you start receiving HTTP 429 responses
> regularly, sign up for an account (it's free!) and create an API key."

Three authentication mechanisms are documented: `api_key=` query parameter, an
`Authorization: Stadia-Auth YOUR-API-KEY` header, and domain-based auth validating `Origin`/`Referer`
against a dashboard allowlist. Only `localhost` and `127.0.0.1` are named as keyless hosts.

**Is any number published for the keyless limit?** No — but there is now a sentence, which
ADR-0027 did not have. [docs.stadiamaps.com/limits](https://docs.stadiamaps.com/limits/) states:

> "While we do not publish exact limits for local development, it should be usable without issue for
> most applications."

and, on rate limiting generally:

> "We reserve the right to impose rate limits on customers who are abusive or disruptive of service."

So the position is: **no published number, an explicit statement that no number will be published,
and a stated expectation that it suffices for most applications.** The same page does publish hard
numeric limits for other products (50 max locations per route, 625–10,000 matrix elements, 5,000
bulk-geocoding queries) — so the absence of a tile figure is a deliberate omission, not an oversight.

**Measured**, against the live endpoint:

| request | result |
|---|---|
| `GET .../styles/alidade_smooth_dark.json`, no headers | **200**, 29,820 bytes |
| `GET .../data/openmaptiles.json`, no headers | **200**, 518 bytes |
| `GET .../data/openmaptiles/14/14552/6451.pbf`, no headers | **401**, 14,885-byte PNG error tile |
| same + `User-Agent` only | **401** |
| same + `Referer: http://localhost:3000/` | **200**, 708,440 bytes MVT |
| same + `Referer: http://localhost/` or `http://127.0.0.1:8080/` | **200** |
| same + `Origin: http://localhost:3000` (no `Referer`) | **200** |

No `HTTP 429` was observed across roughly twenty requests, and no `RateLimit-*`, `Retry-After` or
`X-RateLimit-*` response header appears on any 200. Response headers on a tile 200 are:
`content-type`, `content-disposition: attachment`, `etag`, `vary`, `content-length`,
`cache-control: max-age=21600`, `accept-ranges`, `stadia-cache: HIT|MISS`, `stadia-entrypoint`,
`alt-svc`, `strict-transport-security`, `access-control-allow-*`, `x-robots-tag: noindex`. **Nothing
in the wire protocol exposes remaining quota or a limit.**

⚠️ Probing which `Referer` values pass is documented in the ⚠️ list; the mechanism is not published
and I did not characterise it exhaustively.

### C5. The API-key wiring, measured

`MapView.tsx:23-27` appends `?api_key=…` to the *style* URL when `NEXT_PUBLIC_STADIA_API_KEY` is set.
Measured with a placeholder key, Stadia rewrites the served style so the source URL carries it:

```
sources.openmaptiles.url = "https://tiles.stadiamaps.com/data/openmaptiles.json?api_key=EXAMPLE_NOT_A_REAL_KEY"
```

The `glyphs` and `sprite` URLs are **not** rewritten and carry no key. So a key set that way reaches
the tile requests (via the TileJSON) but not the font or sprite requests. Those two are not in the
credit schedule, so no credit consequence follows; it is recorded as a wiring fact.

### C6. Attribution — one correction to ADR-0027's wording

ADR-0027 says *"Stadia's own style JSON declares an accurate, complete attribution string."*
Measured: **the style JSON contains no `attribution` key at all** — the string `"attribution"` does
not appear in its 29,820 bytes, and its single source declares only `type`, `scheme` and `url`. The
attribution lives one level down, in the TileJSON MapLibre resolves from that `url`:

```
"attribution": "<a href=\"https://stadiamaps.com/\">&copy; Stadia Maps</a>
                <a href=\"https://openmaptiles.org/\" rel=\"nofollow noopener noreferrer\">&copy; OpenMapTiles</a>
                <a href=\"https://www.openstreetmap.org/copyright\">&copy; OpenStreetMap</a>"
```

**The substance of ADR-0027 is confirmed** — all three required credits are present, which is exactly
what CARTO's TileJSON omitted (§3a). Only the location is one hop further than the ADR describes,
which matters for a future basemap swap: the thing to inspect is the source's TileJSON, not the style
document.

---

## D. The self-hosting blocker, re-checked

**Bottom line: unchanged on every point. Java is still not installed on this machine. planetiler
still requires Java 21+, still states the same RAM and disk figures, still documents `--osm-path`,
and its benchmark table is still planet-only with no regional row of any kind. Protomaps still
publishes a ~120 GB zoom-0–15 daily planet build with `pmtiles extract` as the cutout path and still
publishes no example regional sizes. The pinned Extract is byte-identical; only `japan-latest` has
grown.**

### D1. Java

```
$ java -version
The operation couldn't be completed. Unable to locate a Java Runtime.
$ /usr/libexec/java_home -V
The operation couldn't be completed. Unable to locate a Java Runtime.
```

Still absent. §Q4b's and §Q6's blocker stands.

### D2. planetiler — [README](https://raw.githubusercontent.com/onthegomap/planetiler/main/README.md), re-fetched (23,448 bytes)

Requirements, verbatim and identical to §Q4b:

> - "Java 21+ (see CONTRIBUTING.md) or Docker"
> - "at least 1GB of free SSD disk space plus 5-10x the size of the `.osm.pbf` file"
> - "at least 0.5x as much free RAM as the input `.osm.pbf` file size"

`--osm-path` is still documented: *"`--osm-path=path/to/file.osm.pbf` points Planetiler at an existing
OSM extract on disk"* — the flag §Q6's answer rests on. `-Xmx1g` guidance is unchanged
(*"recommended: 0.5x the input .osm.pbf file size"*).

**The Benchmarks table is still every-row-the-planet.** Its inputs are `planet-260302` (92 GB),
`planet-240115` (69 GB), `planet-240108` (73 GB) and `planet-220530` (69 GB). **No Japan row. No
regional row of any kind.** §Q4b's two ⚠️ extrapolations (build time ~7 min–tens of minutes; output
~1.9–2.1 GB) remain extrapolations, unimproved, and their caveats carry over unchanged.

### D3. Inputs and machine

| | 2026-08-05 | today |
|---|---:|---:|
| `japan-260101.osm.pbf` (the pinned Extract) | 2,342,296,009 | **2,342,296,009** (identical) |
| `japan-latest.osm.pbf` | 2,484,012,396 | 2,500,082,692 |
| cores / RAM | 10 / 16 GiB | 10 / 16 GiB |
| free disk | 311 GiB | 253 GiB |

The pinned file is byte-identical, which is the point of pinning it. planetiler's stated needs for a
2.18 GiB input (~1.1 GiB RAM, ~12–23 GiB scratch) still clear this machine on RAM and disk; only Java
blocks.

### D4. Protomaps — [docs.protomaps.com/basemaps/downloads](https://docs.protomaps.com/basemaps/downloads)

Unchanged, verbatim:

> "distributed as an Open Database License Produced Work (OpenStreetMap attribution required)"

> "A full planet file is roughly 120 gigabytes, including zoom levels from 0 to 15."

> "If you don't need all 16 zoom levels of detail, use the `--maxzoom` option of `pmtiles extract`.
> Each additional zoom level roughly doubles the size."

**Still no published example regional or country extract size.** §Q4c's ⚠️ stands: Japan's cutout size
is unknown from primary sources.

---

## E. What ADR-0030 settled about shared ingestion machinery

**Bottom line: nothing material remains open. #144 asked whether "self-owned OSM basemap" and "OSM
rail graph" can share ingestion machinery. §Q6 answered it — the pinned Geofabrik download is the only
shareable artifact, and the `osmium tags-filter` step is actively counterproductive to share.
ADR-0030 then removed the one thing that might have reopened it: the filtered Extract already carries
`way` geometry, so rail rendering needed no new ingestion at all. The two answers point the same way.
The only residue is operational, not architectural: sharing the download means *keeping* the file
rather than deleting it, and the pin now lives in a different file than §Q6 cites.**

§Q6's finding was that the two pipelines share the download and nothing else — different filters,
different intermediates, different toolchains (`osmium` + Node/tsx vs. a Java 21+ JAR), different
outputs (a ~9 MB SQLite rail graph vs. a multi-GB PMTiles archive), different extra inputs (planetiler
pulls ~1 GB of ocean polygons and Natural Earth; the rail ingest pulls none).

ADR-0030 tested the sharpest version of the counter-hypothesis and closed it:

> "`osmium tags-filter` completes references transitively two levels down by default (relation →
> member ways → those ways' nodes); the filtered national extract holds 630,298 nodes, of which
> 527,576 are untagged geometry vertices, 90,632 ways, and **zero dangling references of any kind**."

> "`scripts/ingest-transit-graph.sh` needs no change."

That matters for #144's question in a specific way: the plausible route to shared machinery would have
been *"rail rendering needs way geometry, and way geometry is what a basemap is made of, so widen the
filter and serve both from one pipeline."* ADR-0030 shows the premise is false. The rail geometry was
already inside the narrow filter, two reference levels down, and ADR-0030 §9 turned it into per-ride-edge
spans on a Path — a SQLite artifact, not tiles. Widening the filter would still be required for a
basemap (§Q6's table: planetiler needs roads, water, landuse, places, POIs — everything the filter
strips), and would still be pure cost for the rail graph.

**What is genuinely left open, and it is small:**

1. **The download is shared in principle, not in practice.** `scripts/ingest-transit-graph.sh:23-24`
   still does `WORK_DIR="$(mktemp -d)"` with `trap 'rm -rf "$WORK_DIR"' EXIT`, so the 2.18 GiB Extract
   is deleted on every run. Feeding planetiler `--osm-path` the same bytes means retaining it. That is
   a script change of a few lines, not a pipeline design question.
2. **The pin has moved.** §Q6 cites `ingest-transit-graph.sh:14-16`; the snapshot now lives in
   **`scripts/osm-snapshot.env`** (`OSM_SNAPSHOT="260101"`, `OSM_RAIL_REGION="asia/japan"`,
   `OSM_ROAD_REGIONS="asia/japan/kanto asia/japan/kansai asia/japan/chubu"`), shared by the rail and
   road ingests per ADR-0024's 2026-08-07 amendment. A basemap build would be the **third** consumer
   of that pin, and its region requirement (all of Japan) matches rail's, not road's.
3. **A basemap-shaped consumer would want the whole-Japan file that rail already downloads and road
   deliberately does not.** That is a fact about which pin it would attach to, not a new pipeline.

There is no open question here that a grilling session needs to resolve. Everything remaining is
implementation.

---

## F. The live application, measured — including the figure ADR-0027 could only guess at

Measured 2026-08-21 against the running dev server (`pnpm dev`, Next.js 16.3.1, Turbopack) on `main`
at `e5251d8`, trip `b1a8b01e-b15f-4a13-b394-1af229c57530` ("Tokyo + Osaka PR4 verify", 7 locations,
Sep 1 → Sep 6). Two sub-passes, kept distinct throughout: §F1–§F5 are an **automated** measurement
(live DOM/JS inspection, Resource Timing, the CDP network layer) that turned out to be occluded and
therefore blind to actual tile traffic (§F2); §F5–§F7 fold in a **real, non-automated browser
session** — DevTools Network, and direct eyes-on observation — that closed what the automated pass
could not reach.

### F1. What the app actually loads — measured, and it corroborates §A independently

| fact | value |
|---|---|
| style requested | `.../styles/alidade_smooth_dark.json` → **200** |
| TileJSON | `.../data/openmaptiles.json` → **200** |
| sprite | `.../styles/alidade-smooth-dark/sprite@2x.json` + `.png` → **200** each |
| resolved tile template | `https://tiles.stadiamaps.com/data/openmaptiles/{z}/{x}/{y}.pbf` |
| **API key present** | **none** — the template carries no `api_key`; `NEXT_PUBLIC_STADIA_API_KEY` is unset |
| style `name` | **"Alidade Smooth"** |
| style layer count | **53** |
| source `minzoom` / `maxzoom` / `tileSize` | **0 / 14 / 512** |
| map container | 538 × 390 CSS px, `devicePixelRatio` 2 |
| `STOP_ZOOM` (`MapView.tsx:39`) | **14** — the `flyTo` zoom (`:399`) and the `maxZoom` on every `fitBounds` (`:405`) |

The layer count, style name, source zoom range and tile template were read out of the *running map
object*, and independently match §A1/§A5's figures fetched over `curl`. The two measurements were
taken by different means and agree.

**The style's `name` is "Alidade Smooth", not "Alidade Smooth Dark".** The dark variant is identified
only by the URL and the sprite path (`alidade-smooth-dark/sprite@2x`). Anything keying off the style
document's own `name` to tell light from dark apart will get it wrong.

MapLibre v5 renames `style.sourceCaches` to **`style.tileManagers`**; the app has three —
`openmaptiles` (Stadia) plus `routes` and `stops`, the app's own ADR-0029 overlay sources. The
basemap is one source of three, not the only one.

### F2. The tiles-per-session count: diagnosed here, then measured in a real browser

ADR-0027 left this ⚠️, attributing it to tile fetches happening *"inside MapLibre's Web Worker, which
doesn't surface in the main document's Resource Timing API."* That is true, and it is **not the
binding constraint** for the automation used through §F1–§F5 below. Measured here:

- `document.visibilityState === "hidden"` for the entire session, and it stays hidden even after
  explicitly fronting the tab — the automation surface is occluded.
- WebGL is healthy: context created, `vendor: WebKit`, `isContextLost(): false`. The map object
  exists, the stylesheet parses to 53 layers, and all four non-tile Stadia resources return 200.
- Yet `map.isStyleLoaded()` is permanently `false`, all three tile managers hold **0** tiles, and
  **zero `.pbf` requests are issued** — confirmed twice over, in Resource Timing (4 Stadia entries,
  0 of them `.pbf`) and at the CDP network layer (0 `stadiamaps` requests recorded).
- Calling `tileManagers.openmaptiles.update(transform)` by hand returns cleanly and still yields 0
  tiles: the source itself never finishes loading.

**Cause: MapLibre requests tiles from inside its `requestAnimationFrame`-driven render loop.** A
hidden document pauses rAF, so the loop never runs, the source never completes load, and no tile is
ever requested. Patching `window.requestAnimationFrame` to a `setTimeout` shim afterwards does not
help — MapLibre captures its frame function at module init, before any such patch can land.

**So the figure is not obtainable with headless or occluded browser tooling at all** — not because
the counter cannot see worker traffic, but because in that environment *there is no worker traffic to
see*. ADR-0027's own suggested method is the correct and apparently only one: a real, visible browser
window with DevTools' Network tab filtered to `tiles.stadiamaps.com`.

This also supplies the reason the ADR could only guess: its author hit the same wall.

**Measured 2026-08-21, in a real (non-automated) browser window**, DevTools Network filtered to
`.pbf`, browsing the same Tokyo + Osaka trip across multiple Days and both metro tabs (a wider,
larger map panel than §F1's automated one — 863 × 674 CSS px against 538 × 390):

| filter | count |
|---|---|
| `.pbf` (all requests, any status) | **232** |
| `.pbf status-code:200` | **49** |

**183 of 232 requests (79%) did not complete as a plain 200** — visibly, and significantly, cancelled
in DevTools. This is a real, measured split, not an artifact: MapLibre issues a tile request for
every cover a camera transition passes through and cancels the ones a fast pan or `flyTo` outruns
before they land — consistent with §F1's `flyTo`/`fitBounds` camera semantics, now confirmed to
generate more *requested* tiles than *rendered* ones. **Two things this measurement does not by
itself distinguish**, and neither is established from any source found in this research:

- **Whether Stadia's credit schedule bills a cancelled request.** §C1/§C4 price a *served* tile;
  nothing in the pricing or limits pages says whether an aborted-in-flight request still consumes a
  credit server-side.
- **How much of the 183 is cancellation versus `304` cache revalidation.** §C4 measured
  `cache-control: max-age=21600` on a tile response; repeat views inside that window plausibly
  produce `304`s that a `status-code:200` filter also excludes, distinct from a cancelled request.

So the honest range is **49 (billed-if-only-200s-count) to 232 (billed-if-every-attempt-counts)** for
this real, multi-Day, multi-metro session — not a single number, because the billing question the
range depends on is itself unresolved.

### F3. The arithmetic bound, corrected against the real measurement

§F3 as originally written here estimated "tens per session, not hundreds" from panel-size arithmetic
alone. **That estimate missed by roughly an order of magnitude against the real measurement above**,
and it is worth recording why, since the miss is more instructive than the number:

1. **The real panel is larger.** §F1's automated measurement was a 538 × 390 CSS-px panel; the real
   session's was 863 × 674 — about **2.8×** the area, so roughly 3× the tiles per settled view on
   that basis alone.
2. **Animated camera moves are the dominant term, not a small addend.** The original estimate treated
   `flyTo`/`fitBounds` transitions as adding a handful of tiles on top of a settled-viewport count.
   §F2's 232-vs-49 split shows the opposite: most of what MapLibre requests during a transition is
   never rendered at all, because the camera keeps moving faster than the tiles land.
3. **A multi-Day, multi-metro session compounds linearly**, and the real session covered more ground
   (both the Tokyo and Osaka metro tabs, several Days) than the single-Day case the original estimate
   sized against.

The corrected constraint: **for a real multi-Day, multi-metro session, budget on the order of a few
hundred `.pbf` requests, not a few dozen.** Against §C1's schedule (1 credit per served tile, 200,000
free credits/month) that is still comfortably inside ADR-0027's own generous "200 tiles/session"
assumption if only completed 200s bill, and roughly at that assumption's boundary if every request —
cancelled or not — bills. **ADR-0027's own guess was closer to the real number than this document's
first attempt to refine it downward was.**

The panel-size geometry itself (2–6 tiles per settled viewport, independent of zoom) is unchanged and
still correct as a *lower bound component*; what was wrong was treating it as most of the total.

### F4. Two facts about *when* the app costs anything

1. **The map is mounted lazily behind the "Map" toggle**, and the trip page opens on "Itinerary". A
   session that never opens the Map tab fetches **zero** Stadia resources — style, sprite and
   TileJSON included. Any per-session cost model that assumes one map load per page view overstates
   the bill.
2. **The style, sprite and TileJSON are one fetch each per map mount, not per tile.** §C1's credit
   schedule prices tiles; these four requests are the fixed cost of opening the map at all.

### F5. Attribution — confirmed rendering correctly in a real browser

In the automated measurement, the `AttributionControl` was mounted (`.maplibregl-ctrl-attrib` in the
DOM) but carried the class `maplibregl-attrib-empty` and rendered no text, for the same §F2 reason —
MapLibre populates attribution from the *loaded* style and source, which never completed there.

**Resolved 2026-08-21 by direct observation in a real browser:** the control renders, non-compact, no
click required, bottom-right corner: **"© Stadia Maps © OpenMapTiles © OpenStreetMap"** — all three
credits §C6 traced to the TileJSON, exactly as declared. ADR-0027's attribution requirement is met.

### F6. The overlay-conflict question, settled by looking at a real render

§A4's width/colour evaluation (rail at `#545353`, exactly 3 px from z13–z16, versus the Path
overlay's constant 3 px `line-width` over the same OSM ways) could establish that the two lines
*collide in geometry*, but not whether they read as visually separate — luminance ratios discard hue,
and MapLibre never rendered in the automated environment at all.

**Resolved 2026-08-21 by direct observation**, screenshotting the real app at street level in
Shinjuku (near Meiji Jingu, inside the z13+ band): the amber Day-coloured Path line is clearly
separable from the grey basemap rail beneath it. The two lines share a width and cross the same ways,
as §A4 established, but distinct hue at full opacity keeps them visually distinct — this is what
`ALPHA_REST`/`ALPHA_ACTIVE` and the day-colour palette were already doing, not a new mechanism.

The same screenshot independently corroborated two more §A findings, incidentally: **§A6** (no
station is labelled — Meiji Jingu's own station is unlabelled on a tile that clearly draws its
grounds) and **§A7** (script selection renders `name:latin` and `name:nonlatin` newline-joined at
every zoom — visible on "Upper Pond / 上の池" and "North Pond / 北池" park labels in the same view).

### F7. An application bug surfaced by this measurement, fixed separately (not a #144 fact)

Opening the Map view in a real browser threw a console error on the first pointer move:
`"The layer 'stops' does not exist in the map's style and cannot be queried for features."` — MapLibre
fires this as an `'error'` event (not a thrown exception) when `queryRenderedFeatures` targets a layer
id absent from the style; the default handler is `console.error`, which Next.js's dev overlay surfaces
as a Console Error with a captured stack.

Cause: `MapView.tsx`'s `buildTooltip`/`handleClick` queried the `stops` layer unconditionally, but
that layer only exists once react-map-gl mounts its `Source`/`Layer` pair — a window during which the
canvas is already interactive. Fixed and merged as
[#205](https://github.com/Tyler-Reagan/trip-kraken/pull/205), guarding both call sites on
`map.getLayer("stops")`. Recorded here because it surfaced directly from this ticket's live-app
measurement, not because it is itself a #144 fact about the rendering stack.

---

## What this means for #144

Factual constraints the decision must respect. **No recommendation is made here.** These are additions
and corrections to §"What this means for #144 and #142" in the 2026-08-05 pass; that list's items
1–8, 11–12, 14–17 and 20 are unaffected.

**Superseding the old list's items 9, 10, 13, 18, 19 and 21:**

1. **The licence violation the old item 9 recorded is closed.** ADR-0027 removed CARTO on
   2026-08-12. The quoted CARTO terms in §3a remain accurate about CARTO; they are no longer
   accurate about this repo. Nothing in the current stack is used outside its published terms.

2. **The free tier's bar is organisational form, not revenue.** Stadia's own definition includes
   *"use by an organization that is for-profit (regardless of whether the usage generates revenue or
   not)"*, carved out only for development, testing and exclusively-demonstration properties. Any
   decision that contemplates trip-kraken becoming a product of a for-profit entity crosses the line
   at incorporation, not at first dollar. The published exit is Starter at $20/mo for 1,000,000
   credits, or self-hosting (§Q4c/§4d).

3. **The free credit ceiling is exactly 200,000 basemap tile fetches per calendar month, with a hard
   stop and no overage.** Any decision that models cost must model tiles-per-session as the only
   unknown; every other term in the arithmetic is now nailed down. Note the ceiling does not bind
   today — the keyless-localhost path bills no account and consumes no credits.

4. **The keyless path has no published number and Stadia has said it will not publish one.**
   *"While we do not publish exact limits for local development, it should be usable without issue
   for most applications."* No rate-limit headers are returned on any response. A decision cannot be
   grounded on a keyless quota figure, because none exists to ground it on; it can only be grounded
   on the documented expectation and on observed 429s.

5. **Keyless is enforced by `Referer`/`Origin`, and the tile endpoint fails closed.** A tile request
   with neither header returns HTTP 401 and a 512×512 PNG error card, while the style JSON and
   TileJSON serve keyless unconditionally. Any deployment surface that strips or suppresses the
   referrer will lose tiles while still successfully loading the style — a failure mode that looks
   like a rendering bug, not an auth bug.

6. **Attribution comes from the source's TileJSON, not the style document.** ADR-0027's substantive
   claim holds — all three required credits (Stadia, OpenMapTiles, OpenStreetMap) are present — but
   the style JSON declares none. A future basemap swap must inspect the TileJSON, one hop past the
   style URL, to know what it is inheriting.

7. **The overlay conflict is present-tense, and it is now a width and geometry collision, not a
   visibility one.** Stadia draws rail from z13 in `#545353` at exactly 3.000 px through z16; the
   Path overlay draws at a constant 3 px over the same OSM ways (ADR-0030). `STOP_ZOOM = 14` is both
   the `flyTo` zoom and the `fitBounds` ceiling, so the app's deliberate camera lands inside that
   band every time. Below z13 the basemap draws no rail and the overlay has the canvas to itself. Any
   decision about overlay styling must account for a same-width grey line beneath ours from z13 up —
   which, unlike CARTO's near-invisible `#1a1a1a`, is drawn to be seen.

8. **No station is labelled, and the reason is the same as it was under CARTO.** Measured on the
   Tokyo Station tile: 46 `class=railway` POIs, all 46 carrying `name`, `name:en`, `name:latin` and
   `name:nonlatin`, against a style whose only three `poi` layers filter to park, university and
   hospital — matching 0, 0 and 1 features respectively on that tile. The data is already in the
   bytes being downloaded. The remedy differs from CARTO's in one respect: CARTO's style JSON is
   BSD-3-licensed and forkable, while Stadia publishes no licence for its style document. Adding a
   client-side `addLayer` against the already-loaded `openmaptiles` source is a distinct act from
   forking that document, and only the latter is licence-encumbered.

9. **Rail line identity still cannot come from the basemap, under either provider.** 0 of 173
   `class=rail` features on the tile carry a `name`; 0 of 679 `transportation_name` features are rail
   or transit. Additionally, 47 `class=transit` / `subclass=subway` line features are in the tile and
   referenced by no layer in the style. Line names — 山手線, 丸ノ内線 — can only come from our own rail
   graph, which ADR-0030 §7 and ADR-0032 now carry per ride edge and per shift.

10. **Script selection is no longer a live problem, and the deprecation flag is retired.** Stadia
    selects on `name:latin` and `name:nonlatin` and renders both, newline-joined, at every zoom — no
    zoom-switching, no `name_en`, no `name:en`. Old item 21's OpenMapTiles deprecation concern does
    not apply to this style. All 46 station POIs carry both fields, so the rule would produce
    "Tokyo / 東京" if any layer drew them.

**Unchanged but re-confirmed:**

11. **Every staleness finding about the renderer alternatives still holds.** `react-leaflet@5.0.0`,
    2024-12-14, Hippocratic-2.1 (not OSI-approved). Leaflet core 1.9.4, 2023-05-18, with 2.0 in alpha
    for over a year. `rlayers@3.9.0` pinning `ol` to `=10.8.0` against a shipped 10.10.0. Bundle sizes
    within three bytes. Nothing moved.

12. **`maplibre-gl` 6.5.0 shipped today (2026-08-21) and the repo is on the last 5.x.** `^5.24.0`
    resolves to 5.24.0 exactly — there is no newer in-range release — so a v6 bump is a deliberate,
    already-available migration, not something the caret will drift into. Measured, v6's ESM trio
    gzips to 282,701 bytes against v5's 275,167 UMD; v6 ships no UMD bundle.

13. **Self-hosting's stated blocker is unmoved.** Java is still not installed; planetiler still
    requires Java 21+; its benchmark table is still planet-only, so Japan's build time and output size
    remain ⚠️ extrapolations; Protomaps still publishes no regional extract sizes. The pinned Extract
    is byte-identical at 2,342,296,009 bytes.

14. **The two ingestion pipelines share the download and nothing else, and ADR-0030 closed the one
    hypothesis that could have changed that.** Rail geometry was already inside the narrow
    `tags-filter` output; widening the filter would be pure cost for the rail graph and is still
    mandatory for a basemap. The only residue is operational: the pin now lives in
    `scripts/osm-snapshot.env`, and sharing the download means retaining the Extract instead of
    `trap`-deleting it.

**From the live application (§F):**

15. **Tiles-per-session — constraint 3's "only unknown" — is now measured, and the panel-arithmetic
    estimate this document first offered was wrong by roughly an order of magnitude.** A real,
    non-automated browser session (multiple Days, both metro tabs, a larger 863×674 panel than the
    automated measurement's) produced **232 `.pbf` requests, 49 of them completing plain-200**. The
    arithmetic-only estimate said "tens, not hundreds"; the real number is hundreds. The gap traces to
    two things arithmetic alone could not see: a larger real panel, and animated camera transitions
    generating far more *requested* tiles than *rendered* ones (§F3). **A decision should budget
    against the 49–232 range, not the earlier tens-per-session guess.**

16. **What decides which end of that range is billed is still unresolved, and is now the sharper
    open question** (§F2, unverified item 4). Whether Stadia's credit schedule charges a cancelled
    in-flight request, and how much of the gap is cancellation versus `304` cache revalidation, is
    documented nowhere found in this research. At 49 tiles/session the free tier supports ~4,000
    sessions/month; at 232 it supports ~860 — both comfortably inside ADR-0027's own "200/session,
    1,000 sessions/month" framing, which turns out to have been closer to the real number than this
    document's own first attempt to refine it.

17. **The measurement ADR-0027 deferred could not be taken with automation, and the cause is now
    fully diagnosed and closed.** MapLibre requests tiles from inside its rAF render loop; an
    occluded document pauses rAF, so the source never finishes loading and *no tile is ever
    requested*. Any future attempt to count tiles programmatically in a headless or backgrounded
    context will return zero and look like a passing test, not a real measurement of zero. The figure
    needed, and got, a human at a real browser window (§F2).

18. **Cost is not incurred per page view.** The map mounts lazily behind the "Map" toggle and the trip
    page opens on "Itinerary", so a session that never opens the map fetches nothing from Stadia at
    all — style, sprite and TileJSON included. A per-session cost model keyed to page views overstates
    the bill by however often the map goes unopened.

19. **The style document's own `name` is "Alidade Smooth", not "Alidade Smooth Dark".** Light and dark
    are distinguished only by URL and sprite path. Any provider-swap or theme-detection logic keying
    off the style's `name` field will misidentify this style.

20. **The overlay-vs-basemap width collision constraint 7 established is confirmed benign, visually,
    at today's colours.** §F6 observed the amber Path line clearly separable from the grey basemap
    rail in a real render, despite sharing a width and crossing the same ways. Any future basemap or
    Path-colour change should re-check this by eye — the separation is doing real work, not a
    coincidence of the current palette, and nothing here proves it survives an arbitrary recolour.

---

## ⚠️ Unverified

Three items remain open. Three more were closed 2026-08-21 by direct observation in a real browser —
kept below, struck through, so the resolution is visible rather than silently deleted.

1. **Whether Stadia's style JSON may be forked or self-served.** The document carries no licence
   field, and no `stadiamaps.com` page equivalent to CARTO's `basemap-styles/LICENSE.md` was found.
   Everything in §A6 about "a forked style could add a station layer" is therefore stated for CARTO's
   BSD-3 style and *not* established for Stadia's. **Cost to verify:** one support email, or reading
   the full Terms of Service for a derivative-works clause — the pricing, FAQ, authentication and
   limits pages were read, not the ToS in full.

2. **The mechanism behind which `Referer` values pass the keyless gate.** Measured, `localhost`,
   `127.0.0.1`, `example.com` and `stadiamaps.com` all returned 200, while `evil.invalid` and
   `trip-kraken.example` returned 401 — but the docs name only `localhost` and `127.0.0.1`, and both
   rejected values sit on reserved non-resolvable TLDs, so the discriminator may be domain
   resolvability rather than an allowlist. Nothing in this document depends on the answer; it is
   recorded so the 401-without-`Referer` finding is not over-read as "localhost only."

3. **planetiler's Japan build time and output size, and Protomaps' Japan cutout size.** Inherited
   unchanged from §Q4b/§4c. Both projects publish planet-only figures. **Cost to verify:** one
   `--area=japan` run (needs a JDK 21+, absent here, plus ~25 GB scratch) and one `pmtiles extract`
   against the daily build.

4. **The precise tiles-per-session credit exposure — narrowed to a range, not eliminated.** §F2
   measured 232 `.pbf` requests / 49 completing plain-200 for one real multi-Day, multi-metro session.
   What remains open is *which end of that range Stadia bills*: whether a cancelled in-flight request
   consumes a credit, and how much of the 183-request gap is cancellation versus `304` cache
   revalidation rather than a fresh fetch. Neither is documented anywhere found in this research.
   **Cost to verify:** inspect individual request status/`cache-control` behaviour in DevTools across
   a session that revisits the same area inside the 6-hour tile cache window, or ask Stadia support
   directly whether aborted requests are billed.

5. ~~The rendered appearance of the overlay against the basemap at z13–14.~~ **Resolved (§F6):** the
   amber Path line and grey basemap rail share a width but are visually separable by hue. Confirmed
   by a real screenshot in Shinjuku, which also independently corroborated §A6 (no station labelled)
   and §A7 (both scripts render newline-joined).

6. ~~The live tiles-per-session count.~~ **Measured, not resolved** — see item 4 above. The blocker
   §F2 diagnosed (MapLibre's tile requests require a live rAF loop) is fully closed: a real browser
   produced a real count. What that count means for billing is the part still open.

7. ~~That the attribution control renders its three credits, non-compact, in a real browser.~~
   **Resolved (§F5):** confirmed by direct observation — "© Stadia Maps © OpenMapTiles ©
   OpenStreetMap", bottom-right, no click required.

---

## Reproducing

Every measurement is re-runnable with `curl`, Python 3 and Node, no credentials.

1. **Stadia style** —
   `curl -sS https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json`, then walk `layers[]`
   filtering on `id`, `type`, `source-layer`, `minzoom`, `filter`, `paint` and `layout.text-field`.
   Note the `railway_dashline` layer is a `{"ref": "railway"}` layer with no `type` key — code that
   assumes every layer has one will throw.
2. **TileJSON and attribution** — `curl -sS https://tiles.stadiamaps.com/data/openmaptiles.json`;
   read `tiles[0]`, `maxzoom`, `attribution`.
3. **API-key propagation** — refetch the style with `?api_key=ANYTHING` and diff `sources`, `glyphs`,
   `sprite`.
4. **Keyless auth behaviour** — the tile index for 35.6812 N / 139.7671 E at z14 is
   `14/14552/6451` (`x = ⌊(lon+180)/360 · 2^z⌋`, `y = ⌊(1 − asinh(tan(lat))/π)/2 · 2^z⌋`). Then:
   ```
   curl -s -o /dev/null -w "%{http_code} %{size_download} %{content_type}\n" \
     https://tiles.stadiamaps.com/data/openmaptiles/14/14552/6451.pbf          # 401, image/png
   curl -s -o /dev/null -w "%{http_code} %{size_download} %{content_type}\n" \
     -H "Referer: http://localhost:3000/" \
     https://tiles.stadiamaps.com/data/openmaptiles/14/14552/6451.pbf          # 200, MVT
   ```
   The 401 body is a readable PNG — save it and open it.
5. **Tile decode** — fetch with the `Referer` header above, then walk the MVT protobuf wire format:
   field 3 = layer (name = 1, feature = 2, key = 3, value = 4, extent = 5, version = 15); feature
   field 2 = packed tag-index pairs into the layer's key/value tables, field 3 = geometry type,
   field 4 = packed geometry commands. Same reader as §Q5c's.
6. **Line widths** — `npm i @maplibre/maplibre-gl-style-spec`, then
   ```js
   const S = require('@maplibre/maplibre-gl-style-spec');
   const spec = S.latest.paint_line['line-width'];
   console.log(JSON.stringify(S.convertFunction({base:1.3, stops:[[16,3],[20,7]]}, spec)));
   const r = S.createPropertyExpression(
     ['interpolate',['exponential',1.3],['zoom'],16,3,20,7], 'line-width', spec);
   r.value.evaluate({zoom:13}, {properties:{}});   // 3
   ```
   Note the v26 signature is `(expression, rootKey, propertySpec)` — three arguments, not two — and
   `convertFunction` mutates the spec object it is handed, so pass a fresh one per call.
7. **Contrast ratios** — standard WCAG relative luminance
   (`0.2126 R + 0.7152 G + 0.0722 B` on linearised channels), `(L1+0.05)/(L2+0.05)`. Alpha compositing
   is `fg·α + bg·(1−α)` per channel against the style's own `#333333` background.
8. **Bundle sizes** — `curl -sL https://unpkg.com/<pkg>@<ver>/<dist file> | gzip -9 | wc -c`.
9. **Registry state** — `curl -s https://registry.npmjs.org/<pkg>`, reading `dist-tags`, `time`,
   `versions[latest].license`, `versions[latest].peerDependencies`.
10. **Extract sizes** — `curl -sIL <geofabrik url>`, reading `Content-Length`.
11. **planetiler** — `curl -sL https://raw.githubusercontent.com/onthegomap/planetiler/main/README.md`;
    grep for `Java 21`, `free RAM`, `disk space`, `--osm-path`, and the `## Benchmarks` table.
12. **Java** — `java -version` and `/usr/libexec/java_home -V`.
13. **The live app (§F)** — `pnpm dev`, open a trip, click the **Map** toggle. In the browser console,
    reach the MapLibre instance (react-map-gl does not expose it globally; walk the React fiber from
    `document.querySelector('.maplibregl-map')` looking for an object with both `getZoom` and
    `style.tileManagers`). Then read `map.style.stylesheet.layers.length`,
    `map.getSource('openmaptiles')` (`tiles`, `minzoom`, `maxzoom`, `tileSize`), and
    `map.transform.width/height`. Tile counts live in `map.style.tileManagers.<id>._tiles` — note the
    v5 rename from `sourceCaches`, and note that `transform.coveringTiles()` no longer exists in v5.
    **This will report zero tiles in any headless or occluded browser** (§F2); confirm
    `document.visibilityState === "visible"` before believing any tile count.
14. **Tiles-per-session, for real (§F2, §F6)** — the method automation cannot substitute for: open the
    app in a real, visible browser window, DevTools → Network, filter `.pbf`, tick Disable cache for a
    cold count. Browse a realistic session (multiple Days, both metro tabs). Read the request count
    in the status bar. Add a second filter, `.pbf status-code:200`, to split completed from
    cancelled/other. To attribute the gap between the two counts, inspect individual requests'
    status (cancelled vs `304`) rather than trusting the aggregate split alone.

Working files were kept in the session scratchpad and are not committed.
