# Research: what the rail ingest pipeline actually retains, and what tracing `way` geometry would cost

**Date:** 2026-08-19
**Feeds:** [#142 — Ingest real rail-segment geometry for map rendering](https://github.com/Tyler-Reagan/trip-kraken/issues/142) (part of [#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181))
**Status:** Facts only. This document deliberately makes **no recommendation** — no storage format, no
schema, no verdict on retuning `LINE_TYPE_SPEEDS_KMH`. That is the `/grilling` session's job. Where a
fact forecloses an option, it says so and stops.
**Code read at:** `main` @ `939b8ad`. Nothing under `scripts/`, `src/`, or `db/` was modified.

## How these findings were produced

Two evidence classes, kept distinct throughout, and every claim below is tagged:

- **[demonstrated]** — I ran it, and the command and its real output are reproduced here.
- **[documented]** — I read it in a primary source (osmium man page, OSM wiki, MapLibre style spec,
  a peer-reviewed paper). Cited by URL to the specific page.
- **[uncertain]** — I could not tie it to either.

**Measurement corpus.** Three pinned Geofabrik Extracts at the **same OSM snapshot the pipeline
pins**, `260101` (`scripts/osm-snapshot.env`):

| Extract | Size | Why |
| --- | --- | --- |
| `asia/japan/shikoku-260101` | 86 MB | Small, real Japanese rail (JR Shikoku, Iyotetsu), rural + mountainous — the winding end of the distribution |
| `asia/japan/kansai-260101` | 337 MB | Dense urban PTv2: Osaka Metro, Hankyu, Kintetsu, Nankai, monorail, Shinkansen trunk — the tight-curve end |
| `asia/japan-260101` | 2.34 GB | The real pipeline input, so the headline numbers are not extrapolations |

All work was done in a scratch directory. `db/transit-japan.db` was not opened, and no script under
`scripts/` was run or edited.

**A side finding worth ten seconds of the grilling's time:** the `260101` files are *still* live on
Geofabrik as of 2026-08-19, seven and a half months after the pin
([demonstrated] — `curl -sIL .../asia/japan-260101.osm.pbf` → `HTTP/1.1 200`, `Content-Length:
2342296009`). Geofabrik's dated files are not permanent, so the pin's reproducibility has a shelf
life, but it has not expired yet.

---

## A. What the current filter step actually retains

### A1–A3. Rail `way` geometry is **already in the filtered file today**. The pipeline discards it in Node, not in `osmium`.

**This is the headline finding, and it inverts the ticket's framing.** #142 asks "does `osmium`'s
filtering step already retain `way` geometry for rail relations, or does the extract/filter step need
to change?" The answer is the first: it retains it, in full, including the untagged nodes that give
those ways their shape. `scripts/ingest-transit-graph.sh` needs no change at all for the data to be
present.

**[documented]** The osmium-tool manual for `tags-filter` states the default plainly
([osmium-tags-filter(1)](https://docs.osmcode.org/osmium/latest/osmium-tags-filter.html)):

> "All objects matching the expressions will be read from OSM-FILE and written to the output. All
> objects referenced from those objects will also be added to the output unless the option
> `--omit-referenced/-R` is used. **This applies to nodes referenced in ways and members referenced
> in relations.**"

and, on the mechanism that makes the completion transitive:

> "If the option `--omit-referenced/-R` is used, the input file is read only once, otherwise the
> input file will possibly be **read up to three times**."

Three passes is exactly what two-level completion requires: pass 1 finds the matching relations, pass
2 collects their member ways and member relations, pass 3 collects the nodes those ways reference.
The flags that change this behaviour are `-R/--omit-referenced` (drop referenced objects entirely),
`-i/--invert-match` (invert the match, unrelated to completion), and `-t/--remove-tags` (keep the
referenced objects but strip their tags). None of the three is used by
`scripts/ingest-transit-graph.sh`.

**[demonstrated]** Running the pipeline's exact filter expression on the Shikoku extract:

```
$ osmium tags-filter shikoku-260101.osm.pbf \
    r/route=train,subway,light_rail,monorail \
    r/public_transport=stop_area,stop_area_group \
    -o rail.osm.pbf
$ osmium fileinfo -e rail.osm.pbf
  Size: 324866
  Number of nodes: 21020
  Number of ways: 3117
  Number of relations: 361
```

and the same command with `-R`:

```
$ osmium tags-filter -R shikoku-260101.osm.pbf <same expressions> -o rail-omitref.osm.pbf
  Size: 35003
  Number of nodes: 0
  Number of ways: 0
  Number of relations: 354
```

Zero nodes, zero ways with `-R`; 21,020 nodes and 3,117 ways without. (The relation count also moves,
354 → 361: seven `stop_area` relations enter only as members of a `stop_area_group`.)

**[demonstrated] The completion is transitive two levels down.** Every `<nd ref>` in the filtered
file resolves to a `<node>` in the same file — no way is present without its geometry. On the
**full-Japan Extract the pipeline actually uses**, the closure is total, in every direction:

```
nodes 630298   ways 90632   untagged nodes 527576
distinct nd refs 605089            MISSING: 0
distinct relation way-members 90632   missing: 0
distinct relation node-members 38789  missing: 0
ways not referenced by any relation: 0
```

Zero dangling references of any kind. 527,576 of the 630,298 nodes are untagged (self-closing
`<node .../>` elements) — pure geometry vertices, present solely because a member way references
them. (Shikoku shows the same shape at small scale: 21,020 nodes, 3,117 ways, 20,394 distinct `nd`
refs, zero missing.)

**[demonstrated] The Node side already parses all of them and throws them away.**
`src/lib/parsers/osmXml.ts` maps *every* `<node>` element into `OsmNode[]`, tagged or not; it is
`<way>` elements alone that it declines to parse. So the coordinates a traced geometry needs are
already being read into memory on every ingest run today, and already being handed to
`buildTransitGraph`. The gap between here and "we have per-segment shapes" is `<way>` parsing plus
assembly, not a data-acquisition problem.

### What that constrains, and what it leaves open

- **Forecloses:** any option premised on the `.sh` filter step needing to change to *keep* geometry.
  It is already kept.
- **Leaves open:** whether to *narrow* what is kept. `-t/--remove-tags` would strip tags from the
  referenced-only objects, and `-R` remains available if a future design decides it wants the
  relation skeleton alone. Both are reductions from today, not additions.
- **Open question the ticket doesn't name:** the current all-Japan XML is **212 MB, ~91% of it
  geometry** (§B5), read into a single JS string by `fs.readFileSync(inputPath, "utf-8")` and parsed
  in full by `fast-xml-parser` (`scripts/ingest-transit-graph.ts`). That already works today, so it
  is not a new risk — but `<way>` parsing would add 90,632 more retained objects with 605,089 `nd`
  refs between them, from the same parse. Whether the ingest run's memory profile matters is a
  question for the grilling, not a fact I measured.

---

## B. Getting the geometry out in a usable form

### B4. Three routes exist. Only one keeps the Node-side transform pure *and* keeps relation membership.

In OSM XML, a `<way>` carries `<nd ref="…"/>` node references with no inline coordinates
**[demonstrated]** — confirmed by inspecting `rail.osm` directly. The options for resolving them:

**Option 1 — resolve the refs in Node, from nodes already in the same file.**
`parsers/osmXml.ts` gains a `ways: OsmWay[]` return alongside `nodes`/`relations`, each way carrying
its ordered `nodeRefs`. The transform joins them against the `nodesById` map
`buildTransitGraph` already builds (`transitGraphIngest.ts` line 240). **No pipeline change, no new
osmium invocation, transform stays pure** — it is still "parsed OSM elements in, `TransitGraph` out."
This is available today because of the A1–A3 finding, and it is the only option that preserves both
the node→way→relation linkage and the existing seam.

**Option 2 — `osmium add-locations-to-ways`, inlining coordinates onto the `<nd>` elements.**
**[documented]** ([osmium-add-locations-to-ways(1)](https://docs.osmcode.org/osmium/latest/osmium-add-locations-to-ways.html)):

> "This program will copy the input file(s) to the output, taking the locations from the nodes and
> adding them to the ways. This makes it easier for other programs to assemble the way geometries."

> "**Nodes without any tags will not be copied** (unless the `--keep-untagged-nodes/-n` option is
> used)."

> "Note that the OSM files generated by this command use a **format extension**. Most programs
> reading OSM files will not understand this extension and should ignore the extra data."

**[demonstrated]** The extension is a `lat`/`lon` pair on each `<nd>`:

```xml
<way id="24410472" version="10" timestamp="2021-12-07T13:22:08Z">
  <nd ref="8284229879" lat="33.600219" lon="132.6768832"/>
  <nd ref="265013742" lat="33.6004486" lon="132.6770746"/>
  ...
```

`fast-xml-parser` would read those attributes without complaint, so this *is* viable. **Two
demonstrated traps** if it is chosen:

1. Without `-n`, node count on the Shikoku file drops 21,020 → 4,285, and the number of relation
   `node` members that no longer resolve rises from 8 to 10 — i.e. **two node members of rail
   relations were untagged and got silently deleted**. `transitGraphIngest.buildLines` skips
   unresolvable stop members (`if (!osmNode) continue`), so a loss of that shape would quietly shrink
   the Rail graph rather than error. With `-n` the file gets larger than the input, per the man page.
2. It adds a second osmium invocation, its own index-type/memory decision
   ([osmium-index-types(5)](https://docs.osmcode.org/osmium/latest/osmium-index-types.html)), and a
   non-standard file the rest of the toolchain does not understand — for a resolution step Option 1
   does in a `Map.get`.

**Option 3 — `osmium export` to GeoJSON / GeoJSONSeq. Rejected by the tool's own documentation and
confirmed by measurement.**
**[documented]** ([osmium-export(1)](https://docs.osmcode.org/osmium/latest/osmium-export.html)):

> "Nodes will be translated into points and ways into linestrings or polygons (if they are closed
> ways). Multipolygon and boundary relations will be translated into multipolygons. This
> transformation is not loss-less, **especially information in non-multipolygon, non-boundary
> relations is lost**."

A PTv2 `route` relation is exactly a non-multipolygon, non-boundary relation.

**[demonstrated]** on the Shikoku file:

```
$ osmium export rail.osm.pbf -f geojsonseq --geometry-types=linestring -u type_id -o rail-lines-id.geojsonseq
$ wc -l < rail-lines-id.geojsonseq            # 2886 features (from 3117 ways)
$ grep -c '"id":"r' rail-lines-id.geojsonseq  # 0   ← no relations at all
$ grep -c '"route":"train"' rail-lines.geojsonseq  # 0
```

You get 2,886 anonymous track linestrings and **no record of which route relation any of them belongs
to** — which is the one thing a per-ride-edge geometry needs. (Also: `-n/--keep-untagged` is required
or untagged ways vanish; with it the count rises to 2,899.) `osmium export` would only be usable
alongside a *separate* pass that reads the relations, at which point Option 1 is strictly simpler.

**[documented] The one standard tool that does assemble route relations is GDAL's OSM driver**, whose
`multilinestrings` layer is built from `"relation" features that form a multilinestring (type =
'multilinestring' or type = 'route')`
([GDAL OSM driver](https://gdal.org/en/stable/drivers/vector/osm.html)). **[uncertain]** whether it
orders or gap-checks the member ways — the driver docs do not say, and I did not test it. It would
also introduce a GDAL dependency into a pipeline that currently needs only `osmium` and `npx tsx`.

### B5. Size and element-count cost

**[demonstrated]**, the full-Japan Extract, same filter, two renderings of the same filtered data:

| File | Bytes | Note |
| --- | --- | --- |
| `japan-rail.osm.pbf` (as the pipeline produces it) | 10,413,741 | |
| `japan-rail.osm` (OSM XML, what the Node step reads) | **211,778,641** | **what is read today** |
| `japan-rail-R.osm` (`-R`, relations only) | 19,634,767 | the same file with all geometry stripped |

So **~91% of the 212 MB of XML the ingest already reads is way geometry** — a cost being paid today
and thrown away. Shikoku shows the identical proportion at small scale (6,485,396 B vs 610,536 B),
as does `add-locations-to-ways` output there (5,544,758 B without `-n`).

The filter step itself is not the bottleneck at any of these sizes: `osmium tags-filter` over the
2.34 GB national Extract took **9.3 s wall** (64.9 s user, 736% CPU) on this machine, and
`osmium cat -f osm` a further 0.35 s. The 5m27s download dominates the pipeline.

---

## C. PTv2 route-relation geometry

### C6. Member ordering and roles — the convention, and what the data does

**[documented]** The scheme is specified across three wiki pages, and the sharpest statement of the
ordering rule is on the OSM Inspector validation page
([OSM Inspector/Views/Public Transport – Routes](https://wiki.openstreetmap.org/wiki/OSM_Inspector/Views/Public_Transport_-_Routes)):

> "A route must begin with an ordered list of stops and platforms. The order of stops and platforms
> is not checked but there must be **no highway/railway member before any stop/platform** in the
> list and **no stop/platform after a highway/railway member**."

> "Nodes must have only one of the following roles: `stop`, `stop_entry_only`, `stop_exit_only`,
> `platform`, `platform_entry_only`, `platform_exit_only`."

> "The highway/railway members of PTv2 routes **must be ordered**. The code which does the check does
> not differ between gaps and wrongly ordered members. If a route is ordered randomly, the code will
> report lots of 'gaps'."

[Relation:route](https://wiki.openstreetmap.org/wiki/Relation:route) adds that for PTv2 way members
"the **empty role** should be used", and that `forward`/`backward` "should not be used on public
transport version 2 routes". [Public transport](https://wiki.openstreetmap.org/wiki/Public_transport)
adds that each direction of a route is its own relation and no forks are permitted.

**Ordered and contiguous is a *convention with a validator*, not a guarantee.** The wiki says ways
"must be ordered"; OSM Inspector exists precisely because they often are not.

**[demonstrated]** the convention holds in the real Japanese data. A representative Shikoku relation
(`うずしお Uzushio 宇多津⇒高松`, 63 members):

```
first 12 members:
  ('node','1977452937','stop') ('relation','2545175','platform') ('node','1977451970','stop')
  ('way','102203426','platform') ('way','186988354','') ('way','186988397','') ...
role histogram: {('way',''): 59, ('node','stop'): 2, ('relation','platform'): 1, ('way','platform'): 1}
```

Stop/platform members first, then 59 unroled way members. Note the `way`-typed *platform* member —
platforms are not always nodes, so a way-member filter must exclude non-empty roles, not just take
every `way`.

**[demonstrated]** across all 1,487 rail route relations in the national Extract, the `stop*` role
values actually present are: `stop` × 21,660, `stop_entry_only` × 19, `stop_exit_only` × 19, and
`stop_position` × 2 (the last is non-standard — a mapper putting the tag value in the role slot).
`transitGraphIngest.ts`'s `m.role.startsWith("stop")` predicate therefore catches 40 members that an
exact `=== "stop"` would miss, and does so by accident rather than design.

### C7. Cutting a route's way-chain into per-ride-edge segments

**The mechanism the ticket asks about works, and the wiki's premise is confirmed.**
**[documented]** ([Tag:public_transport=stop_position](https://wiki.openstreetmap.org/wiki/Tag:public_transport%3Dstop_position)):
a `stop_position` is created by "a node **on** the highway, railway or other public transport route",
whereas `public_transport=platform` identifies "the place where passengers wait". So the `stop`-role
node is a vertex of the member way chain, and the `platform`-role member is not — which is what makes
"find the stop node's index in the assembled chain, slice between consecutive indices" a valid cut.

**[demonstrated] how often that premise actually holds**, measured directly (is each `stop`-role
node a member of *any* unroled way member of its own relation?):

| Extract | `stop*`-role members resolvable | Not a vertex of any member way |
| --- | --- | --- |
| **all Japan** | **21,700** | **741 (3.4%)** |
| Kansai | 5,234 | 149 (2.8%) |
| Shikoku | 625 | 1 (0.2%) |

The 741 national exceptions break down as **418 `public_transport=station`+`railway=station`** (the
old-style station node, genuinely off the tracks — the single largest class), 236
`public_transport=stop_position`+`railway=stop` (on rails, but on a way the relation does not list —
typically a terminus platform track), 58 `railway=station` with no `public_transport` tag, 20
untagged, 7 `stop_position` with no `railway`, and 1 mixed.

**[demonstrated] end-to-end coverage.** I wrote a deliberately naive assembler — greedy end-to-end
chaining of the unroled way members, reversing a way when its far end matches, and concatenating
across a break when neither end matches — then cut it at consecutive `stop*`-role node indices,
mirroring `buildLines`' stop selection. Per **ride edge** (the unit `RideEdge` is):

| Extract | ride edges | geometry traced | coverage |
| --- | --- | --- | --- |
| **all Japan** | **20,281** | **19,385** | **95.6%** |
| Kansai | 4,828 | 4,676 | 96.9% |
| Shikoku | 583 | 582 | 99.8% |

**The national ride-edge count is 20,281 — exactly the figure ADR-0019's J5 eval records for the
shipped `db/transit-japan.db`.** That is not a coincidence to shrug at: it means this replica of
`buildLines`' stop selection is faithful, so the coverage percentage is a statement about the graph
the app actually ships, not about a lookalike. **A naive assembler gets ~96% of the shipped Rail
graph's ride edges a real shape.**

**[demonstrated] the failure modes, and their real rates.** Because the assembler concatenates across
gaps rather than erroring, some of that 96% is garbage — so I measured the largest jump between
consecutive vertices inside each traced segment. Real rail ways have closely spaced vertices (national
median of the per-segment max jump: 254 m); a multi-kilometre jump is an assembly artefact, not track:

| max inter-vertex jump | **all Japan** | Kansai | Shikoku |
| --- | --- | --- | --- |
| < 500 m (clean) | **82.2%** | 90.1% | 84.2% |
| 500 m – 2 km (ambiguous — sparse straight track, or a small gap) | 14.7% | 8.4% | 12.4% |
| 2 – 10 km (suspicious) | 2.3% | 1.1% | 2.7% |
| > 10 km (certainly bogus) | **0.9%** | 0.4% | 0.7% |

Combined with the 4.4% that get no shape at all: **~82% of ride edges get a clean traced shape, ~15%
get one that needs a judgement call, ~3% get one that is certainly wrong, and ~4% get none.**

**The single most instructive failure is the one the ticket does not anticipate: closed-loop routes.**
Twelve national rail route relations assemble into a chain whose first and last node are the same, and
naive index-based cutting then traces *the long way round the loop* for the hop that closes it. The
worst offenders are, in order, **JR山手線 (Yamanote Line) — 33.71 km of traced track for a 0.77 km
hop, 43.5×**, 名古屋市営名城線 (Nagoya Meijō Line) at 25.1×, and JR大阪環状線 (Osaka Loop Line) at
16.2×. Tokyo's most-ridden line is in that list. Any assembler has to handle loops explicitly.

Other per-relation failure modes, at Kansai's rates over 442 rail route relations: 62 (14%) whose
unroled ways do not assemble into one contiguous chain under greedy matching; 5 (1%) where stop order
disagrees with chain order; 6 with no unroled way members at all; 37 with fewer than two stop members.
Ways shared by multiple routes are ubiquitous and are *not* a failure mode here — the cut is per
relation, so a shared way is simply traced once per route that lists it.

**A sub-region artefact, called out so it is not misread as a data-quality fact:** 31.8% of Kansai's
way-member slots reference a way absent from that Extract, because Kansai's relations include
Shinkansen and limited-express routes that leave the region (Shikoku: 9.3%). **On the national Extract
that rate is 0.0% — 0 of 221,874 slots.** Incomplete relations are an artefact of cutting Japan into
pieces, not a property of the data the pipeline reads.

**[demonstrated] size of the resulting geometry**, as minified GeoJSON `LineString`s at 6 decimal
places, one per ride edge:

| | **all Japan** | Kansai | Shikoku |
| --- | --- | --- | --- |
| vertices/edge, median | **36** | 35 | 54 |
| vertices/edge, p90 / p99 / max | 123 / 653 / 6,999 | 109 / 415 / 2,607 | 167 / 789 / 1,374 |
| mean bytes/edge | 1,684 B | 1,334 B | 2,221 B |
| total | **31.13 MiB** (19,385 edges) | 5.95 MiB | 1.23 MiB |

**31 MiB of raw GeoJSON against a `db/transit-japan.db` that is 9 MB today** — i.e. naive per-edge
GeoJSON text is roughly 3.5× the entire current graph file. That is a ceiling, not a forecast: it is
uncompressed JSON at full precision, and SQLite would store it as text unless something denser is
chosen. But it is the number the storage-format question in #142 has to start from.

Note this figure **already includes the up/down duplication**: PTv2 gives each direction its own
relation, and `stopNodeId()` scopes stop node ids by relation id, so the same physical track becomes
two `RideEdge` rows with two near-identical (reversed) shapes. Nothing in the current model
deduplicates them.

### C8. Route-relation assembly is ours to write

**[documented]** No osmium subcommand assembles a route relation's ways into an ordered linestring.
`osmium export`'s own docs say non-multipolygon relation information is lost (B4, quoted above), and
there is no other candidate in the command list. GDAL's OSM driver `multilinestrings` layer is the
one standard tool that produces a geometry *from* a route relation
([GDAL OSM driver](https://gdal.org/en/stable/drivers/vector/osm.html)); **[uncertain]** whether it
orders the members or reports gaps, and it does not solve the per-stop cutting problem regardless.
JOSM's PT_Assistant plugin and OSM Inspector validate ordering but are interactive/reporting tools,
not pipeline steps.

**So: assembly, gap detection, loop handling, direction resolution, and per-stop cutting are ours.**
The measured rates above say what that code is up against — not "handle a rare edge case" but "~18% of
segments need a decision about a discontinuity, and twelve relations including the Yamanote Line need
a loop-aware cut", with the great majority of the discontinuities sub-kilometre and benign.

---

## D. The duration-model side effect

### D9. The published circuity literature answers a **different question** than the one #142 asks. The measured answer is ~7.7%.

**This is the finding most likely to mislead the grilling if taken at face value, so the distinction
comes first.**

**[documented]** Circuity (a.k.a. detour index, route factor) is defined as "the ratio of network to
Euclidean distance"
([Transportation Geography and Network Science/Circuity](https://en.wikibooks.org/wiki/Transportation_Geography_and_Network_Science/Circuity)),
and every published rail figure I found measures it **between origin–destination station pairs across
the whole network** — i.e. it bundles routing indirectness, intermediate stops, and transfers together
with track curvature. The best-documented rail-specific numbers, from a peer-reviewed open-access
study of China's HSR network
([Circuity analyses of HSR network and high-speed train paths in China, PLOS ONE 10.1371/journal.pone.0176005](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0176005)):

| Measure | min | mean | max |
| --- | --- | --- | --- |
| Within-line trains (O–D over one line) | 1.08 | **1.16** | 1.29 |
| Cross-line train paths (O–D with routing) | 1.03 | **1.37** | 2.48 |

For context, the same literature reports ~1.2 for urban O–D travel (Newell 1980) and 1.21–1.23 at
transit station catchments (O'Sullivan 1996), both via the Wikibooks page above.

**None of those numbers is the quantity `RideEdge.distanceMeters` holds.** That field is the
haversine between **two adjacent stations**, and a `Journey`'s indirectness is already produced by
Dijkstra summing many such hops — swapping in track length changes only the *chord-to-arc* ratio of
each individual hop, not the network-level circuity, which the graph already models correctly. Handing
the grilling "rail circuity is 1.16–1.37, so durations would move 16–37%" would be wrong by a factor
of four or five.

**[demonstrated] the quantity that actually matters.** Traced track length ÷ haversine, per ride edge,
over the national Extract, restricted to segments whose max inter-vertex jump is under 500 m so that
assembly artefacts are not being measured as track:

| | **all Japan (15,925 edges)** | Kansai (3,588) | Shikoku (364) |
| --- | --- | --- | --- |
| **aggregate (Σ traced ÷ Σ straight)** | **1.0807** | 1.0746 | 1.0770 |
| aggregate, excluding ratio > 2.0× | **1.0768** | — | — |
| aggregate, excluding ratio > 1.5× | 1.0712 | — | — |
| median | 1.0249 | 1.0226 | 1.0359 |
| mean | 1.0680 | 1.0563 | 1.0609 |
| p10 / p25 | 1.0004 / 1.0052 | 1.0003 / 1.0040 | 1.0007 / 1.0085 |
| p75 / p90 | 1.0738 / 1.1587 | 1.0670 / 1.1556 | 1.0819 / 1.1719 |
| p99 | 1.4724 | 1.4412 | 1.3407 |
| edges > 1.5× / > 2.0× | 135 / 30 | 19 / 2 | 0 / 0 |
| edges < 1.0× | 0 | 0 | 0 |

(National aggregate: 42,753 km traced vs 39,559 km straight.)

**The number is ~1.075–1.08, and it is remarkably stable.** A rural mountainous network (Shikoku,
1.077), a dense urban one (Kansai, 1.075), and the whole country trimmed of loop artefacts (1.077)
agree to within 0.3 percentage points. The 30 national outliers above 2.0× are almost entirely the
closed-loop assembly artefact described in §C7, not real track; the genuine high-ratio segments are
what intuition predicts — 南海電気鉄道高野線 (Nankai Koya Line, mountain section) at 2.06×,
大阪モノレール本線 (Osaka Monorail, elevated curves) at 1.85×, 特急はるか (the Kyoto–Kansai-Airport
express, which does not run direct) at 1.68×.

**What that constrains:** if `distanceMeters` is recomputed from traced track length and
`LINE_TYPE_SPEEDS_KMH` is left alone, **every rail duration in the app increases by ~7.7% on
aggregate**, with the median hop up ~2.5% and a p90 hop up ~16%. That is not a rounding error and it
is not a catastrophe — it is a systematic bias of known size with an obvious compensating knob (a
~7.5% uplift across the speed table holds aggregate durations constant), and it is smaller than the
per-hop variance the coarse model already tolerates.

**Two things the grilling should weigh alongside it, neither of which this document decides:**

1. ADR-0019's own J5 eval already found Tokyo→Ikebukuro estimated at 17 min against a real ~24–27 min
   — i.e. *too fast*. A ~7.7% distance increase moves that in the correct direction, not the wrong
   one.
2. The same eval found `lineTypeOf()` never classifies `shinkansen` or `limitedExpress` — **zero** of
   1,419 lines — so 1,278 lines including every Shinkansen run at the 45 km/h `commuter` speed today.
   Any recalibration done before that classifier bug is fixed is calibrating against a known-broken
   model.

**Reported honestly:** I found **no** published figure for adjacent-station rail track length vs
straight-line distance. The ~1.077 above is my own measurement over 15,925 real Japanese ride edges
(and 3,952 more in the two sub-regions), not a citation; treat it as such.

---

## E. Rendering format

### E. Nothing new. One documented default worth knowing about.

**[documented]** MapLibre's GeoJSON source spec
([MapLibre Style Spec — Sources](https://maplibre.org/maplibre-style-spec/sources/)) documents no
limit on feature counts or coordinates per feature. `MapView.tsx` already pushes `path.geometry`
straight into a `FeatureCollection<LineString>` (line 250), and ADR-0029 §3's presence-of-`geometry`
test already accommodates a rail Path that gains a shape.

The one property worth naming, because it is a **default that silently alters our geometry**:
`tolerance`, "Douglas-Peucker simplification tolerance (higher means simpler geometries and faster
performance)", **default 0.375**. MapLibre tiles a GeoJSON source and simplifies it per zoom level, so
a 400-vertex rail segment is not drawn vertex-for-vertex at low zoom regardless of what we store. Two
consequences: the p99 vertex counts in §C7 are not a rendering-performance concern, and any future
idea of pre-simplifying geometry at ingest time is partly redundant with what the renderer already
does.

At the national median of 36 vertices per ride edge, a whole rail Journey of a dozen hops is a few
hundred coordinates — exactly the "few hundred coordinates" the ticket asks about, and unremarkable.
The p99 (653) and the single worst edge (6,999 vertices, an artefact of the loop problem in §C7) are
the only figures that would even reach the simplifier's notice.

**Minor drift worth a footnote:** ADR-0029 §Consequences pins MapLibre at 5.21.1; `package.json` now
declares `^5.24.0` and 5.24.0 is installed (commits `681192e`/`416a711`). The `line-dasharray`
data-driven property the ADR depends on is unaffected.

---

## F. The all-Japan run, in one table

Every figure below is **[demonstrated]** on `asia/japan-260101.osm.pbf`, the exact Extract
`scripts/ingest-transit-graph.sh` downloads, put through the exact filter expression the script runs.

| | |
| --- | --- |
| Raw Extract | 2,342,296,009 B (2.34 GB), 5m27s to download |
| `osmium tags-filter` | **9.3 s wall** (64.9 s user, 736% CPU) |
| Filtered `.osm.pbf` | 10,413,741 B |
| Filtered OSM XML (`osmium cat -f osm`) | **211,778,641 B** — what the Node step reads today |
| Same with `-R` (no geometry) | 19,634,767 B — so geometry is **90.7%** of it |
| Elements retained | 630,298 nodes (**527,576 untagged**), 90,632 ways, 11,313 relations |
| Dangling references | **0** — `nd` refs, relation way-members, relation node-members, all resolve |
| Rail `route` relations | 1,487 |
| `stop*`-role node members | 21,700 (`stop` 21,660 / `stop_entry_only` 19 / `stop_exit_only` 19 / `stop_position` 2) |
| …not a vertex of any member way | 741 (3.4%) |
| **Ride edges** | **20,281** — identical to ADR-0019's J5 figure for the shipped graph |
| …with a traced geometry (naive assembler) | 19,385 (**95.6%**) |
| …of those, clean (max jump < 500 m) | 15,934 (82.2% of all traced) |
| …certainly bogus (max jump > 10 km) | 168 (0.9%) |
| Relations assembling into a closed loop | 12 (incl. 山手線, 大阪環状線, 名城線) |
| Vertices per traced edge | median 36, p90 123, p99 653, max 6,999, mean 72.3 |
| Naive GeoJSON payload, all traced edges | **31.13 MiB** (mean 1,684 B/edge) |
| Traced ÷ straight, aggregate over clean edges | **1.0807** (1.0768 excluding > 2.0× outliers) |

For comparison, `db/transit-japan.db` as shipped is **9,048,064 B**.

---

## Open questions #142's current text does not name

1. **Where a traversed ride edge's identity goes.** #142 asks how a routed Path's ride edges get
   reconstructed into a polyline. The blocker is more specific than the ticket implies: `Step`
   (`osmTransitProvider.ts` line 79) is `RideStep = { kind: "ride", lineName }` — **it carries no edge
   identity at all**, and `Adjacency.ride`'s entries are `{ toStopId, distanceMeters, lineName }`
   with no `fromStopId`. The search records *which line you rode*, never *which edge you crossed*. Any
   query-time reconstruction requires widening one or both of those, which is a change inside the
   Dijkstra hot path that `costMatrix` also runs N² times.

2. **Ride edges are traversed in both directions.** `buildAdjacency` inserts every `RideEdge` twice,
   `from→to` and `to→from`. A stored per-edge `LineString` therefore has to be **reversed** when the
   search crossed it backwards, or the assembled Journey polyline will zig-zag. Not mentioned in
   #142.

3. **Up and down directions are already duplicated.** PTv2 mandates one relation per direction, and
   `stopNodeId()` scopes stop nodes by relation id, so the same physical track already produces two
   `RideEdge` rows. Storing geometry per ride edge therefore stores every metre of Japanese track at
   least twice — more where several services share track. Whether that duplication is acceptable, or
   whether geometry should be keyed by something coarser (way chain, physical segment) with ride edges
   referencing into it, is a modelling question #142's "new column vs separate store" framing does not
   surface.

4. **What a ride edge with *wrong* geometry should do.** 4.4% of ride edges get no shape at all —
   ADR-0029 §3 already has an honest answer for that (dashed). But another ~3% get a shape containing
   a multi-kilometre jump the assembler invented, and ADR-0029 has **no** answer for *present but
   wrong*: §3's test is presence of `geometry`, so a bogus shape draws solid and reads as routed
   truth. Whether to gap-check at ingest and refuse the segment, or store it and let the map draw a
   train through the sea, is a decision the ticket does not pose — and ADR-0017/0028's
   degrade-visibly posture points hard at the first.

5. **Loop lines break naive cutting, and the Yamanote Line is one.** Twelve national relations
   assemble into a closed chain, and index-based cutting then traces the long way round for the
   closing hop (山手線: 33.7 km for a 0.77 km segment). This is not a tail case to defer — it is
   Tokyo's core loop, the Osaka loop, and a Nagoya subway loop, i.e. three of the lines a Japan
   itinerary is most likely to actually ride.

6. **31 MiB of naive per-edge GeoJSON against a 9 MB graph file.** §C7's payload measurement makes the
   storage-format question quantitative in a way #142's "new column vs separate store" framing does
   not: at full precision and full duplication, geometry is ~3.5× the size of everything else in
   `db/transit-japan.db` combined. Coordinate precision, encoding, and the up/down deduplication in
   (3) are each worth several MB.

7. **Whether the Extract-identity problem from ADR-0029 §6 applies here.** ADR-0029 rejected
   persisting OSRM geometry partly because a `straightLine` verdict outlives the Extract that produced
   it. Rail geometry lives in `db/transit-japan.db`, which *is* regenerated with the extract — so the
   identity is implicit in the file. But #181's note says any future geometry cache "needs an Extract
   identity in its key", and `transitGraphStore.ts`'s schema records **no snapshot date, no region, no
   provenance of any kind** today. If rail geometry is stored there, the file becomes the first
   artefact where knowing which snapshot produced it matters.

8. **The classifier bug is upstream of any speed retune.** See §D9 note 2. #142's fourth bullet asks
   whether `LINE_TYPE_SPEEDS_KMH` needs retuning; the honest answer depends on a separate fix that has
   not landed, and retuning against a model where every Shinkansen runs at 45 km/h would bake the bug
   into the constants.

## What I could not establish

- **[uncertain] A published PTv2 completeness or ordering-quality measure for Japan specifically.**
  I found none. [OSM Inspector's Public Transport – Routes view](https://wiki.openstreetmap.org/wiki/OSM_Inspector/Views/Public_Transport_-_Routes)
  is worldwide and reports per-route gap/order errors, and
  [osmtrainroutes.bplaced.net](http://osmtrainroutes.bplaced.net) analyses individual train routes —
  but neither publishes an aggregate Japan figure. **The §C7/§F tables are the substitute:** a direct
  measurement over all 1,487 Japanese rail route relations and all 20,281 shipped ride edges. They are
  my measurement, not a citation, and the scripts that produced them were scratch code, not committed.
- **[uncertain] Whether GDAL's OSM driver orders and gap-checks `multilinestrings` members.** The
  driver docs do not say and I did not test it.
- **[uncertain] Ingest wall-clock and peak memory with `<way>` parsing added.** Not measured — that
  needs the change written, which is out of scope here. The inputs to the estimate (element counts,
  XML size) are in §B5 and §F.
