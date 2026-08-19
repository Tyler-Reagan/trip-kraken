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

---

# G. Follow-up measurement pass — storage-model sizes (2026-08-19)

**Added 2026-08-19, after the sections above.** Nothing above this line was changed.

This pass exists because §C7/§F left the storage-format question quantitative but one-sided: it
measured only the naive option. This section measures the alternatives, so the `/grilling` session
ranks them off real bytes rather than intuition. **Same rule as the rest of the document: measurement
only, no recommendation.** Where a number forecloses an option it says so and stops.

All work was again done in a scratch directory. `db/transit-japan.db` was **copied** to scratch and
the copy was modified; the file in the repo was not opened for writing, and nothing under `scripts/`
or `src/` was touched.

### Baseline reproduced first

**[demonstrated]** The §C7 assembler was re-implemented from the same description (greedy end-to-end
chaining of unroled `way` members, cut at consecutive `stop*`-role node indices) and re-run against
the same pinned `asia/japan-260101` filtered XML:

```
$ python3 dump.py japan-rail.osm japan.pkl
rail route relations              : 1487
relations with an assembled chain : 1471
ride edges                        : 20281
traced ride edges                 : 19385
naive per-edge GeoJSON 6dp        : 32638021 B = 31.13 MiB
```

**20,281 ride edges / 19,385 traced / 31.13 MiB — identical to §C7 and §F.** The 1,487 rail route
relation count matches too, and the shipped `db/transit-japan.db` independently confirms the edge
count (`sqlite3 base.db "select count(*) from RideEdge"` → `20281`). Every figure in this section is
measured against that reproduced corpus: **19,385 traced edges, 1,401,300 vertices**.

The ride edges join the shipped table exactly, because `stopNodeId()` produces `{relationId}:{osmNodeId}`
(`223040:2559434104`) — so each measured edge maps to a real `RideEdge` row, and every candidate
database below reports `19385` rows carrying geometry against `20281` total.

---

### G10. The comparison table

**[demonstrated]** Every row is a real SQLite file built in scratch from a copy of the shipped
9,048,064 B graph, populated, `VACUUM`ed, and `stat`ed. **These are whole-database sizes** — graph
content plus geometry — not payload sums.

| # | Representation | On-disk DB | Δ vs graph-only | Payload |
| --- | --- | --- | --- | --- |
| 00 | *graph only, no geometry (control)* | **8,998,912 B** (8.58 MiB) | — | — |
| 10 | shared `Geometry` table, **corridor-dedup** (lossy, ≤100 m), varint-5dp BLOB | **11,186,176 B** (10.67 MiB) | +2,187,264 | 1,833,950 |
| 12 | shared `Geometry` table, **lossless dedup**, varint-5dp BLOB | **12,083,200 B** (11.52 MiB) | +3,084,288 | 2,621,562 |
| 06 | `RideEdge.geometry` BLOB, varint-delta 4dp | **12,210,176 B** (11.64 MiB) | +3,211,264 | 2,907,731 |
| 07 | `RideEdge.geometry` BLOB, varint-5dp + per-row deflate | **12,681,216 B** (12.09 MiB) | +3,682,304 | 3,322,903 |
| 05 | `RideEdge.geometry` BLOB, varint-delta 5dp | **12,783,616 B** (12.19 MiB) | +3,784,704 | 3,411,000 |
| 11 | `RouteChain` per relation + start/end offsets, varint-5dp | **12,955,648 B** (12.36 MiB) | +3,956,736 | 3,003,051 |
| 03 | `RideEdge.geometry` TEXT, encoded polyline-5 | **14,364,672 B** (13.70 MiB) | +5,365,760 | 4,782,602 |
| 09 | **separate table** + unique index, varint-5dp BLOB | **14,569,472 B** (13.89 MiB) | +5,570,560 | 3,411,000 |
| 04 | `RideEdge.geometry` BLOB, varint-delta 6dp | **14,950,400 B** (14.26 MiB) | +5,951,488 | 5,294,215 |
| 02 | `RideEdge.geometry` TEXT, GeoJSON 5dp | **43,708,416 B** (41.68 MiB) | +34,709,504 | 29,830,530 |
| 01 | `RideEdge.geometry` TEXT, **GeoJSON 6dp (the §C7 baseline)** | **47,030,272 B** (44.85 MiB) | +38,031,360 | 32,638,021 |
| 08 | **separate table** + unique index, GeoJSON 6dp TEXT | **48,771,072 B** (46.51 MiB) | +39,772,160 | 32,638,021 |

