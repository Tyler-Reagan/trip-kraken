# Research: the map rendering stack and OSM data ownership

**Date:** 2026-08-05
**Feeds:** [#144 — Evaluate the map rendering stack and OSM data ownership](https://github.com/Tyler-Reagan/trip-kraken/issues/144) (part of #128)
**Status:** Facts only. This document deliberately makes **no recommendation** — no renderer, no basemap
provider, no self-hosting verdict. That is the grilling session's job.

## How these findings were produced

Two evidence classes, kept distinct throughout:

1. **Documentation** — official docs and licence files for MapLibre, Leaflet, OpenLayers, deck.gl,
   Protomaps, planetiler, CARTO, MapTiler, Stadia Maps, the OSM Wiki and the OSMF. Cited by URL.
2. **Measurement** — the npm registry and published `dist` artifacts measured directly; the *exact*
   style URL `MapView.tsx` loads fetched and parsed; and a real Mapbox Vector Tile over Tokyo Station
   downloaded and decoded feature-by-feature. Where a vendor's marketing and its licence file
   disagree, the measurement says which one the app is actually relying on.

The tile measurement corpus is **z14/14552/6451**, the CARTO `carto.streets/v1` tile containing Tokyo
Station (35.6812 N, 139.7671 E) — 403,601 bytes gzipped, 695,110 bytes raw. Decoded with a
hand-rolled MVT reader (protobuf wire-format walk; layers → keys/values → per-feature tag pairs).

Everything marked **⚠️ unverified** is an extrapolation I could not tie to a primary source. There are
three of them, all in Q4, and they are all the same shape: planetiler publishes no Japan benchmark.

---

## Q1. Does the renderer choice constrain the format of our own overlay geometry?

**Bottom line: NO for the storage-format question #142 cares about — all four renderers consume plain
lng/lat (or lat/lng) coordinate arrays, and GeoJSON `LineString` is directly accepted by MapLibre,
OpenLayers and deck.gl. But the preliminary finding that "none decode Google-encoded polylines
natively" is REFUTED: OpenLayers ships `ol/format/Polyline`, a first-class encoded-polyline reader.
Three of four still need a client-side decode step, so GeoJSON coordinate arrays remain the only
choice that is zero-translation everywhere. Two smaller gotchas: Leaflet's native axis order is
`[lat, lng]`, the transpose of GeoJSON's `[lng, lat]`; and OpenLayers' polyline reader also assumes
`[latitude, longitude]`.**

### MapLibre GL JS — GeoJSON only, no polyline decoder

[MapLibre Style Spec — Sources](https://maplibre.org/maplibre-style-spec/sources/), on the `geojson`
source's `data`:

> "A URL to a GeoJSON file, or inline GeoJSON."

The page lists six source types — `vector`, `raster`, `raster-dem`, `geojson`, `image`, `video` — and
mentions encoded polylines nowhere. The [`GeoJSONSource` API](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/)
types `setData` as `string | GeoJSON<...>`, where the `string` is a URL. No decoder exists;
`@mapbox/polyline` or equivalent would be an added client-side dependency.

### Leaflet — `[lat, lng]` arrays, no polyline decoder in core

[`src/layer/vector/Polyline.js`](https://github.com/Leaflet/Leaflet/blob/main/src/layer/vector/Polyline.js):

> "A class for drawing polyline overlays on a map. Extends `Path`."

with the JSDoc example passing latitude-first pairs:

```js
const latlngs = [
    [45.51, -122.68],
    [37.77, -122.43],
    [34.04, -118.2]
];
```

The word "encoded" does not appear in the file. GeoJSON is consumed via the separate `L.GeoJSON`
layer. **The axis order is the trap**: Leaflet's native primitive is `[lat, lng]`, the transpose of
GeoJSON's `[lng, lat]` — a one-line `.map()`, not a format change, but it is not a no-op either.

### OpenLayers — GeoJSON *and* a native encoded-polyline format

Two separate format classes, both first-party:

[`ol/format/GeoJSON`](https://openlayers.org/en/latest/apidoc/module-ol_format_GeoJSON-GeoJSON.html):

> "Feature format for reading and writing data in the GeoJSON format."

[`ol/format/Polyline`](https://openlayers.org/en/latest/apidoc/module-ol_format_Polyline-Polyline.html):

> "Feature format for reading and writing data in the Encoded Polyline Algorithm Format."

with constructor options `factor` (default `1e5`, i.e. precision 5) and `geometryLayout` (default
`'XY'`), and the full `readFeature` / `readFeatures` / `readGeometry` / `writeFeature` /
`writeFeatures` / `writeGeometry` method set. The docs also state that **"when reading, coordinates
are assumed to be two-dimensional in `[latitude, longitude]` order"** — matching Google's encoding,
not GeoJSON's axis order.

This directly contradicts the preliminary finding carried over from #142's grilling. OpenLayers is
the one renderer under consideration that would consume an encoded polyline with no extra dependency.

### deck.gl — coordinate arrays, GeoJSON-compatible, plus binary; no polyline decoder

[PathLayer](https://deck.gl/docs/api-reference/layers/path-layer), on `getPath`:

> "An array of points (`[x, y, z]`). Compatible with the GeoJSON [LineString](https://tools.ietf.org/html/rfc7946#section-3.1.4) specification."

It additionally accepts flat arrays or TypedArrays shaped `[x0, y0, z0, x1, y1, z1, …]`, and supports
supplying attributes as binary buffers with a `startIndices` array plus a `_pathType` prop to skip
normalisation. Encoded polylines are not mentioned. `GeoJsonLayer` consumes GeoJSON directly.

### Summary table

| renderer | native line primitive | GeoJSON direct? | encoded polyline native? | axis order |
|---|---|---|---|---|
| MapLibre GL JS | GeoJSON `LineString` | **yes** | **no** | `[lng, lat]` |
| Leaflet | `[lat, lng]` array (`L.Polyline`) | via `L.GeoJSON` | **no** | `[lat, lng]` |
| OpenLayers | coordinate array / `ol/geom/LineString` | **yes** (`ol/format/GeoJSON`) | **YES** (`ol/format/Polyline`) | `[lat, lng]` for the polyline reader |
| deck.gl | position array / flat TypedArray | **yes** | **no** | `[lng, lat]` |

---

## Q2. Renderer comparison on the axes that matter for this app

**Bottom line: MapLibre is the only one of the four that is simultaneously (a) a genuine
community-governed OSS project, (b) natively vector-tile-first, (c) covered by a first-party,
actively-released React binding this repo already uses, and (d) able to express every paint rule
`MapView.tsx` currently relies on declaratively. Leaflet is 3.5× smaller but raster-first, its core
has not shipped since May 2023, and its React binding is 20 months stale and carries the
non-OSI-approved Hippocratic 2.1 licence. OpenLayers matches MapLibre on capability with no
first-party React binding. deck.gl is not a replacement — its own docs recommend react-map-gl
(MapLibre) underneath it — so choosing deck.gl means adding ~470 KB gzip on top of MapLibre, not
instead of it.**

### 2a. Bundle size — measured, not quoted

Published `dist` artifacts fetched from unpkg and gzipped locally (`gzip -9`):

| package | version | file(s) | raw | gzip |
|---|---|---|---:|---:|
| `leaflet` | 1.9.4 | `dist/leaflet.js` | 147,552 | **42,437** |
| `maplibre-gl` | 5.24.0 (this repo's line) | `dist/maplibre-gl.js` (UMD) | 1,056,837 | **275,164** |
| `maplibre-gl` | 5.24.0 | `dist/maplibre-gl.css` | 70,024 | 10,081 |
| `maplibre-gl` | 6.1.0 | `.mjs` + `-shared.mjs` + `-worker.mjs` | 1,057,555 | **277,351** |
| `ol` | 10.10.0 | `dist/ol.js` (full bundle) | 1,043,059 | **289,580** |
| `deck.gl` | 9.3.7 | `dist.min.js` | 1,646,765 | **469,860** |

Bundlephobia, for cross-check ([bundlephobia.com](https://bundlephobia.com/)): `maplibre-gl@6.1.0`
977,008 / 250,458 gzip, 17 deps; `leaflet@1.9.4` 148,515 / 42,736, 0 deps; `ol@10.10.0` 295,764 /
84,476, 6 deps; `deck.gl@9.3.7` 1,605,750 / 460,015, 16 deps.

⚠️ **The two OpenLayers figures disagree by 3.4×, and the discrepancy is real, not an error.**
`ol`'s published `package.json` has `main: index.js`, no `module` field, and
`sideEffects: ["proj.js", "ol.css"]` — it is distributed as tree-shakeable ES source, so bundlephobia's
84 KB reflects importing a subset while the 290 KB `dist/ol.js` is the everything-bundle. OpenLayers'
real cost lands somewhere between depending on how much of it you import. MapLibre, Leaflet and
deck.gl do not have this property to the same degree; MapLibre in particular ships a WebGL engine and
a worker that are not meaningfully tree-shakeable.

Note also that **maplibre-gl 6.x dropped the UMD bundle** and ships ESM only (`maplibre-gl.mjs`,
`maplibre-gl-shared.mjs`, `maplibre-gl-worker.mjs`); the combined gzip is essentially unchanged from
5.x. This repo pins `^5.21.1`, so a v6 bump is a separate, already-available migration.

### 2b. React integration maturity in 2026 — measured from the npm registry

| binding | latest | published | licence | peer deps |
|---|---|---|---|---|
| `react-map-gl` | 8.1.2 | **2026-07-29** | MIT | `react >=16.3`, `maplibre-gl >=1.13.0`, `mapbox-gl >=1.13.0` |
| `@deck.gl/react` | 9.3.7 | **2026-07-16** | MIT | `react >=16.3`, `@deck.gl/core ~9.3.0` |
| `react-leaflet` | 5.0.0 | **2024-12-14** | **Hippocratic-2.1** | `leaflet ^1.9.0`, `react ^19.0.0` |
| `rlayers` (OpenLayers) | 3.9.0 | 2026-02-11 | ISC | **`ol` pinned to `=10.8.0`**, `react >=18` |
| `leaflet` (core) | 1.9.4 | **2023-05-18** | BSD-2-Clause | — |
| `ol` (core) | 10.10.0 | 2026-07-27 | BSD-2-Clause | — |
| `maplibre-gl` (core) | 6.1.0 | 2026-07-30 | BSD-3-Clause | — |

Three facts worth carrying forward:

- **`react-leaflet@5.0.0` is licensed Hippocratic-2.1**, which is not an OSI-approved open-source
  licence. Leaflet *core* is BSD-2-Clause; the React binding is not. This is a licence-review item
  that does not exist for the other three.
- **Leaflet core's last stable release is 1.9.4 from 2023-05-18.** `dist-tags` shows an `alpha` of
  `2.0.0-alpha.1` published 2025-08-16. Leaflet 2.0 has been in alpha for a year.
- **`rlayers` pins `ol` to exactly `=10.8.0`** while `ol` is at 10.10.0. OpenLayers publishes no
  first-party React binding; `rlayers` is a third-party project.

**Next.js App Router / RSC.** All four render into a DOM element or a WebGL context and therefore must
sit behind a client-component boundary; `src/components/MapView.tsx:1` already carries `"use client"`.
The differences are in how loudly each library says so:

- react-leaflet documents the hard constraint outright
  ([start-introduction](https://react-leaflet.js.org/docs/start-introduction/)): *"Leaflet makes
  direct calls to the DOM when it is loaded, therefore React Leaflet is not compatible with
  server-side rendering."* The same page adds that *"React's `Activity` component executes effects
  while retaining the map container element, making it incompatible with how React Leaflet works."*
- deck.gl's [React guide](https://deck.gl/docs/get-started/using-with-react) says v9.0+ is fully ES
  module compliant, and for Next.js recommends either adding `"type": "module"` to `package.json` or
  dynamically importing with `ssr: false` — *"appropriate since deck.gl renders into a WebGL2/WebGPU
  context."*
- react-map-gl's [get-started](https://visgl.github.io/react-map-gl/docs/get-started) states only
  `node >= 12` and `react >= 16.3`; it does not discuss RSC. Its peer-dependency range accepts both
  `maplibre-gl` and `mapbox-gl`, and this repo imports the MapLibre entrypoint
  (`react-map-gl/maplibre`, `MapView.tsx:5-6`).

`react-map-gl` and `@deck.gl/react` are both vis.gl projects; react-map-gl's docs site carries
OpenJS Foundation trademark/copyright notices.

### 2c. Vector vs raster tile support

| renderer | vector tiles | raster tiles |
|---|---|---|
| MapLibre GL JS | native — `vector` source type ([style spec](https://maplibre.org/maplibre-style-spec/sources/)) | native — `raster`, `raster-dem` |
| Leaflet | **core: no.** `L.TileLayer` is raster-image-based; vector tiles require plugins | native — `L.TileLayer` |
| OpenLayers | native — [`ol/format/MVT`](https://openlayers.org/en/latest/apidoc/module-ol_format_MVT-MVT.html): *"Feature format for reading data in the Mapbox MVT format."* | native |
| deck.gl | native — [`MVTLayer`](https://deck.gl/docs/api-reference/geo-layers/mvt-layer): *"a derived `TileLayer` that makes it possible to visualize very large datasets through MVTs"* | via `TileLayer`/`BitmapLayer` |

Leaflet's raster-only core is the load-bearing item: the current basemap
(`basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`) is a **vector** style — measured below in
Q5 — so moving to Leaflet means either switching to CARTO's raster endpoints or adding a vector-tile
plugin.

### 2d. Ergonomics against what `MapView.tsx` actually does

The overlay work in `src/components/MapView.tsx` is, concretely:

| what the file does | where | what a renderer must offer |
|---|---|---|
| one `FeatureCollection<LineString>` for all days, one `FeatureCollection<Point>` for all stops | lines 144-229 | bulk feature source |
| `line-color` / `line-opacity` read per-feature from properties via `["get", "color"]` / `["get", "alpha"]` | lines 231-240 | **data-driven paint expressions** |
| `circle-radius` / `circle-color` / `circle-stroke-*` via `["case", ["==", ["get", "isHighlighted"], 1], …]` | lines 242-267 | **conditional paint expressions** |
| hit-testing by `queryRenderedFeatures(e.point, { layers: ["stops"] })` for hover *and* click | lines 324-352 | **layer-scoped point hit-testing** |
| `map.fitBounds(bounds, { padding, maxZoom, duration })` and `map.flyTo({ center, zoom, duration })` | lines 296-302 | **animated camera with asymmetric padding** |
| distinguishing user-initiated camera moves via `e.originalEvent` presence | lines 315-320 | event provenance on move handlers |

Mapping that onto the four:

- **MapLibre** — all six are the style spec's own vocabulary: `["get", …]` and `["case", …]` are
  documented expression operators, `queryRenderedFeatures` takes a `layers` filter, and `fitBounds`
  takes a four-sided `padding` object. This is what the file is written against today.
- **OpenLayers** — expressive equivalent, different idiom: paint is a `StyleFunction` (a JS callback
  per feature) rather than a declarative expression tree; hit-testing is
  `map.forEachFeatureAtPixel`; camera is `view.fit(extent, {padding, duration, maxZoom})`. The
  per-feature style callback runs in JS on every render pass, where MapLibre's expressions compile
  into the GPU paint path — a performance-shape difference at high feature counts, not a capability
  gap.
- **Leaflet** — `L.Polyline`/`L.CircleMarker` are individual DOM/canvas objects with per-object
  options, so "data-driven styling" means constructing N objects, and the day-alpha recompute in
  lines 155-158 becomes an imperative loop rather than a source swap. Hit-testing is per-layer event
  handlers, not a spatial query. `map.fitBounds` supports `paddingTopLeft`/`paddingBottomRight`, which
  covers the asymmetric left-panel padding in `fitPadding()` (lines 271-275).
- **deck.gl** — accessors (`getColor`, `getWidth`, `getRadius`) are per-feature JS callbacks with
  explicit `updateTriggers`; picking is `deck.pickObject({x, y, layerIds})`; camera is a controlled
  `viewState` you animate yourself (`FlyToInterpolator`) rather than an imperative `flyTo`. That last
  one is the biggest rewrite: `applyFocus` (lines 289-306) is imperative-camera-shaped, and #137's
  "consume the focus command then clear it" contract would have to be re-expressed as view-state
  transitions.

### 2e. Licensing and governance

| project | licence | governance / backing |
|---|---|---|
| MapLibre GL JS | **BSD-3-Clause** | MapLibre Organization (own charter) |
| Leaflet | **BSD-2-Clause** | Volunteer-maintained; core stable release 2023-05-18 |
| `react-leaflet` | **Hippocratic-2.1** (not OSI-approved) | Single-maintainer repo (`PaulLeCam/react-leaflet`) |
| OpenLayers | **BSD-2-Clause** | OpenLayers project |
| deck.gl / `@deck.gl/react` | **MIT** | vis.gl (OpenJS Foundation) |
| `react-map-gl` | **MIT** | vis.gl (OpenJS Foundation) |
| Mapbox GL JS (for contrast) | **proprietary Mapbox TOS** | Mapbox, Inc. |

The [MapLibre charter](https://github.com/maplibre/maplibre/blob/main/CHARTER.md) describes three
bodies: a **Technical Steering Committee** that is *"open to everyone and there are no special
requirements if someone wants to join it"*, a five-person elected **Governing Board** that *"retains
the authority over all decisions the MapLibre Projects make, and may overrule the Technical Steering
Committee in case of a dispute"*, and **Voting Members** drawn from contributors and donors. The
charter names **no foundation or fiscal host** — MapLibre runs its own finances with a Treasurer on
the Board. Its stated goal is *"to build a friendly and innovative open-source community around the
unaffiliated MapLibre Projects."*

Funding is commercial, though: the [maplibre-gl-js README](https://github.com/maplibre/maplibre-gl-js)
lists **Microsoft and AWS** as gold sponsors and **MIERUNE, komoot, JawgMaps, Radar, mapme, MapTiler,
Caltopo and SmartMaps** as silver. Note that **MapTiler — one of the basemap vendors evaluated in Q3 —
sponsors MapLibre.**

### 2f. The MapLibre-vs-Mapbox history, precisely

The [maplibre-gl-js README](https://github.com/maplibre/maplibre-gl-js) states it plainly:

> "It originated as an open-source fork of mapbox-gl-js, before their switch to a non-OSS license in
> December 2020."

and that the initial 1.x line was *"intended to be a drop-in replacement for the Mapbox's OSS version
(1.x) with additional functionality, but ha[s] evolved a lot since then."* Licence:

> "MapLibre GL JS is licensed under the 3-Clause BSD license."

What Mapbox actually changed is verifiable in their own repository.
[`mapbox-gl-js/LICENSE.txt`](https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt) opens:

> "The software and files in this repository (collectively, 'Software') are licensed under the Mapbox
> TOS for use only with the relevant Mapbox product(s) listed at www.mapbox.com/pricing."

It requires *"a current active Mapbox account in good standing"*, terminates automatically if the
account lapses or the TOS is breached, and notes the SDK *"sends limited de-identified location and
usage data"*. Mapbox GL JS v1 and earlier were BSD-3-Clause; v2.0 (December 2020) moved to this
proprietary licence, which is what the fork responded to.

**So on the "open/OSM-aligned vs commercial-adjacent" question the record is:** MapLibre is BSD-3,
community-chartered, not owned by any vendor, and explicitly exists *because* the commercial-adjacent
option stopped being open. Its funding comes from commercial map vendors, including one of the
basemap providers under evaluation. It is not a Mapbox product and carries no Mapbox account
requirement, telemetry, or TOS.

---

## Q3. Basemap provenance

**Bottom line: the current basemap is the single most exposed dependency in the stack. CARTO's own
licence file states in as many words that "Access to CARTO's basemap tile services is restricted to
CARTO enterprise customers and Non-Profit GRANTS only and is not available for free public use", and
their docs say "CARTO Basemaps are available exclusively with an Enterprise license." The
`basemaps.cartocdn.com` endpoint answers keyless with HTTP 200 — but serving without authentication is
not the same as licensing for use. Of the alternatives, MapTiler's and Stadia's free tiers BOTH
explicitly forbid commercial use; their cheapest commercial tiers are $30/mo and $20/mo respectively.
`tile.openstreetmap.org` publishes no rate limit but also no SLA and reserves the right to block
without notice. Self-hosted PMTiles is the only option with no third-party terms at all — its only
obligation is the ODbL attribution every option on this list already carries.**

### 3a. CARTO — the actual published terms for the keyless endpoint

The style URL in `src/components/MapView.tsx:14-15` is
`https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`. Measured: it returns **HTTP 200,
70,431 bytes**, with no API key, no `Authorization` header, and no referrer check.

The governing document is
[`CartoDB/basemap-styles/LICENSE.md`](https://github.com/CartoDB/basemap-styles/blob/master/LICENSE.md).
It splits into three parts, and the middle one is the decision-relevant fact:

> "Copyright (c) 2018, CartoDB Inc. All rights reserved."

> **"Access to CARTO's basemap tile services is restricted to CARTO enterprise customers and
> Non-Profit GRANTS only and is not available for free public use."**

- **Style code:** BSD 3-Clause.
- **Visual design:** Creative Commons Attribution 4.0.
- **The hosted tiles:** enterprise/grant only.

[CARTO's own FAQ](https://docs.carto.com/faqs/carto-basemaps) says the same thing from the other
direction: *"CARTO Basemaps are available exclusively with an Enterprise license"*, with the only
free path being *"for non-commercial purposes, our basemaps can be used for free in applications and
visualizations by CARTO grantees."* Once licensed, *"basemaps are included at no additional cost, and
you can use them as much as needed"* — there is **no standalone basemap pricing tier**, and CARTO
publishes no public price for an Enterprise licence.

**So: the endpoint is open, the licence is not.** The BSD-3 style JSON and the CC-BY design can be
reused; the *tile service they point at* is contractually restricted to a customer class this project
is not in. No rate limit is published, because rate limits are not the mechanism — eligibility is.

Attribution, per the same licence and the TileJSON the app transitively loads: **© CARTO, ©
OpenMapTiles, © OpenStreetMap contributors**. Measured, the served TileJSON at
`https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json` carries:

```
"attribution": "© CARTO, © OpenStreetMap contributors"
```

⚠️ Note that the served attribution string **omits OpenMapTiles**, which the licence file requires and
which the same TileJSON's own `description` field confirms is in play: `"OpenStreetMap data packaged
by OpenMapTiles"`. `MapView.tsx` renders no attribution control at all (there is no `<AttributionControl>`
or `attributionControl` prop in the file) — MapLibre adds a default one, but nothing in the repo
asserts it.

**What breaks if CARTO changes policy:** the entire basemap, instantly and silently, on a URL hardcoded
at `MapView.tsx:15`. There is no key to rotate, no account to upgrade, no contract to appeal to, and
no notice period, because there is no relationship. The failure mode is a blank canvas with our
overlay floating on it.

### 3b. MapTiler

[maptiler.com/cloud/pricing](https://www.maptiler.com/cloud/pricing/):

| tier | price | map sessions/mo | API requests/mo | commercial use | attribution |
|---|---:|---:|---:|---|---|
| Free | $0 | 5,000 | 100,000 | **not permitted** — *"Suitable for testing, personal or non-commercial use"* | MapTiler logo on the map |
| Flex | $30/mo | 25,000 | 500,000 | permitted | required for 3D sessions only |
| Custom | contact sales | negotiated | negotiated | permitted | negotiated; 99.9% SLA |

API key required. Overages on Flex are billed automatically at month end; Custom is prepaid volume
with soft limits and no automatic overage billing.

### 3c. Stadia Maps

[stadiamaps.com/pricing](https://stadiamaps.com/pricing/):

| tier | price | credits/mo | overage | commercial use |
|---|---:|---:|---|---|
| Free | $0 | 200,000 | none — hard stop | **not allowed** |
| Starter | $20/mo | 1,000,000 | +$0.03 / 1,000 | allowed |
| Standard | $80/mo | 7,500,000 | +$0.02 / 1,000 | allowed |
| Professional | $250/mo | 25,000,000 | +$0.015 / 1,000 | allowed |

New accounts get a 14-day no-credit-card Professional trial, then drop to Free.

Authentication is the friendliest of the three for this repo's current shape
([docs.stadiamaps.com/authentication](https://docs.stadiamaps.com/authentication/)):

> "As long as you're running via a development server accessed via `localhost` or `127.0.0.1`, you
> don't need an API key!"

with the caveat that *"requests made this way are subject to strict rate limits. If you start
receiving HTTP 429 responses regularly, sign up for an account (it's free!) and create an API key."*
For production, domain-based auth validates `Origin`/`Referer` against a dashboard allowlist, so no
key need be embedded in client code.

### 3d. Protomaps / PMTiles, self-hosted

No provider terms, because there is no provider. [docs.protomaps.com/basemaps/downloads](https://docs.protomaps.com/basemaps/downloads)
describes the basemap as an *"Open Database License Produced Work (OpenStreetMap attribution
required)"*. The only obligation is the ODbL one that already applies to CARTO, MapTiler, Stadia and
OSM tiles alike.

Rate limits, key requirements and pricing are whatever your object store charges for bytes served.
"Provider changes policy" degenerates into "your CDN bill changes" or "you choose to rebuild from a
newer extract".

### 3e. Raw OSM raster tiles (`tile.openstreetmap.org`)

The [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) is a **best-effort,
no-SLA** service. Its "Must" list:

> - "Use the correct URL: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`"
> - "Provide visible **licence attribution**"
> - "Send a **valid HTTP User-Agent** that clearly identifies your application"
> - "From web pages, ensure a valid **HTTP Referer** header is sent"
> - "**Cache** tiles locally according to HTTP caching headers (or at least **7 days**)"

It publishes **no numeric rate limit**. Instead it states that capacity is limited, that there is *"no
SLA or guarantee"*, and that access *"may be blocked without prior notice"* if usage degrades the
service. Bulk downloading — *"any pre-emptive fetching of tiles other than those a user is actively
viewing"* — is prohibited, including pre-seeding, building `.mbtiles`/`.zip` archives, and automated
wide-bbox scans. *"Offline use is not permitted on `tile.openstreetmap.org`."*

Two practical constraints beyond the policy: these are **raster** 256px tiles (Leaflet-shaped, and a
downgrade from the current vector style), and there is **no dark theme** — the standard OSM Carto style
is light, which conflicts with `MapView.tsx`'s dark palette (`LODGING_COLOR = "#e5e7eb"`, dark tooltip
chrome, etc.).

### 3f. OSM attribution obligations (applies to every row above)

[openstreetmap.org/copyright](https://www.openstreetmap.org/copyright): the data is *"licensed under
the Open Data Commons Open Database License (ODbL)"*, and *"if you alter or build upon our data, you
may distribute the result only under the same license."*

The [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) add
the placement rules:

> "The historical forms of attribution '© OpenStreetMap contributors' or '© OpenStreetMap' are
> acceptable."

> "The credit should typically appear in a corner of the map. […] While the lower right corner is
> traditional, any corner of the map is acceptable."

> "Attribution format should not require individuals to interact with the map or produced work to see
> the attribution."

Collapsible attribution is permitted provided the licence information stays reachable via an info
button or menu.

---

## Q4. The self-hosted OSM basemap path, in concrete terms

**Bottom line: the tooling is mature, Apache-2.0, and would consume the exact same pinned Geofabrik
file the rail pipeline already downloads — measured at 2,342,296,009 bytes (2.18 GiB) for
`japan-260101.osm.pbf`. planetiler's stated requirements for an input that size are ~1.2 GB RAM and
~12–24 GB scratch disk, which this machine clears comfortably (10 cores, 16 GiB RAM, 311 GiB free) —
except that **Java is not installed here** and planetiler requires Java 21+. The one number the ticket
asked for that does not exist is Japan's: planetiler's README publishes benchmark rows for the
**planet only**, no regional extracts at all. Everything about Japan's output size and build time
below is extrapolation, marked as such.**

### 4a. Input

`scripts/ingest-transit-graph.sh:16` pins `https://download.geofabrik.de/asia/japan-260101.osm.pbf`.
Measured via HTTP `Content-Length`:

| file | bytes | |
|---|---:|---|
| `japan-260101.osm.pbf` (the pinned one) | 2,342,296,009 | 2.18 GiB |
| `japan-latest.osm.pbf` (today: `japan-260804`) | 2,484,012,396 | 2.31 GiB |

### 4b. planetiler — requirements and what it publishes

[github.com/onthegomap/planetiler](https://github.com/onthegomap/planetiler). Licence: **Apache 2.0** —
*"Maps built using planetiler do not require any special attribution, but the data or schema used
might. Any maps generated from OpenStreetMap data must visibly credit OpenStreetMap contributors. Any
map generated with the profile based on OpenMapTiles or a derivative must visibly credit OpenMapTiles
as well."* Output formats: **MBTiles (sqlite) or PMTiles**.

Stated requirements:

> "Java 21+"

> "at least 0.5x as much free RAM as the input `.osm.pbf` file size"

> "at least 1GB of free SSD disk space plus 5-10x the size of the `.osm.pbf` file"

For Japan's 2.18 GiB input that is **≥ ~1.1 GiB RAM** and **~12–23 GiB scratch disk**. Auxiliary
downloads on first run, per the README: *"about 1GB of data sources required by the OpenMapTiles
profile including ~750MB for ocean polygons and ~240MB for Natural Earth Data."*

The relevant flags ([README](https://raw.githubusercontent.com/onthegomap/planetiler/main/README.md)):

> - `--download` downloads input sources automatically and `--only-download` exits after downloading
> - `--area=monaco` downloads a `.osm.pbf` extract from [Geofabrik](https://download.geofabrik.de/)
> - **`--osm-path=path/to/file.osm.pbf` points Planetiler at an existing OSM extract on disk**

That last flag is what makes Q6 answerable.

**The published benchmark table — every row is the planet:**

| input | version | machine | time | output |
|---|---|---|---|---|
| planet-260302 (92 GB) | 0.10.1 | h4d-standard-192 (192cpu/720GB) | 19m | 81 GB pmtiles |
| planet-240115 (69 GB) | 0.7.0 | c3d-standard-180 (180cpu/720GB) | 16m | 69 GB pmtiles |
| planet-240108 (73 GB) | 0.7.0 | c7gd.16xlarge (64cpu/128GB) | 29m / 42m | 69 GB pmtiles |
| planet-240108 (73 GB) | 0.7.0 | c7gd.2xlarge (8cpu/16GB) | **3h35m** | 69 GB pmtiles |
| planet-240108 (73 GB) | 0.7.0 | im4gn.large (2cpu/8GB) | 18h18m | 69 GB pmtiles |
| planet-220530 (69 GB) | 0.5.0 | c6gd.16xlarge → 4xlarge | 53m → 2h38m | 79 GB mbtiles |

**There is no Japan row, and no regional row of any kind.** The nearest usable anchor is the
`c7gd.2xlarge (8cpu/16GB)` row — 8 cores and 16 GB RAM, close to this machine's 10 cores / 16 GiB.

⚠️ **Unverified extrapolation — build time.** Japan's 2.18 GiB is ~3.0% of that row's 73 GB input. If
throughput were linear (it is not — fixed costs like ocean-polygon processing and Natural Earth do not
shrink with the extract), 3h35m × 0.030 ≈ **~7 minutes**, realistically some tens of minutes once
fixed costs are counted. **This is arithmetic on a planet-scale row, not a published figure.**

⚠️ **Unverified extrapolation — output size.** Across the planet rows the pmtiles output is 0.88–0.95×
the input pbf. Applying that to 2.18 GiB gives **roughly 1.9–2.1 GB for Japan**. This ratio is
particularly untrustworthy for a regional extract: the planet's output includes enormous low-density
ocean and wilderness coverage that amortises differently than a dense, entirely-land archipelago, and
Japan is among the densest-mapped regions in OSM. Treat this as an order of magnitude, not a budget.

⚠️ **Unverified — the numbers above cannot be tightened without running it.** A real measurement is
available for ~$0 and one `--area=japan` invocation, but requires installing a JDK 21+ (absent here)
and ~25 GB of scratch.

### 4c. The Protomaps alternative to building at all

[docs.protomaps.com/basemaps/downloads](https://docs.protomaps.com/basemaps/downloads): daily planet
builds of the Protomaps Basemap are published at `maps.protomaps.com/builds`, covering **zoom 0–15 at
roughly 120 GB**. Rather than downloading the planet, *"you can obtain cutouts of specific areas using
the CLI's extract command"* (`pmtiles extract`), with `--maxzoom` to trim — noting that *"each
additional zoom level roughly doubles the size of the file."*

This path skips planetiler, Java, the 2.18 GiB pbf and the 1 GB of auxiliary sources entirely: it is a
ranged read against someone else's build, producing a local file you then own. ⚠️ Protomaps publishes
**no example regional extract sizes**, so Japan's cutout size is unknown from primary sources here too.

### 4d. Hosting

[docs.protomaps.com/pmtiles](https://docs.protomaps.com/pmtiles/): *"PMTiles is a single-file archive
format for pyramids of tiled data"*, and *"PMTiles readers use HTTP Range Requests to fetch only the
relevant tile or metadata inside a PMTiles archive on-demand."* Supported hosting: **AWS S3,
Cloudflare (with dedicated guides), Google Cloud, Azure, or self-hosted** — anything that honours HTTP
range requests, which is every static CDN. No tile server process, no database, no scaling story.

Client support: **MapLibre GL JS (documented as the recommended integration), Leaflet, and
OpenLayers**, plus Python/Dart/Kotlin/Rust readers. No documented file-size ceiling; global basemaps of
300 million tiles are described as feasible.

---

## Q5. Japan-specific rendering quality — measured against the live basemap

**Bottom line: the current CARTO Dark Matter basemap draws Japan's rail network but labels none of it,
and labels no stations at all — even though the tile data underneath carries every station name in
both kanji and romaji. Measured on the Tokyo Station tile: 45 `class=railway` POIs with `name` (東京),
`name:en` (Tōkyō), `name:ja` and `name:latin`, none of which the style renders; and 16 `class=rail`
line features, **zero** of which carry a `name` key at all. The style switches script by zoom —
`{name_en}` up to z8, `{name}` from z13/z14 — so the same city reads "Tokyo" zoomed out and 東京 zoomed
in. The overlay-conflict risk is REAL but zoom-bounded: CARTO starts drawing rail at **z13** in
`#1a1a1a`, near-invisible on Dark Matter's background, so #142's traced geometry would coincide with
faint basemap lines from z13 up and have the canvas entirely to itself below z13.**

### 5a. What the style actually contains — measured

Fetched `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` (HTTP 200, 70,431 bytes):

| property | value |
|---|---|
| `name` | Dark Matter |
| sources | one: `carto` → `https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json` (**vector**) |
| source maxzoom | **14** (overzoomed above) |
| total layers | **93** |
| rail-related layers | **4** |

The four rail layers, all reading `source-layer: transportation` filtered on `class == "rail"`:

| layer | type | minzoom | paint |
|---|---|---:|---|
| `rail` | line | **13** | `line-color: #1a1a1a`, width 0.5@z13 → 1@z14 → 3@z16 → 7@z21 |
| `rail_dash` | line | 15 | `line-color: #111`, dasharray, width 0.5@z15 → 5@z20 |
| `tunnel_rail` | line | — | filtered `brunnel == tunnel` |
| `tunnel_rail_dash` | line | — | filtered `brunnel == tunnel` |

`#1a1a1a` and `#111` on the Dark Matter canvas are a hair above black. Rail is present but visually
recessive by design.

### 5b. Script selection — `name` vs `name_en`, measured across all 27 label layers

| pattern | layers | which |
|---|---:|---|
| `"{name_en}"` — always English/romaji | 10 | `place_country_1/2`, `place_state`, `place_continent`, `place_city_dot_r2/r4/r7/z7`, `place_capital_dot_z7`, `waterway_label` |
| `"{name}"` — always local script | 8 | `watername_ocean`, `watername_sea`, `poi_stadium`, `poi_park`, `roadname_minor/sec/pri/major` |
| zoom-switched `{name_en}`@z8 → `{name}`@z13 | 7 | `watername_lake`, `watername_lake_line`, `place_suburbs`, `place_villages`, `place_town`, `place_city_r5`, `place_city_r6` |
| zoom-switched `{name_en}`@z8 → `{name}`@**z14** | 1 | `place_hamlet` |
| `"{housenumber}"` | 1 | `housenumber` |

**So yes, there is a `name` vs `name:en` distinction the style must select on, and CARTO's answer is
zoom-dependent.** Country/state/major-city labels are permanently romaji; town/suburb/village labels
flip to kanji at z13; road names are *always* kanji.

⚠️ Note that CARTO selects on **`name_en`**, which the
[OpenMapTiles schema](https://openmaptiles.org/schema/) documents as deprecated:

> "**name_en**: English name `name:en` if available, otherwise `name`. This is deprecated and will be
> removed in a future release in favor of `name:en`."

`name_de` carries the same deprecation notice. A style built today would select on `name:en` directly.
The schema also confirms rail lives in the `transportation` and `transportation_name` layers, with
**no dedicated station layer** — stations arrive as `poi` features with `class = railway`.

### 5c. What the tile data carries vs what the style draws — the decisive measurement

Decoded tile **z14/14552/6451** (Tokyo Station), 403,601 bytes gzipped / 695,110 raw:

| layer | features | finding |
|---|---:|---|
| `poi` | 5,859 | **45 with `class=railway`** — every one carrying `name`, `name:en`, `name:ja`, `name:latin`, `subclass` (`station`/`subway`), `rank` |
| `transportation` | 839 | **16 with `class=rail`** — and **0 of them carry a `name` key** |
| `transportation_name` | 419 | **0 rail or transit features** — road classes only (`path`, `secondary`, `motorway`, …) |
| `place` | 432 | 90+ language variants incl. `name:ja`, `name:ja-Hira`, `name:ja-Latn`, `name:ja_rm`, `name:ja_kana`, `name:latin`, `name:nonlatin` |

Sample `poi` features, verbatim from the decoded tile:

```json
{"name": "東京",     "name:en": "Tōkyō",         "name:ja": "東京",     "name:latin": "Tōkyō",         "subclass": "station", "rank": 2}
{"name": "大手町",   "name:en": "Otemachi",      "name:ja": "大手町",   "name:latin": "Otemachi",      "subclass": "subway",  "rank": 2}
{"name": "三越前",   "name:en": "Mitsukoshimae", "name:ja": "三越前",   "name:latin": "Mitsukoshimae", "subclass": "subway",  "rank": 2}
```

Sample `transportation` rail features — note the total absence of a name:

```json
{"class": "rail", "layer": 2, "subclass": "rail"}
{"class": "rail", "layer": 2, "service": "siding", "subclass": "rail"}
{"brunnel": "tunnel", "class": "rail", "layer": 9, "subclass": "rail"}
```

Cross-referencing 5a: the only `poi`-sourced layers in the whole 93-layer style are `poi_stadium`
(filtered to `class in [stadium, cemetery, attraction]`, `rank <= 3`) and `poi_park`. **Nothing in
Dark Matter renders `class=railway`.** The station names are shipped in every tile and thrown away at
paint time.

**Three consequences, all factual:**

1. **Station labels are free to add and impossible to get from the current style.** The data is
   already in the bytes being downloaded; a forked style (BSD-3, per Q3a) could add a `poi` layer
   filtered to `class == "railway"` selecting `{name}` or `{name:en}`. No new data source needed.
2. **Rail *line* names cannot be rendered from these tiles at any zoom.** They are not in the tile —
   `transportation` rail features have no name and `transportation_name` has no rail entries. Line
   identity (JR Yamanote, Marunouchi Line) can *only* come from our own graph.
3. **The overlay-conflict risk is real but bounded.** From z13 up, CARTO draws rail geometry derived
   from the same OSM ways #142 traces — so our line would sit on near-identical basemap lines. Below
   z13 the basemap draws no rail at all. Given `MapView.tsx`'s camera semantics (`STOP_ZOOM = 14`,
   `maxZoom: STOP_ZOOM` on every `fitBounds`), **the app's most-used zoom range straddles exactly the
   z13 threshold where the conflict begins.**

### 5d. Protomaps, for comparison

[docs.protomaps.com/basemaps/layers](https://docs.protomaps.com/basemaps/layers): layers are
`boundaries, buildings, earth, landcover, landuse, places, pois, roads, transit, water`. Railways live
in **`roads`** (*"Linear transportation features designed for movement, including highways, streets,
railways and piers from OpenStreetMap"*), and the **`pois`** layer carries `kind: station`. There is
also a dedicated **`transit`** layer, which OpenMapTiles has no equivalent of.

Localization is handled structurally rather than by zoom
([docs.protomaps.com/basemaps/localization](https://docs.protomaps.com/basemaps/localization)):
fields `name`, `name2`, `name3` split multi-script names, with parallel `script`, `script2`, `script3`
tags naming the writing system (`Han`, `Latin`, …), plus `name:{lang}` translations. The documented
selection rule:

> "Show local names only if they use a different script than the target language. If the target
> language is not available, fallback to `name:en` if the local script is not Latin."

For a Japanese station that yields kanji **and** romaji together for an English-target style, rather
than CARTO's either/or-by-zoom.

⚠️ **Not measured.** I did not decode a Protomaps tile over Tokyo, so the *rendered* legibility of
Japanese stations in Protomaps — as opposed to the documented schema capability — is unverified here.
The CARTO findings in 5a–5c are measured; this subsection is documentation only.

---

## Q6. Shared machinery between a basemap pipeline and the rail-graph pipeline

**Bottom line: exactly one artifact is shareable — the 2.18 GiB pinned Geofabrik download — and
planetiler has a first-class flag for consuming it (`--osm-path=path/to/file.osm.pbf`). Nothing else
is. The osmium filter step is actively counterproductive to share: it reduces the extract to route
relations plus referenced ways and nodes (302,761 bytes for Shikoku, per the sibling #142 research),
discarding the roads, water, landuse, places and POIs a basemap is made of. The toolchains are
disjoint (osmium C++ CLI + Node/tsx vs a Java 21+ JAR), the outputs are disjoint (a 9,048,064-byte
SQLite graph vs a multi-GB PMTiles archive), and Java is not currently installed on this machine.**

### What is shared

**The download, and only the download.** `scripts/ingest-transit-graph.sh:26-27` curls
`japan-260101.osm.pbf` into a `mktemp -d` working directory and deletes it on exit (`trap 'rm -rf
"$WORK_DIR"' EXIT`, line 20). planetiler's README documents:

> "`--osm-path=path/to/file.osm.pbf` points Planetiler at an existing OSM extract on disk"

as an alternative to `--area=…` (which downloads from Geofabrik itself). So both pipelines can consume
byte-identical input from one 2.18 GiB fetch — which would mean **keeping** the extract rather than
trapping it away, a change to the existing script.

The other genuinely shared thing is **discipline, not code**: ADR-0019's pinned-URL rule
(`ingest-transit-graph.sh:14-16` — *"Bump this URL deliberately when refreshing the graph; never point
at a rolling `-latest` URL from automation"*) applies identically to a basemap build, and a "refresh
the OSM snapshot" operation would naturally regenerate both artifacts from the same dated file.

### What is not shared

| stage | rail graph | basemap |
|---|---|---|
| filter | `osmium tags-filter … r/route=train,subway,light_rail,monorail r/public_transport=stop_area,stop_area_group` (`ingest-transit-graph.sh:30-33`) | **none** — planetiler needs the full extract; roads, water, landuse, places and POIs are the basemap |
| intermediate | `osmium cat -f osm` → OSM XML (~200 MB for Japan) | none — planetiler reads `.osm.pbf` directly |
| transform | `npx tsx scripts/ingest-transit-graph.ts` | planetiler JAR (Java 21+) |
| extra inputs | none | ~1 GB: ~750 MB ocean polygons + ~240 MB Natural Earth |
| output | `db/transit-japan.db`, **9,048,064 bytes** SQLite | `.pmtiles` archive, ⚠️ ~2 GB estimated (Q4) |
| runtime deps | `osmium` (brew/apt), Node | **Java 21+ — not installed on this machine** |
| scratch disk | modest | 1 GB + 5–10× the pbf ≈ 12–23 GiB |

Feeding planetiler the rail-filtered `.osm.pbf` would produce a basemap containing rail lines and
nothing else — no coastline, no roads, no place labels. The two pipelines are not two views of one
filter; they are two consumers of one file.

---

## What this means for #144 and #142

Factual constraints the decision must respect. **No recommendation is made here.**

### On #142's renderer-independence — the finding another ticket depends on

1. **#142's output format is renderer-independent. CONFIRMED — but the stated reason is wrong.**
   The claim as written in #144 was "all four consume GeoJSON, none decode Google-encoded polylines
   natively." The first half holds: MapLibre, OpenLayers and deck.gl all take GeoJSON `LineString`
   directly, and Leaflet takes it via `L.GeoJSON`. **The second half is refuted** — OpenLayers ships
   `ol/format/Polyline`, a first-class encoded-polyline reader with a `factor` option defaulting to
   `1e5`. The conclusion survives anyway, and is arguably strengthened: **GeoJSON `[lng, lat][]`
   coordinate arrays are the only representation that is zero-translation on all four renderers**,
   whereas an encoded polyline would need a decode dependency on three of the four. #142 can proceed.

2. **Two coordinate-order caveats attach to that.** Leaflet's native `L.Polyline` takes `[lat, lng]`
   — the transpose of GeoJSON — and OpenLayers' polyline reader likewise assumes
   `[latitude, longitude]`. These are transpositions at the adapter layer, not storage-format
   decisions, but "renderer-independent" means "independent of *format*", not "independent of axis
   order".

3. **The renderer constrains the runtime format, never the storage format.** Whatever #142 stores —
   the sibling research measured a ~25× spread between GeoJSON-at-5dp and encoded-polyline-at-p5 —
   the render step is a decode/transform away on every candidate.

### On the renderer choice

4. **Nothing in `MapView.tsx` is MapLibre-exclusive in capability.** All six overlay behaviours it
   relies on (data-driven line paint, conditional circle paint, layer-scoped `queryRenderedFeatures`,
   asymmetric-padding `fitBounds`, animated `flyTo`, and `originalEvent`-based provenance) have
   equivalents in OpenLayers and deck.gl, and reduced equivalents in Leaflet. What differs is idiom
   and rewrite cost, not reachability.

5. **deck.gl is additive, not substitutive.** Its own React guide names react-map-gl (wrapping
   MapLibre) as the supported basemap path. Adopting deck.gl means ~470 KB gzip **on top of**
   MapLibre's ~275 KB, unless the basemap is dropped entirely.

6. **Leaflet's core is raster-first and its React binding is the weakest link.** `L.TileLayer` is
   raster-only in core, while the current basemap is a vector style; `react-leaflet@5.0.0` last
   published 2024-12-14 and is licensed **Hippocratic-2.1, which is not OSI-approved**, unlike
   Leaflet core's BSD-2. Leaflet core itself has not had a stable release since 2023-05-18, with 2.0
   in alpha for a year.

7. **OpenLayers has no first-party React binding.** `rlayers` is third-party, ISC, and pins `ol` to
   exactly `=10.8.0` while `ol` ships 10.10.0.

8. **On the "is MapLibre open or commercial-adjacent" question, both halves are true and neither is
   ambiguous.** MapLibre GL JS is BSD-3-Clause, governed by its own charter (open TSC, five-person
   elected Governing Board, no foundation or fiscal host), and exists precisely because Mapbox GL JS
   v2 moved to a licence requiring *"a current active Mapbox account in good standing."* Its funding
   comes from commercial vendors — Microsoft and AWS at gold, and **MapTiler, one of the basemap
   providers under evaluation, at silver.** It is not a Mapbox product and imposes no account,
   telemetry, or TOS obligation.

### On the basemap

9. **The current basemap is used outside its published licence.** CARTO's own `LICENSE.md`:
   *"Access to CARTO's basemap tile services is restricted to CARTO enterprise customers and
   Non-Profit GRANTS only and is not available for free public use."* Their docs: *"CARTO Basemaps
   are available exclusively with an Enterprise license."* The endpoint answering keyless with HTTP
   200 is not a grant of licence. This is a status fact about today's `main`, not a prediction.

10. **Every free tier evaluated forbids commercial use.** MapTiler Free is *"suitable for testing,
    personal or non-commercial use"*; Stadia's free plan states *"commercial use not allowed"*. The
    cheapest commercial entries are **MapTiler Flex $30/mo** (25,000 map sessions) and **Stadia
    Starter $20/mo** (1M credits). CARTO publishes no price at all.

11. **`tile.openstreetmap.org` publishes no rate limit and no SLA**, prohibits any pre-emptive
    fetching, and *"may be blocked without prior notice."* It is raster-only and has no dark style,
    which conflicts with the app's palette.

12. **Self-hosted PMTiles is the only option with no third-party terms.** Its sole obligation is the
    ODbL attribution — *"© OpenStreetMap contributors"*, in a corner of the map, visible without
    interaction — which **already applies to every other option on the list**, including the current
    one.

13. **The repo currently asserts no attribution.** `MapView.tsx` contains no attribution control or
    prop; it relies on MapLibre's default, and the TileJSON CARTO serves omits the OpenMapTiles credit
    its own licence requires.

### On self-hosting and shared machinery

14. **planetiler publishes no Japan figure, and no regional figure of any kind.** Its README benchmark
    table is planet-only. Japan's build time and output size in Q4 are ⚠️ **extrapolations from
    planet-scale rows** (~7 min to tens of minutes; ~1.9–2.1 GB) and should not be treated as
    budget-grade. A real measurement costs one `--area=japan` run.

15. **The stated requirements are within this machine's reach except for one blocker.** For a 2.18 GiB
    input planetiler wants ~1.1 GiB RAM and ~12–23 GiB scratch; this machine has 10 cores, 16 GiB RAM
    and 311 GiB free. **Java 21+ is required and is not installed.**

16. **`pmtiles extract` against Protomaps' daily 120 GB planet build is a second, cheaper path** that
    skips planetiler, Java, the 2.18 GiB pbf and the ~1 GB of auxiliary sources entirely — but
    Protomaps publishes no example regional sizes either.

17. **The two pipelines share the download and nothing else.** planetiler's
    `--osm-path=path/to/file.osm.pbf` can consume the same pinned `japan-260101.osm.pbf` the rail
    ingest fetches — which would require *keeping* that file rather than `trap`-deleting it
    (`ingest-transit-graph.sh:19-20`). The `osmium tags-filter` step cannot be shared: it strips away
    everything a basemap is made of. Toolchains, intermediates, extra inputs and outputs are all
    disjoint.

### On Japan rendering and overlay conflict

18. **The basemap draws rail from z13 up, in `#1a1a1a` on a near-black canvas.** #142's traced
    geometry would coincide with faint basemap lines derived from the same OSM ways at z13+, and have
    the canvas entirely to itself below z13. `MapView.tsx`'s `STOP_ZOOM = 14` (used as both the
    `flyTo` zoom and the `maxZoom` ceiling on every `fitBounds`) puts the app's default camera
    directly at that threshold.

19. **No station is labelled anywhere in the current style — but every station name is already in the
    tiles.** Measured on the Tokyo tile: 45 `class=railway` POIs carrying `name` (東京), `name:en`
    (Tōkyō), `name:ja` and `name:latin`, against a style whose only `poi` layers are stadium/cemetery/
    attraction and park. The style JSON is BSD-3-licensed and forkable.

20. **Rail *line* names are not obtainable from these tiles at any zoom.** `transportation` rail
    features carry no `name` key (0 of 16 on the measured tile) and `transportation_name` contains no
    rail features (0 of 419). Line identity can only come from our own graph.

21. **Script selection is a real style decision with a documented deprecation attached.** CARTO
    switches `{name_en}` → `{name}` at z13/z14 for towns and cities, keeps countries/states permanently
    romaji, and keeps road names permanently kanji. It selects on **`name_en`**, which OpenMapTiles
    documents as *"deprecated and will be removed in a future release in favor of `name:en`."*
    Protomaps takes a structurally different approach (`name`/`name2`/`name3` + `script`/`script2`/
    `script3`), documented as *"show local names only if they use a different script than the target
    language."*

## Reproducing

Every measurement is re-runnable with `curl` and Python 3 only, no credentials:

1. **Bundle sizes** — `curl -sL https://unpkg.com/<pkg>@<ver>/<dist file>` piped through `gzip -9 | wc -c`.
2. **Binding maturity** — `curl -s https://registry.npmjs.org/<pkg>`, reading `dist-tags`, `time`,
   `license`, `peerDependencies`.
3. **Extract sizes** — `curl -sIL <geofabrik url>`, reading `Content-Length`.
4. **Style analysis** — fetch `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`, then
   walk `layers[]` filtering on `source-layer`, `filter`, `layout.text-field` and `paint`.
5. **Tile analysis** — compute the z14 tile index for 35.6812 N / 139.7671 E
   (`z14/14552/6451`), `GET https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/14/14552/6451.mvt`,
   gunzip, and walk the MVT protobuf wire format: field 3 = layer (name=1, feature=2, key=3, value=4),
   feature field 2 = packed tag index pairs into the layer's key/value tables.

Working files were kept in the session scratchpad and are not committed.