**The spread is 4.4× between the smallest and largest geometry-bearing file, and 8.3× measured on the
geometry delta alone** (+2.19 MB vs +18.2 MB… +38.0 MB). The naive baseline (row 01) is the
second-worst option measured; only putting the same text in a separate keyed table is worse.

Two secondary facts the table encodes:

- **`VACUUM`ed graph-only is 8,998,912 B, not the shipped 9,048,064 B** — 49,152 B (12 pages) of
  slack in the shipped file. All Δ figures above are against the VACUUMed control, so they are
  geometry cost and nothing else.
- **[demonstrated] the blobs round-trip.** Decoding varint-5dp back out of `05-blob.db` over 2,000
  edges reproduced every vertex to within **0.726 m** — consistent with the 0.740 m 5dp bound in §G12,
  i.e. the encoder is lossless apart from the stated rounding.

---

### G11. Up/down deduplication — the framing in the question is wrong, and the real number is larger

**This is the finding most likely to change the grilling's shape, so it comes with its correction
first.** The premise handed to this pass was that PTv2's one-relation-per-direction rule makes the
same physical track "≥2 `RideEdge` rows", so matching on the **OSM stop-node id pair** would expose
the duplication. **It largely does not.** Japanese PTv2 data gives each direction its *own*
`stop_position` nodes — one per platform track — so the up and the down edge between the same two
stations usually carry **different** node ids and do not match at all.

**[demonstrated]** three progressively looser tests over the 19,385 traced edges:

| Test | Distinct tracks | Redundant edges | Dedup'd GeoJSON-6dp | vs 31.13 MiB |
| --- | --- | --- | --- | --- |
| **A.** unordered OSM stop-node id pair (as asked) | 13,846 | **5,539 (28.6%)** | 24,702,181 B (**23.56 MiB**) | 75.7% |
| **B.** byte-identical geometry, either direction (lossless) | 13,971 | 5,414 (27.9%) | 25,045,717 B (**23.89 MiB**) | 76.7% |
| **C.** same physical corridor (endpoints ≤150 m, sampled deviation ≤100 m, length ratio ≤1.25) | **7,855** | **11,530 (59.5%)** | 17,544,873 B (**16.73 MiB**) | 53.8% |

So the answer depends entirely on which question is being asked:

- **Keyed on stop-node ids, the redundant fraction is 28.6% and the saving is 7.57 MiB.** That is
  *not* the up/down pair — it is mostly several services (local, rapid, limited express) listing the
  **same** stop nodes over the same track.
- **Keyed on geometry, the redundant fraction is 59.5% and the saving is 14.39 MiB.** That is the
  up/down pair plus the shared-corridor case, and it is the number that describes the physical
  duplication the question was reaching for.

**[demonstrated] more than two edges share track often, and test C is not a 2× win — it is 2.47×.**
Group-size histograms:

| Members per group | 1 | 2 | 3 | 4 | 5 | 6 | 7–13 | 14–24 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A** (stop-node ids) | 10,083 | 2,671 | 651 | 295 | 99 | 27 | 20 | 0 |
| **C** (corridor) | 1,584 | 4,560 | 224 | 793 | 149 | 275 | 234 | 36 |

Under A, **1,092 groups (7.9%) have >2 members**, covering 3,960 edges — and over half of all groups
are singletons. Under C, **1,711 groups (21.8%) have >2 members**, covering 8,681 edges, with the
worst corridors carrying **24 ride edges over one piece of track**. 19,385 ÷ 7,855 = **2.47 edges per
physical corridor on average**.

**[demonstrated] test C is not an artefact of loose thresholds.** Sweeping the tolerances over a 20×
range barely moves it:

| endpoint tol | deviation tol | length ratio | groups | redundant | GeoJSON-6dp | varint-5dp |
| --- | --- | --- | --- | --- | --- | --- |
| 25 m | 15 m | 1.05 | 9,170 | 10,215 (52.7%) | 18.77 MiB | 1.96 MiB |
| 50 m | 30 m | 1.10 | 8,261 | 11,124 (57.4%) | 17.42 MiB | 1.82 MiB |
| 100 m | 60 m | 1.15 | 7,982 | 11,403 (58.8%) | 16.91 MiB | 1.77 MiB |
| **150 m** | **100 m** | **1.25** | **7,855** | **11,530 (59.5%)** | **16.73 MiB** | **1.75 MiB** |
| 250 m | 200 m | 1.50 | 7,703 | 11,682 (60.3%) | 16.45 MiB | 1.72 MiB |
| 500 m | 400 m | 2.00 | 7,568 | 11,817 (61.0%) | 16.25 MiB | 1.70 MiB |

Even at 25 m/15 m — tight enough that two genuinely distinct segments cannot merge — **52.7% of
traced edges are redundant**. The finding is robust; only its last few percent are threshold-sensitive.

**[demonstrated] a side observation with teeth.** Within the test-A groups (same stop-node ids), 8,314
of 8,448 pairs (**98.4%**) are geometrically identical to within 5 m — so where the ids do match, the
geometry really is the same track and dedup is safe. The tail is not noise: **p99 deviation 1,287 m
and max 395,020 m**. Those are the §C7 closed-loop artefacts — two relations over the Yamanote-style
loop where one traced the short way and the other the long way round. **Any id-keyed dedup would
silently pick one of two wildly different shapes for those**, so the loop bug in §C7 is upstream of
the dedup decision, not independent of it.

**What that constrains:** dedup keyed on stop-node ids saves 7.57 MiB of 31.13 (24%) and is lossless;
dedup keyed on geometry saves 14.39 MiB (46%) but is lossy at the chosen tolerance and needs a
`reversed` flag per edge. On disk (§G10) the two land at 11,186,176 B and 12,083,200 B — **a 0.86 MB
difference for a lossy-vs-lossless choice**, which is a much smaller gap than the payload numbers
suggest.

---

### G12. Coordinate precision — cheap in binary, nearly worthless in GeoJSON text

**[demonstrated]** re-encoding the whole corpus at 5 and 4 decimal places, with the positional error
measured directly over all 1,401,300 vertices (haversine between the original and rounded position):

| Precision | GeoJSON total | vs 6dp | varint-delta total | vs 6dp | max error | mean error |
| --- | --- | --- | --- | --- | --- | --- |
| 6 dp | 32,638,021 B (31.13 MiB) | — | 5,294,215 B (5.05 MiB) | — | — | — |
| **5 dp** | 29,830,530 B (28.45 MiB) | **−8.6%** | **3,411,000 B (3.25 MiB)** | **−35.6%** | **0.740 m** | 0.387 m |
| **4 dp** | 27,030,429 B (25.78 MiB) | −17.2% | 2,907,731 B (2.77 MiB) | −45.1% | **7.370 m** | 3.866 m |

**The asymmetry is the point.** In GeoJSON text, dropping two decimal places saves 17% because the
punctuation — `[`, `]`, `,`, `.`, the `{"type":"LineString","coordinates":` wrapper — dominates the
digits. In a delta encoding it saves 45%, because the digits *are* the payload and smaller deltas
occupy fewer varint bytes. **Precision reduction is a lever that only works once you have already
chosen a dense encoding.**

Measured error bounds, for a slippy-map consumer: **5dp costs at most 0.74 m** (worst vertex found at
26.215465, 127.6951351, in Okinawa — the maximum is latitude-dependent via the `cos φ` term on
longitude, so Japan's southern extremity is where it peaks). **4dp costs at most 7.37 m.** For
reference, §E records that MapLibre applies Douglas-Peucker at `tolerance` 0.375 by default, so the
renderer is already discarding detail at a coarser scale than either of these at most zoom levels —
**[uncertain]** exactly which zoom levels 7.37 m becomes visible at, which I did not test on a map.

---

### G13. Alternative encodings

**[demonstrated]** total bytes for all 19,385 traced edges (1,401,300 vertices), each encoding applied
per edge, sizes summed as they would be stored:

| Encoding | SQLite type | Total bytes | MiB | B/edge | B/vertex | vs baseline |
| --- | --- | --- | --- | --- | --- | --- |
| GeoJSON `LineString` 6dp *(baseline)* | TEXT | 32,638,021 | 31.13 | 1,684 | 23.29 | 100.0% |
| GeoJSON `LineString` 5dp | TEXT | 29,830,530 | 28.45 | 1,539 | 21.29 | 91.4% |
| GeoJSON `LineString` 4dp | TEXT | 27,030,429 | 25.78 | 1,394 | 19.29 | 82.8% |
| bare `[[lon,lat],…]` array 6dp (no wrapper) | TEXT | 31,940,161 | 30.46 | 1,648 | 22.79 | 97.9% |
| bare `[[lon,lat],…]` array 5dp | TEXT | 29,132,670 | 27.78 | 1,503 | 20.79 | 89.3% |
| OGC WKB LineString (float64) | BLOB | 22,595,265 | 21.55 | 1,166 | 16.12 | 69.2% |
| int32 fixed-point pairs, 6dp, no delta | BLOB | 11,210,400 | 10.69 | 578 | 8.00 | 34.3% |
| float32 pairs | BLOB | 11,210,400 | 10.69 | 578 | 8.00 | 34.3% |
| GeoJSON 6dp + raw deflate | BLOB | 10,351,367 | 9.87 | 534 | 7.39 | 31.7% |
| **encoded polyline, precision 6** | TEXT | 6,303,166 | 6.01 | 325 | 4.50 | 19.3% |
| **varint zigzag delta, 6dp** | BLOB | 5,294,215 | 5.05 | 273 | 3.78 | 16.2% |
| varint delta 6dp + raw deflate | BLOB | 5,055,768 | 4.82 | 261 | 3.61 | 15.5% |
| **encoded polyline, precision 5** | TEXT | 4,782,602 | 4.56 | 247 | 3.41 | **14.7%** |
| polyline-5 + raw deflate | BLOB | 3,639,037 | 3.47 | 188 | 2.60 | 11.1% |
| **varint zigzag delta, 5dp** | BLOB | **3,411,000** | **3.25** | 176 | 2.43 | **10.5%** |
| varint delta 5dp + raw deflate | BLOB | 3,322,903 | 3.17 | 171 | 2.37 | 10.2% |
| varint zigzag delta, 4dp | BLOB | 2,907,731 | 2.77 | 150 | 2.08 | 8.9% |

Notes the table does not make obvious:

- **The GeoJSON wrapper is not the problem.** Stripping `{"type":"LineString","coordinates":…}` down to
  a bare coordinate array saves only 697,860 B (2.1%). GeoJSON text is expensive because of its
  per-number punctuation, not its envelope — so "store a bare array instead" is not a lever.
- **Delta encoding is what matters, not the binary-ness.** Undeltaed int32 pairs are 8.00 B/vertex;
  deltaed varints at the same 6dp precision are 3.78 B/vertex. Consecutive rail vertices are close
  together, which is exactly the structure a varint delta exploits.
- **float32 is dominated and should not be considered.** Identical size to int32 fixed-point (8 B/vertex)
  with strictly worse accuracy — at Japanese longitudes (~135°) a float32 mantissa quantises to
  roughly 1.5×10⁻⁵ ° ≈ 1.4 m, worse than 5dp fixed point, for the same bytes.
- **[demonstrated] per-row compression is nearly useless at these row sizes.** Deflating each
  varint-5dp blob individually saves 2.6% (3,411,000 → 3,322,903), because a 176-byte payload gives
  DEFLATE no room to build a dictionary. It is only on the *fat* encodings that it earns anything —
  GeoJSON-6dp compresses 3.2× — and even then the result (9.87 MiB) is three times larger than plain
  varint-5dp, i.e. **compressing a bad encoding does not beat choosing a good one.**
- Encoded polyline-5 (TEXT) and varint-5dp (BLOB) are the two dense finalists and encode the same
  precision; polyline-5 is 40% larger as a payload (4.78 MB vs 3.41 MB) but is ASCII, so it survives
  JSON transport and `sqlite3` shell inspection without hex escaping. §G15 shows the on-disk gap
  narrows to 12.4%.

---

### G14. Store the chain, not the edge — it relocates the duplication, and on disk it is *bigger*

**[demonstrated]** One assembled chain per route relation, with each ride edge holding a start/end
offset into it. Of the 1,487 rail route relations, **1,471 assemble a chain at all** and **1,390 carry
at least one traced ride edge** — the rest have fewer than two resolvable stops (§C7) and need no
geometry.

| | Per-edge segments | All 1,471 chains | 1,390 chains in use |
| --- | --- | --- | --- |
| vertices | 1,401,300 | 1,361,225 | 1,269,713 |
| GeoJSON-6dp | 32,638,021 B | 31,062,634 B | 28,974,874 B |
| polyline-5 | 4,782,602 B | 4,524,308 B | 4,223,896 B |
| varint-delta 6dp | 5,294,215 B | 5,051,448 B | 4,713,118 B |
| **varint-delta 5dp** | **3,411,000 B** | 3,217,597 B | **3,003,051 B** |

**The chain saves 11.9% of the geometry payload and nothing else.** The reason is structural: within
one relation, consecutive ride-edge segments are already disjoint apart from their shared endpoint, so
per-edge storage was never duplicating anything *inside* a relation. The 131,587-vertex difference is
just those shared endpoints being stored twice, offset against the chain's own cost of carrying track
beyond the first and last stop.

Against that 11.9% saving, the offsets cost: **2 INTEGER columns × 20,281 rows**, max offset value
**10,813** (so 2-byte SQLite integers), a raw payload of 81,124 B, plus a relation-id foreign key per
edge. **[demonstrated] on disk the trade is a net loss**: row 11 in §G10 is **12,955,648 B against row
05's 12,783,616 B** — the chain model is **172,032 B larger** than storing a varint-5dp blob per edge.

**And it does not eliminate the up/down duplication — it relocates it, exactly as suspected.**
**[demonstrated]** applying the same near-reverse test to the 1,390 whole chains:

```
chains compared: 96893 length-compatible pairs
distinct corridors among 1390 chains: 865  (525 chains are a near-duplicate/near-reverse of another)
corridor group sizes: 1x:437, 2x:389, 3x:13, 4x:16, 6x:5, 7x:1, 8x:2, 9x:1, 10x:1
varint-5dp chains: 3003051 B -> 2161969 B if corridor-deduplicated (72.0%)
```

**389 groups of exactly two** is the up/down pair, intact, at the chain level. Each direction is its
own relation, so one-chain-per-relation stores each direction's track once — which is the same thing
per-edge storage was doing. 28% of the chain payload is still redundant.

**Worse, the chain model makes the duplication *harder* to remove, not easier.** Chain-level dedup
finds 38% redundancy; edge-level corridor dedup finds 59.5% (§G11). The gap is the partial-overlap
case — a local and a limited express sharing a trunk but diverging at the ends — which segment-level
matching catches and whole-route matching cannot, because the routes' total extents differ too much to
compare. **Coarsening the storage key coarsens what dedup can see.**

---

### G15. What SQLite actually adds

**[demonstrated]** comparing each candidate's payload against its measured on-disk Δ from §G10:

| Representation | Payload | On-disk Δ | Overhead |
| --- | --- | --- | --- |
| GeoJSON-6dp TEXT column | 32,638,021 | 38,031,360 | **+16.5%** |
| polyline-5 TEXT column | 4,782,602 | 5,365,760 | +12.2% |
| varint-6dp BLOB column | 5,294,215 | 5,951,488 | +12.4% |
| varint-5dp BLOB column | 3,411,000 | 3,784,704 | **+11.0%** |
| varint-4dp BLOB column | 2,907,731 | 3,211,264 | +10.4% |
| corridor-dedup varint-5dp | 1,833,950 | 2,187,264 | +19.3% |

**Page overhead does not change the ranking, but it does compress the gaps.** Fat rows spill onto
overflow pages and pay more (16.5% for GeoJSON), lean rows pay less (11.0%). The practical effect is
that the payload-level gap between polyline-5 and varint-5dp (40%) shrinks to **12.4% on disk**
(14,364,672 B vs 12,783,616 B), because the fixed per-row and per-page costs are the same for both.

**[demonstrated] page size is a minor knob and does not reorder anything:**

| `page_size` | GeoJSON-6dp | varint-5dp |
| --- | --- | --- |
| 1,024 | 45,853,696 B | 13,360,128 B |
| **4,096 (default, and what the shipped file uses)** | 47,030,272 B | 12,783,616 B |
| 8,192 | 46,161,920 B | **12,640,256 B** |
| 65,536 | **44,302,336 B** | 13,107,200 B |

The two encodings want opposite page sizes — big rows prefer big pages, small rows prefer pages that
fit several — and the total movement is ±6% for GeoJSON and ±4.5% for varint. **The default 4,096 is
within 1.2% of optimal for varint-5dp.**

**[documented + demonstrated] SQLite has no built-in compression.** The stock library ships no page
compressor (ZIPVFS is a separate commercial product), so nothing in the table above is being
compressed by the database. If the artefact's shipped/transferred size matters rather than its
on-device size, gzip changes the numbers but **not the ranking**:

| Representation | On disk | gzip -9 | ratio |
| --- | --- | --- | --- |
| *graph only* | 8,998,912 | 2,400,574 | 26.7% |
| corridor-dedup varint-5dp | 11,186,176 | **3,778,435** | 33.8% |
| varint-4dp column | 12,210,176 | **3,803,946** | 31.2% |
| lossless-dedup varint-5dp | 12,083,200 | 4,391,060 | 36.3% |
| varint-5dp column | 12,783,616 | 4,823,979 | 37.7% |
| polyline-5 column | 14,364,672 | 5,135,014 | 35.7% |
| GeoJSON-6dp column | 47,030,272 | 11,674,086 | 24.8% |

One inversion worth naming: **varint-5dp + per-row deflate gzips *worse* than plain varint-5dp**
(5,548,889 vs 4,823,979) despite being marginally smaller on disk. Pre-compressing each row destroys
the cross-row redundancy that whole-file gzip would otherwise exploit. **[demonstrated]** — rows 05
and 07 of §G10.

**[demonstrated] the answer to #142's "new column vs separate store", measured.** A separate keyed
table costs **~1.75 MB more** than an inline column, for identical payload, because `RideEdge`'s
composite key is two TEXT ids averaging 18.36 characters and the separate table must duplicate both
plus carry a unique index on them:

| | Inline column | Separate table + unique index | Cost of separating |
| --- | --- | --- | --- |
| GeoJSON-6dp | 47,030,272 B | 48,771,072 B | +1,740,800 B |
| varint-5dp | 12,783,616 B | 14,569,472 B | +1,785,856 B |

The cost is flat in the payload — it is the keys, not the geometry. Note this measures the *storage*
side only; it says nothing about whether the 896 geometry-less ride edges are better modelled as a
`NULL` column or an absent row, which is a modelling question, not a size one.

---

### What this pass could not establish

- **[uncertain] Whether a lossy corridor dedup is acceptable at all.** §G11's test C merges edges whose
  shapes differ by up to 100 m and whose endpoints differ by up to 150 m, then keeps one representative
  — so an edge can render on track it does not physically use, and every dedup'd edge needs a
  `reversed` flag whose correctness I did not verify against the direction the search traversed
  (§Open-questions 2). I measured the size, not the acceptability.
- **[uncertain] Read-path cost.** Every figure here is storage. I did not measure query latency,
  decode cost per edge in JS, or what a varint decoder costs against `JSON.parse` on the render path —
  and a shared-geometry table adds a join that per-edge storage does not have.
- **[uncertain] At what zoom 4dp (7.37 m) becomes visible.** §E establishes MapLibre simplifies by
  default at `tolerance` 0.375, but I did not render either precision on a map to compare.
- **[uncertain] Whether the 896 untraced ride edges stay untraced.** All sizes assume 19,385 of 20,281
  edges carry geometry. A better assembler (loop-aware, per §C7) would raise both the coverage and
  every number in §G10 roughly proportionally.
- Scripts for this pass were scratch code and were not committed, exactly as for §C7.
