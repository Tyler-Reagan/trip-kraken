# Routing memory architecture: why 15.5 GB of road graph will not fit in an 8.3 GB VM

- **Answers:** the `osrm-car` OOM-kill against ADR-0024 §1 and its 2026-08-10 amendment ("Build
  memory, not disk, is what bounds the Extract"), and ADR-0025 §4 ("Graph scope is sized to the
  machine that builds it"). No issue filed; this doc is the artifact.
- **Date:** 2026-08-12
- **Status:** Research findings. Not an ADR — the recommendation below needs an ADR-0024 amendment
  (see *What this changes in the record*), and it contradicts three sentences currently in the repo.
- **Code read at:** `main` `889b9c6`.
- **Versions evaluated:** OSRM `v26.4.1` (the exact revision `docker-compose.yml` and
  `scripts/build-osrm-graphs.sh` pin; every OSRM source link below is to that tag, not `master`);
  Valhalla `3.8.3` (latest release, 2026-07-25); GraphHopper `11.0` (latest release, 2025-10-14);
  Boost.Iostreams `develop`; Docker Desktop on darwin arm64, VM RAM 8,321,515,520 B (7.75 GiB),
  swap 1 GiB.
- **Measured on this machine, 2026-08-12** (§8): startup time, RSS, and warm/cold latency for
  `osrm-routed` with and without `--mmap`, on the real `db/osrm/car` graph, using disposable
  probe containers that were removed afterwards. Nothing in the repo was modified.

## Recommendation

**Add `--mmap` to both `osrm-routed` commands in `docker-compose.yml`. That is the whole fix.**

It is one word per line, it is reversible by deleting that word, it forecloses nothing, and it is
not speculative — I measured it on this machine against the real `db/osrm/car` graph:

| | default (today) | `--mmap` |
| --- | --- | --- |
| RSS after startup + one route | **5.66 GiB** | **76 MiB** |
| RSS after a 60×60 `table` over Tokyo | 5.66 GiB | 448 MiB |
| RSS after also a 60×60 `table` over Osaka | 5.72 GiB | 649 MiB |
| `docker run` → first served route | 4.85 s | 0.20–0.50 s |
| 60×60 `table`, warm | 0.413–0.445 s | 0.415–0.429 s |
| 60×60 `table`, first call after a cold start | 0.565 s | 1.143 s |
| Tokyo→Kyoto `route?steps=true&geometries=geojson`, warm | 0.008–0.010 s | 0.014 s |
| short `route?steps=true&geometries=geojson`, warm | 0.0013–0.0019 s | 0.0014–0.0017 s |

**Warm latency is unchanged within noise.** The entire cost of `--mmap` is a one-off cold penalty
— roughly +0.6 s on the first 60×60 matrix after a container start, +0.4 s on the first route into
a region the process has not touched yet — in exchange for an 8.7× reduction in resident memory
and a 10–24× reduction in time-to-ready. Both containers then fit, together, with room to spare.

**The mmap-over-virtiofs question — the one I expected to be the blocker, and the one the brief
correctly flagged as empirical — is answered, and the answer is that it works.** OSRM maps its
files `MAP_SHARED` (§3), which is exactly the call that has been reported failing with `ENODEV`
over virtiofs elsewhere. On this machine, over this bind mount, it does not fail. I did not have
to infer that; I ran it.

**The user's framing is right, and it is right about OSRM specifically — not only in principle.**
"Holding all of Kantō resident to route across Shibuya is gratuitous" is a correct description of
what `osrm-routed` does *by default*, and OSRM has shipped the demand-loading answer since 2018
([PR #5242](https://github.com/Project-OSRM/osrm-backend/pull/5242)). We simply had not turned it
on. The measured working set after a full 60-point Tokyo matrix is **8%** of what the default
allocator holds.

Two places where the framing needs qualifying, both worth stating because they bound how far the
insight travels:

1. **"Demand-load like DuckDB does" is not free of a cost model, it just moves it.** OSRM's
   demand-loading is the kernel's page cache, not a columnar reader with statistics. There is no
   pruning, no predicate pushdown, no notion of "this query only needs Shibuya" — there is only
   "pages that got touched stay in RAM." That is enough here because MLD's search *is* spatially
   local for a metro-scale matrix (measured: an Osaka matrix on a Tokyo-warm process cost 201 MiB
   more RSS, not another 5 GiB). It would be much less kind to a query that genuinely spans the
   graph. The Tokyo→Kyoto driving route is the visible case: 0.47 s cold against 0.013 s warm.
2. **The instinct to cut the graph into per-region extracts is the wrong lever, and ADR-0024
   already rejected it for the right reason.** §6 below confirms that from the OSRM side: merging
   before `osrm-extract` is the documented pattern, per-region graphs are not, and there is no
   cross-extract routing at all. `--mmap` gets the memory win *without* the coverage loss, which is
   the whole point.

**Do not switch engines.** Valhalla is a genuinely tile-native, demand-loading design (§4) and its
OSRM-compatible output format makes the migration far cheaper than it looks — both `costMatrix`
and `describeJourney` response parsers would survive nearly verbatim. But it buys a property we
can have for one word, and it costs a second graph-build pipeline, a second set of profile
semantics to calibrate, and a re-litigation of ADR-0024 §4's decline mechanism. Keep it on the
shelf as the answer to a *different* question (§4's closing note names which one). **GraphHopper is
disqualified outright: its Matrix API is not open source** (§5), and ADR-0024 §2 requires a matrix.

---

## What this changes in the record

### CONTRADICTS — three sentences currently in the repo say OSRM memory-maps its graphs. As configured, it does not.

- `scripts/build-osrm-graphs.sh:96` — "osrm-routed memory-maps only what serving actually reads."
- `scripts/transfer-osrm-graphs.sh:9` — "osrm-routed memory-maps these files, and a compressed file
  isn't mappable."
- `docs/adr/0025-bff-over-http-services-and-deployment-posture.md`, Context — "`osrm-routed` and
  VROOM are long-lived processes that **memory-map multi-gigabyte graphs** and take tens of seconds
  to become ready."

Without `--mmap`, `osrm-routed` selects `ImmutableProvider`, which uses `ProcessMemoryAllocator`
([`engine.hpp#L75-L79`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/include/engine/engine.hpp#L75-L79)).
That allocator computes the total layout size, calls `std::make_unique<char[]>` for the whole
thing, and then *copies every file into it*
([`process_memory_allocator.cpp#L20-L28`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/engine/datafacade/process_memory_allocator.cpp#L20-L28)).
OSRM's own wiki states it plainly: "We basically just load all the files into memory, so whatever
the output file size from pre-processing - that's roughly how much RAM you'll need (minus the size
of the `.fileIndex` file, which is `mmap()`-ed and read on-demand…)"
([Disk and Memory Requirements](https://github.com/Project-OSRM/osrm-backend/wiki/Disk-and-Memory-Requirements)).

The `.fileIndex` exception is why the claim felt true: the R-tree leaf file *is* always mmap'd,
even in the default mode
([`mmap_memory_allocator.cpp` / `PopulateLayoutWithRTree`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/storage/storage.cpp#L343-L357)),
and it is the single largest file after `cell_metrics` (714 MB foot / 464 MB car here). Everything
else is a copy.

The conclusions those three sentences support all survive:

- `build-osrm-graphs.sh`'s pruning is still correct, for a *better* reason than the one recorded.
  The five pruned files are not "not read" — they are **not in either loaded-file list at all**
  ([`GetStaticFiles`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/storage/storage.cpp#L285-L317),
  [`GetUpdatableFiles`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/storage/storage.cpp#L319-L341)).
  The move-aside-and-restart experiment recorded in that comment tested the right thing.
- `transfer-osrm-graphs.sh`'s "don't ship it compressed" is right either way — mmap needs an
  uncompressed file, and so does the copying allocator.
- ADR-0025's conclusion — these cannot run *as* serverless functions — survives, but its stated
  reason gets weaker under `--mmap`: 0.2 s to ready and 76 MiB resident is not "tens of seconds."
  What actually blocks it is that the process needs a 7.3 GB file on a local filesystem, which is a
  cleaner statement of the same constraint.

### EXTENDS — ADR-0024's 2026-08-10 amendment lists three levers for the Extract. There is a fourth, and it is cheaper than all of them.

That amendment measured build memory and enumerated: raise the Docker allocation, build off-machine
and copy down, or build per region. All three are about `osrm-extract` / `osrm-partition` /
`osrm-customize`. **None of them is about serving**, because at the time serving fit. The Extract
then widened from Kantō to Kantō + Kansai + Chūbu (`build-osrm-graphs.sh:13`) and the serving side
broke — a failure mode the amendment's model does not contain.

`--mmap` is that fourth lever, and it changes the shape of the constraint rather than raising a
ceiling: **serving memory stops scaling with graph size and starts scaling with working set.** The
binding constraint returns to build memory alone, which `scripts/transfer-osrm-graphs.sh` already
exists to solve. The amendment's own policy — "coverage now grows by extending the Extract" —
becomes materially cheaper to honour, including nationwide Japan.

### CONFIRMS

- **`osrm-viability-149.md` §4's parenthetical, "or much less with `--mmap`", was right**, and is
  now quantified rather than asserted. Its §4 table is otherwise superseded by direct measurement
  (§1's accounting predicted 5.620 GiB for `car`; measured RSS was 5.661 GiB — the extrapolation
  method was sound, the linear-from-planet numbers were not needed).
- **ADR-0024's 2026-08-10 rejection of per-region graphs** is confirmed from the OSRM side (§6).
- **`hosted-routing-alternatives.md`'s inference that Stadia runs Valhalla** is now near-certain:
  Stadia's documented pedestrian matrix beeline cap of 200 km is *exactly* Valhalla's stock
  `service_limits.pedestrian.max_matrix_distance`
  ([`valhalla_build_config#L332-L338`](https://github.com/valhalla/valhalla/blob/3.8.3/scripts/valhalla_build_config#L332-L338)).
  Still inference, but from a config default rather than from vocabulary.
- **GraphHopper's disqualification** is confirmed on a second, harder ground than the ToS reading
  that doc flagged as its one judgement call (§5). No judgement needed now.

---

## Evidence

### 1. What `osrm-routed` actually loads, file by file

`StorageConfig` declares the required, optional, and disabled-feature file sets
([`storage_config.hpp#L44-L112`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/include/storage/storage_config.hpp#L44-L112));
`Storage::GetStaticFiles` and `Storage::GetUpdatableFiles` are the two lists actually walked
([`storage.cpp#L285-L341`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/storage/storage.cpp#L285-L341)).
Crossed against the real files in `db/osrm/`:

| file | foot | car | status |
| --- | ---: | ---: | --- |
| `.osrm.cell_metrics` | 1,999 MB | **3,256 MB** | updatable, optional-but-present → **loaded** |
| `.osrm.geometry` | 1,286 MB | 836 MB | updatable, **required** → loaded |
| `.osrm.mldgr` | 1,109 MB | 698 MB | updatable, optional-but-present → loaded |
| `.osrm.nbg_nodes` | 412 MB | 267 MB | static, required → loaded |
| `.osrm.edges` | 317 MB | 199 MB | loaded; dropped by `ROUTE_GEOMETRY` |
| `.osrm.ebg_nodes` | 260 MB | 166 MB | static, required → loaded |
| `.osrm.partition` | 173 MB | 110 MB | static, optional-but-present → loaded |
| `.osrm.icd` | 135 MB | 88 MB | loaded; dropped by `ROUTE_STEPS` and `ROUTE_GEOMETRY` |
| `.osrm.turn_{weight,duration}_penalties` | 2×91 MB | 2×57 MB | updatable, required → loaded |
| `.osrm.cells` | 30 MB | 17 MB | static, optional-but-present → loaded |
| `.osrm.ramIndex` | 3 MB | 2 MB | static, required → loaded |
| `.osrm.names` | 2 MB | 1 MB | loaded; dropped by `ROUTE_GEOMETRY` |
| `.osrm.{tls,tld,maneuver_overrides,properties,timestamp,datasource_names}` | <1 MB | <1 MB | loaded |
| **loaded total** | **5.768 GiB** | **5.620 GiB** | → 11.39 GiB for both, against a 7.75 GiB VM |
| `.osrm.fileIndex` | 714 MB | 464 MB | **never loaded** — always mmap'd |
| `.osrm.turn_penalties_index` | 570 MB | 358 MB | **in neither list** — build artifact, still on disk |
| `road.osm.pbf`, `.ebg`, `.enw`, `.cnbg`, `.cnbg_to_ebg` | 1,220 MB | 916 MB | build-only; `build-osrm-graphs.sh`'s prune did not run on this build |

Three things fall out of this table:

- **The OOM is fully explained and needs no further diagnosis.** 5.768 + 5.620 = 11.39 GiB of
  anonymous heap against a 7.75 GiB VM with 1 GiB of swap. `osrm-foot` alone (5.768 GiB) fits;
  adding `osrm-car` cannot. Exit 137 is arithmetic, not a bug.
- **`--disable-feature-dataset` is not a fix even before you ask whether it breaks anything.** The
  entire droppable set is `.osrm.edges` + `.osrm.icd` + `.osrm.names` + `.osrm.tls` + `.osrm.tld` =
  **0.443 GiB (foot) / 0.281 GiB (car)**, about 5–8%. Note especially that `.osrm.geometry` —
  1,286 MB on foot — is **required unconditionally** and is *not* dropped by `ROUTE_GEOMETRY`; the
  feature-dataset name refers to the API surface, not to that file. Neither is `.osrm.cell_metrics`,
  the 3.26 GB elephant, droppable at all: MLD needs it.
- **`.osrm.turn_penalties_index` (928 MB across both profiles) appears in neither loaded list.** It
  is an `osrm-extract` output consumed by `osrm-customize`. Deleting it is a plausible free disk
  win on top of the prune the script already intends — but it is **unverified** and belongs in the
  same move-aside-and-restart test the script's existing comment documents, not in a blind `rm`.

### 2. `--mmap`: what it changes, and whether anything defeats it

**It changes which allocator the engine constructs, and nothing else.**
`Engine`'s constructor is a three-way branch
([`engine.hpp#L56-L78`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/include/engine/engine.hpp#L56-L78)):
`--shared-memory` → `WatchingProvider`; `--mmap` (or the deprecated `memory_file`) →
`ExternalProvider`; otherwise `ImmutableProvider`. `ExternalProvider` wraps `MMapMemoryAllocator`,
which opens each file as a `boost::iostreams::mapped_file_source` and hands the mapped pointer
straight to the data index — no copy
([`mmap_memory_allocator.cpp#L43-L57`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/engine/datafacade/mmap_memory_allocator.cpp#L43-L57)).
The flag is defined at
[`routed.cpp#L152-L157`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/tools/routed.cpp#L152-L157):
`"mmap,m"`, default `false`, "Map datafiles directly, do not use any additional memory."

**Nothing touches the whole dataset at startup.** This was the specific worry, and the answer is
in the layout code. Under `--mmap`, the only work per file is `populateLayoutFromFile`, which opens
the `.osrm.*` tar, `List()`s its entries, and reads a small element-count `.meta` block per entry
([`storage.cpp#L165-L181`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/storage/storage.cpp#L165-L181)).
`List()` reads a 512-byte header and then *seeks* past the payload for every entry
([`tar.hpp#L160-L180`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/include/storage/tar.hpp#L160-L180)).
That is O(number of blocks), not O(bytes). There is no checksum sweep, no index rebuild, no
validation pass over the data. Measured: 76 MiB RSS and 0.2–0.5 s to a served route (§8).

**It works with MLD.** The allocator is algorithm-agnostic — the same `SharedDataIndex` feeds
`DataFacadeFactory<FacadeT, AlgorithmT>` in all three branches, and `.osrm.cell_metrics` /
`.osrm.mldgr` / `.osrm.cells` / `.osrm.partition` are ordinary entries in the static/updatable
lists. Measured directly on our MLD `car` graph (§8).

**But MLD is the algorithm mmap suits *least*, and this is worth naming.** OSRM maintainer
`TheMarex`, on why cell metrics cannot cheaply be compressed:
"MLD spends most of its time traversing these arrays, anything you can do to keep things cache
local helps a ton" ([#6394](https://github.com/Project-OSRM/osrm-backend/issues/6394#issuecomment-1292140886)).
The hot structure under MLD is precisely the 3.26 GB file. Under CH it would be `.osrm.hsgr`
instead. The measurements say this is survivable for our workload; it is the reason a much larger
extract or a much heavier query mix would need re-measuring rather than assuming.

**What maintainers say about it — a tuning knob with a real cost, not a degraded-only fallback.**
`danpat`, introducing the feature: "instead of loading all data into RAM, this causes OSRM to
directly `mmap` datafiles. This means you can run OSRM in quite constrained memory environments, if
you're willing to sacrifice performance. Supplying sufficient memory to allow page caching to have
effect means that if your data has some common access patterns, you can achieve quite good
performance with significantly less runtime RAM. **Realistic benchmarking for your particular
scenario is necessary** to decide how much RAM will give you acceptible performance, but at least
now this knob exists to tune."
([#5242](https://github.com/Project-OSRM/osrm-backend/pull/5242)). `mjjbell`, answering a planet-scale
memory question: "You might want to try the `--mmap` option, which will allow you to run
`osrm-routed` in more memory constrained environments at the expense of some paging."
([#6089](https://github.com/Project-OSRM/osrm-backend/issues/6089#issuecomment-888452294)).

Our situation is the good case in danpat's description almost exactly: the access pattern is
extremely common (one metro, repeatedly), and there is plenty of RAM left for page cache once the
copies are gone.

**It is used in production, and the known failure mode is I/O amplification, not correctness.**
[Issue #7618](https://github.com/Project-OSRM/osrm-backend/issues/7618) is a bare-metal deployment
running **this exact version** (`v26.4.1`) with `--mmap=1` on a Europe CH graph larger than RAM.
The reported symptom was 100% CPU and 200 ms health-check latency; the cause was on their side and
the resolution is the most useful sentence in the thread:

> The slow machine had a block-device **readahead set to 4096 KB** (vs 128 KB on the healthy
> machine). With a 4096 KB readahead, every page fault triggered the kernel to read ~4 MB instead
> of a single page … We set the readahead back to 128 KB … and then to 0, which seems to perform
> even better.

This matters to us in a specific way: **that tuning knob does not exist for a virtiofs bind
mount.** There is no `/sys/block/<device>/queue/read_ahead_kb` for a FUSE-backed filesystem. If
mmap over virtiofs had turned out to be slow, we would have had less to turn. It did not (§8), but
it is the right thing to re-check if the Extract grows.

### 3. mmap over virtiofs

**Mechanism, from primary sources.** virtiofs is FUSE with the `/dev/fuse` transport replaced by a
virtqueue: "the guest acts as the FUSE client while the host acts as the FUSE server"
([Linux `Documentation/filesystems/virtiofs.rst`](https://github.com/torvalds/linux/blob/master/Documentation/filesystems/virtiofs.rst)).
Without DAX, file contents are cached in the *guest* page cache and every miss is a FUSE request
over the virtqueue. DAX is the feature that would remove that hop — the virtio-fs project
describes it as **experimental**, giving "the guest page cache is bypassed, reducing the memory
footprint", "no communication is necessary to access file contents", and "shared file access is
coherent between virtual machines on the same host even with mmap"
([virtio-fs.gitlab.io](https://virtio-fs.gitlab.io/)). Docker Desktop's settings documentation
offers only the choice between VirtioFS and gRPC FUSE and says nothing about DAX
([Docker Desktop settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/)),
so the working assumption is: **no DAX, guest page cache, faults cost a host round-trip.**

**The correctness risk, and why it was worth taking seriously.** OSRM maps via
`boost::iostreams::mapped_file_source`, i.e. `mapped_file::readonly`, and Boost's POSIX
implementation selects `MAP_PRIVATE` only for `mapped_file::priv` — `readonly` gets **`MAP_SHARED`**
([`mapped_file.cpp#L331-L342`](https://github.com/boostorg/iostreams/blob/develop/src/mapped_file.cpp#L331-L342)).
`MAP_SHARED` over a virtiofs bind mount is exactly the call reported failing with `ENODEV` in
[docker/sbx-releases#55](https://github.com/docker/sbx-releases/issues/55) — "Using `MAP_PRIVATE`
instead works. Both `MAP_SHARED` and `MAP_PRIVATE` works with normal docker bind mounts." That
report is **Windows/WSL, not macOS**, and I found no equivalent macOS report in `docker/for-mac`;
I am citing it as the shape of the hazard, not as evidence about our platform.

**On this machine it works.** Measured (§8): `osrm-routed --mmap` started, mapped, and served
correct results from a `db/osrm/car` bind mount, with warm latency indistinguishable from the
in-RAM allocator. There is no substitute for having run it, and this is the one question in the
brief that no document could have answered.

**Page cache versus anonymous memory is why this fixes the OOM, not just shrinks a number.** Under
`--mmap`, the graph's residency is clean, file-backed page cache. cgroup v2's `memory.max` invokes
the OOM killer only when usage "reaches this limit **and can't be reduced**"
([`cgroup-v2.rst`](https://github.com/torvalds/linux/blob/master/Documentation/admin-guide/cgroup-v2.rst#L1376-L1384));
mapped clean pages can always be reduced. The default allocator's `make_unique<char[]>` cannot.
The difference is not 8.7× less memory — it is *reclaimable* memory instead of unreclaimable
memory, which is why one number is a soft ceiling and the other is exit 137.

### 4. `osrm-datastore` / `--shared-memory` — buys us nothing, precisely

**It reduces the number of copies, not the size of a copy.** `--shared-memory` selects
`WatchingProvider`, which attaches to a named region prepared by `osrm-datastore`
([`engine.hpp#L56-L61`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/include/engine/engine.hpp#L56-L61));
`Storage::Run` builds one contiguous region per dataset and swaps it in
([`storage.cpp#L185-L280`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/storage/storage.cpp#L185-L280)).
`--dataset-name` exists so several *named* datasets can coexist — "Name of the shared memory
dataset to connect to" ([`routed.cpp#L158-L160`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/tools/routed.cpp#L158-L160)),
and the wiki confirms "Since OSRM 5.17 we allow multiple datasets in memory at the same time"
([Configuring and using Shared Memory](https://github.com/Project-OSRM/osrm-backend/wiki/Configuring-and-using-Shared-Memory)).

So: **N readers of one dataset cost one copy. Two readers of two different datasets cost two
copies.** Our `foot` and `car` graphs are different datasets. Total stays 11.39 GiB. The saving is
exactly zero.

It is also worse than zero on two counts. The shared region is System V IPC — on Linux OSRM uses
`boost::interprocess::xsi_shared_memory`
([`shared_memory.hpp#L8-L12`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/include/storage/shared_memory.hpp#L8-L12))
— which is tmpfs-backed and therefore *not* reclaimable page cache, so it would OOM the same way.
And it is namespaced per container: Docker's `--ipc` "provide[s] separation of named shared memory
segments, semaphores and message queues", with the default being `private` or `shareable`
([docker container run reference](https://docs.docker.com/reference/cli/docker/container/run/)).
Reaching one region from two containers is *possible* — `ipc: shareable` plus `ipc:
container:<name>` — but OSRM additionally coordinates through lock and semaphore files under
`/dev/shm/osrm-<uid>/`
([`shared_memory.hpp#L40-L50`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/include/storage/shared_memory.hpp#L40-L50)),
so the arrangement means coupling the containers' IPC namespaces and `/dev/shm`. That is real
complexity purchased for no memory at all.

**Verdict: not a lever. `--shared-memory` is for horizontally scaling readers of one graph and for
hot-swapping data under live traffic. We have neither problem.**

### 5. `--disable-feature-dataset` — would break both of our calls, and would not have been enough anyway

The size argument is in §1: 5–8%. The correctness argument is decisive on its own.

`mjjbell`'s PR introducing the feature is explicit about scope: "`ROUTE_GEOMETRY`, for disabling
overview, steps, annotations **and waypoints**"; "`ROUTE_STEPS`, for disabling steps only";
"Attempts to query a feature for which the dataset is disabled will lead to a
`DisabledDatasetException` being returned"
([#6666](https://github.com/Project-OSRM/osrm-backend/pull/6666)). The wiki page it added restates
this as an equivalence:

> **ROUTE_GEOMETRY** — Disabling this dataset is equivalent to limiting your requests to the
> following parameters `steps=false&overview=false&annotations=false&skip_waypoints=true`
>
> **ROUTE_STEPS** — Disabling this dataset is equivalent to limiting your requests to the following
> parameter `steps=false`

and shows the failure verbatim:

> `{"message":"DisabledDatasetException: Your query tried to access the disabled dataset
> IntersectionBearings. Please check your configuration.","code":"DisabledDataset"}`

([Disabled Datasets](https://github.com/Project-OSRM/osrm-backend/wiki/Disabled-Datasets))

Against our code:

- `osrmProvider.describeJourney` requests `steps=true&overview=full&geometries=geojson`
  (`src/lib/osrmProvider.ts:260`) and groups `step.mode` into runs (`groupSteps`, lines 201–222).
  **`ROUTE_STEPS` breaks this outright** — the request 400s, and ADR-0024 §6's entire shift
  decomposition goes with it.
- **`ROUTE_GEOMETRY` additionally kills `skip_waypoints`**, and waypoints are the out-of-Extract
  decline mechanism. `costMatrix` reads `sources[]`/`destinations[]` snap distances
  (`osrmProvider.ts:120-121`) and `describeJourney` reads `waypoints[0..1].distance`
  (`osrmProvider.ts:263-266`). ADR-0024's 2026-08-11 amendment made that the mechanism the whole
  degradation story rests on. Disabling it does not degrade the provider — it makes it lie, which
  is the exact failure the amendment was written to prevent.

**Verdict: incompatible with ADR-0024 §6 and with the 2026-08-11 decline mechanism, and worth ~6%
even if it weren't.**

### 6. Multiple narrow extracts + dispatch — not a recognized pattern, and there is no cross-extract routing

The clearest primary statement is from `jcoupey` (VROOM's author) answering a user who wanted
mainland Spain and the Canaries in one server
([#6463](https://github.com/Project-OSRM/osrm-backend/issues/6463)):

> The usual way to use several OSM extracts in a single OSRM server is to **merge them before-hand
> and apply the pre-processing pipeline to the resulting file**. Among others, osmium is a great
> tool for this […]

and, on a proposal to teach `osrm-extract` to read several `.pbf` files:

> Not sure this would be such a wise move since it would mean writing and maintaining extra code
> for just this purpose with all the potential edge cases you can imagine […] Also this would make
> OSRM responsible for any bug related to handling multiple files while we have efficient tools
> designed just for this.

`scripts/build-osrm-graphs.sh` already does exactly this (`osmium merge`, lines 61–63) — the script
is following the documented pattern, and its inline comment ("OSRM has no merge of its own —
regions must combine before `osrm-extract`, not after") is correct.

The same reply confirms the snapping behaviour ADR-0024 verified live on 2026-08-11, from the
maintainer side:

> This happens because no error is returned by OSRM, the far-away coordinates are just snapped to
> the nearest nodes in the extract, usually the same nodes hence the 0 distances. You can play
> around with this using the `radiuses` parameters.

and states the profile rule the compose file encodes: "If you want several profiles, you need to
run several servers."

**What the docs *do* document is multiple profiles, not multiple regions.** The wiki's "Running
multiple profiles on one machine" section shows an nginx reverse proxy fanning `/route/v1/driving`,
`/walking`, `/cycling` to three ports, and is explicit that the URL component is decorative: "the
`driving`, `walking`, `cycling` part of the URL is used by `nginx` to select the correct proxy
backend, but after that, `osrm-routed` ignores it"
([Running OSRM](https://github.com/Project-OSRM/osrm-backend/wiki/Running-OSRM)). There is no
region-dispatch counterpart anywhere in the docs or the wiki.

**What breaks when the endpoints fall in different extracts: everything, silently.** There is no
stitching, no boundary node concept, no cross-graph query. A `table` request to a server holding
only Kantō with a Kansai coordinate returns `code: "Ok"` and a plausible wrong answer — which is
why `ROAD_SNAP_MAX_METERS` exists. Dispatching per region would therefore make Tokyo→Kyoto road
cells *unanswerable* rather than *wrong*, which is what ADR-0024's 2026-08-10 amendment already
concluded when it kept per-region builds as an escape hatch and declined to take it.

**This finding is unchanged by `--mmap` and confirms the existing decision. Nothing here reopens
it.**

### 7. Reality check: what OSRM expects in production

- **"Load it all" is genuinely the default and the documented norm.** The wiki's Runtime section
  gives 123 GiB of RAM for a planet car graph and explains the rule as "whatever the output file
  size from pre-processing - that's roughly how much RAM you'll need"
  ([Disk and Memory Requirements](https://github.com/Project-OSRM/osrm-backend/wiki/Disk-and-Memory-Requirements)).
  Note the wiki is dated to v5.26 / Nov 2021 and current OSRM is v26.x; the *rule* still holds
  exactly (predicted 5.620 GiB vs measured 5.661 GiB), the planet numbers are stale.
- **`--mmap` is the documented escape hatch from that norm, offered by maintainers to people in
  our situation** (§2's `danpat` and `mjjbell` quotes). It is not a hack and not deprecated — the
  *deprecated* option is `memory_file`, which now "will behave the same as `--mmap`"
  ([`routed.cpp#L152-L154`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/tools/routed.cpp#L152-L154)).
- **The scale intuition is not wrong for OSRM.** Our Kantō+Kansai+Chūbu foot graph at 5.77 GiB is a
  large deployment by the standards of a laptop and a small one by the standards of the project.
  A user reporting Brazil at 6.4 GiB resident got the answer "yes, it's kinda linear (linear with
  respect to routing-relevant data size)" from `nilsnolde`
  ([#6309](https://github.com/Project-OSRM/osrm-backend/issues/6309#issuecomment-1216853724)) — who
  also volunteered the comparison that frames the whole question: "It's full of configuration and
  generally has a smaller memory footprint than osrm. **Look at Valhalla, you can run the whole
  world on a few GB.** It always depends on the use case which one fits best."

So the honest summary of the premise: **the user is right that resident-whole-graph is absurd for
this workload; the ecosystem agrees; OSRM's answer is a flag and Valhalla's answer is its
architecture.** Both are available. One costs a word.

### 8. What I measured on this machine

**Provenance, stated plainly.** When I started, two containers named `osrm-foot-mmap` and
`osrm-car-mmap` were already running with `--mmap` against these bind mounts — a prior session or
the user had already begun this experiment. **I did not use their numbers as evidence**: their
page cache was pre-warmed and their history unknown. I re-ran everything on my own disposable
containers (`osrm-probe` for `--mmap`, `osrm-ram` for the default allocator), dropping the VM page
cache between runs, and removed both afterwards. `git status` is unchanged from session start.

Setup: image `ghcr.io/project-osrm/osrm-backend:26.4.1-debian`, `osrm-routed --algorithm mld
--max-table-size 1000` on `db/osrm/car` (7.27 GB on disk, 5.620 GiB of loaded files), bind-mounted
`:ro` from macOS. Query sets: 60 seeded random points inside the Tokyo 23 wards, and 60 inside
Osaka — both `table/v1/driving?annotations=duration,distance`, the exact shape
`osrmProvider.costMatrix` emits; plus `route/v1/driving?steps=true&overview=full&geometries=geojson`,
the exact shape `describeJourney` emits.

| measurement | default | `--mmap` |
| --- | ---: | ---: |
| `docker run` → first successful `/route` | 4.85 s | 0.20 s (caches dropped) / 0.50 s |
| RSS after that first route | 5.661 GiB | 75.8 MiB |
| RSS after 60×60 Tokyo `table` | 5.66 GiB | 448.1 MiB |
| RSS after also 60×60 Osaka `table` | 5.715 GiB | 649.3 MiB |
| 60×60 Tokyo `table` — 1st / 2nd / 3rd / 4th | 0.565 / 0.413 / 0.445 / 0.419 s | 1.143 / 0.417 / 0.429 / 0.415 s |
| 60×60 Osaka `table` — 1st / 2nd / 3rd | 0.208 / 0.174 / 0.176 s | 0.428 / 0.182 / 0.180 s |
| Tokyo→Kyoto `route` (steps+geojson) — 1st / warm | 0.053 / 0.008 s | 0.455 / 0.014 s |
| short Tokyo `route` (steps+geojson) — warm | 0.0013–0.0019 s | 0.0014–0.0017 s |

**Correctness.** I hashed the full 60×60 `table` response from both processes. They differ — in
exactly one place. `durations`, `distances`, and every field of `sources[]`/`destinations[]`
including `location`, `name` and the snap `distance` are **byte-identical**; only the opaque `hint`
string differs in its trailing bytes (the connectivity checksum reads back non-zero under `--mmap`
and zero under the default allocator). `hint` is a client-side routing-cache token validated as
`facade.GetCheckSum() == data_checksum`
([`hint.cpp#L15-L24`](https://github.com/Project-OSRM/osrm-backend/blob/v26.4.1/src/engine/hint.cpp#L15-L24)).
`osrmProvider.ts` never sends or reads it — the field is not even in its response interfaces
(`OsrmWaypoint`, `osrmProvider.ts:76-81`, declares `hint?: string` and ignores it). **No field
trip-kraken consumes is affected.** The discrepancy itself is unexplained and is on the
unverified list.

**Both graphs together.** With the pre-existing `--mmap` pair co-resident and driven through Tokyo,
Osaka and a Tokyo→Kyoto route, they held **1.238 GiB (foot) + 985.5 MiB (car) ≈ 2.2 GiB** against
11.39 GiB in default mode, with the VM reporting 6.5–6.8 GB free and swap untouched.

**The `foot` graph is the slower one and should set expectations.** Measured on the pre-existing
`--mmap` container: 60×60 Tokyo table 2.27 s cold / 1.10 s warm; Osaka 0.97 s cold / 0.54 s warm —
roughly 2.5–3× the `car` figures, which tracks the denser pedestrian network. Since ADR-0024's
2026-08-11 amendment makes `walking` the default `roadProfile`, **~1.1 s is the realistic warm cost
of one optimize run's matrix**, mmap or not.

---

## Valhalla, assessed properly (§4 of the brief)

Confirmed from primary sources, because it is the only serious alternative and because the answer
turned out to be more favourable than expected.

**Tile-based on-demand is the architecture, not a mode.** From the project's own design writeup:
"**Reduced memory requirements** — a connected graph can take up a lot of space in memory. By
cutting the graph into a tiled structure you more easily impose limits on how much of the graph
resides in memory at any one time"
([why-tiles.md](https://github.com/valhalla/valhalla/blob/3.8.3/docs/docs/concepts/why-tiles.md)),
and from the README's founding goals: "Tiled hierarchical data structure. Should allow users to
have a small memory footprint on memory constrained devices"
([README](https://github.com/valhalla/valhalla/blob/3.8.3/README.md#L47)). Tiles are three
hierarchy levels — 4° highway, 1° arterial, 0.25° local
([tiles.md](https://github.com/valhalla/valhalla/blob/3.8.3/docs/docs/concepts/tiles.md)).

**Only touched tiles are held, and it is genuinely mmap-backed.** With `mjolnir.tile_extract`
pointing at a `tiles.tar`, `GraphReader::GetGraphTile` looks in the cache, then constructs the tile
directly from the memory-mapped archive — "This initializes the tile from mmap" — and stores it in
the cache
([`graphreader.cc#L594-L615`](https://github.com/valhalla/valhalla/blob/3.8.3/src/baldr/graphreader.cc#L594-L615)).
Headers can be read "straight out of the mmapped extract, without constructing or caching the tile"
([`graphreader.cc#L682`](https://github.com/valhalla/valhalla/blob/3.8.3/src/baldr/graphreader.cc#L682)).

**Cache config, with one trap.** `mjolnir.max_cache_size` defaults to `1000000000` — and its own
documentation string is **"Number of bytes per thread used to store tile data in memory"**
([`valhalla_build_config#L123`, `#L463`](https://github.com/valhalla/valhalla/blob/3.8.3/scripts/valhalla_build_config#L123)).
*Per thread.* Three eviction policies are selectable: `use_lru_mem_cache`
(`lru_mem_cache_hard_control` for a strict never-overcommit limit), `use_simple_mem_cache`, and the
default flat cache
([`graphreader.cc#L438-L477`](https://github.com/valhalla/valhalla/blob/3.8.3/src/baldr/graphreader.cc#L438-L477)).
`global_synchronized_cache` shares one cache across threads. This is a real, bounded, configurable
memory ceiling — which is more than OSRM offers under `--mmap`, where the bound is the kernel's.

**It serves both question shapes, and — the finding that changes the cost estimate — it can emit
them in OSRM's own format.**

- Matrix: `GET /sources_to_targets?json={…}` with `sources`, `targets`, `costing` (`pedestrian`,
  `auto`, `bicycle`), `null` for unfound connections
  ([matrix.md](https://github.com/valhalla/valhalla/blob/3.8.3/docs/docs/api/matrix.md)).
- Turn-by-turn: `/route` with maneuvers and a shape; `format` accepts `json | gpx | **osrm** | pbf`,
  and with `format: osrm`, `shape_format` accepts `polyline6 | polyline5 | **geojson** | no_shape`
  ([route api-reference.md#L315-L316](https://github.com/valhalla/valhalla/blob/3.8.3/docs/docs/api/route/api-reference.md#L315-L316)).
- **The OSRM-format matrix serializer emits `code: "Ok"`, `sources`/`destinations` as OSRM waypoint
  objects, and row-major `durations` / `distances` arrays**
  ([`matrix_serializer.cc#L71-L110`](https://github.com/valhalla/valhalla/blob/3.8.3/src/tyr/matrix_serializer.cc#L71-L110)),
  and those waypoint objects carry `distance` = "distance in meters from the input location to the
  nearest point on the road used in the route"
  ([`serializers.cc#L300-L314`](https://github.com/valhalla/valhalla/blob/3.8.3/src/tyr/serializers.cc#L300-L314)).
  That is the snap distance ADR-0024's 2026-08-11 decline mechanism depends on, in the same field
  and the same units.
- **Route steps carry a `mode` string drawn from `ferry | driving | walking | cycling | transit`**
  ([`route_serializer_osrm.cc#L1624-L1650`](https://github.com/valhalla/valhalla/blob/3.8.3/src/tyr/route_serializer_osrm.cc#L1624-L1650)),
  so `groupSteps` / `RUN_KIND_FOR_OSRM_MODE` in `osrmProvider.ts` would need one new key
  (`transit`) and nothing else.

**Realistic migration cost, given `osrmProvider.ts`'s shape.** Smaller than it looks, and
concentrated in one place:

- **Response parsing: essentially unchanged.** `OsrmTableResponse`, `OsrmRouteResponse`,
  `OsrmWaypoint`, `isSnapAcceptable`, `groupSteps`, `mergeGeometry`, `pathForRun` all survive.
- **Request building: rewritten.** OSRM's path-segment URL (`/table/v1/{profile}/{lng},{lat};…`)
  becomes a JSON query parameter, and the coordinate key is `lon`, not `lng` — the module doc's
  coordinate-order warning gains a second trap.
- **`PROFILE_FOR_KIND` and `baseUrlFor` collapse into a request field.** Valhalla is *one* process
  serving all costings, so `walking`/`driving` stop being two containers and two env vars and
  become `"costing": "pedestrian" | "auto"`. **This makes PR 3b's `roadProfile` selector cheaper,
  not more expensive** — it is one request field instead of a service-selection decision.
- **Three stock service limits must be raised in config before a 60-point trip works at all:**
  `pedestrian.max_locations` is 50 (< 60), `max_matrix_location_pairs` is 2500 (< 3600), and
  `pedestrian.max_matrix_distance` is 200,000 m — a Tokyo–Kyoto walking matrix is ~370 km beeline
  and would be rejected outright
  ([`valhalla_build_config#L332-L338`](https://github.com/valhalla/valhalla/blob/3.8.3/scripts/valhalla_build_config#L332-L338)).
  Self-hosted, so these are edits, not walls — but they are edits nobody would think to make until
  the first 60-point trip fails.
- **A second graph-build pipeline**, replacing `osrm-extract/partition/customize` with
  `valhalla_build_tiles` + config generation, plus re-calibrating pedestrian speed assumptions that
  `osrm-viability-149.md` §1 documented for `foot.lua`.

**Maintained official images exist**, multi-arch including `ubuntu-24.04-arm`:
`ghcr.io/valhalla/valhalla` (base) and `ghcr.io/valhalla/valhalla-scripted` (env-var-configured
tile build), published by the project's own workflow
([docker/README.md](https://github.com/valhalla/valhalla/blob/3.8.3/docker/README.md),
[docker-build.yml](https://github.com/valhalla/valhalla/blob/3.8.3/.github/workflows/docker-build.yml)).

**Disk footprint for equivalent Japan coverage: unverified.** I found no first-party figure for
tile sizes at any extract size. It must be measured.

**Where Valhalla is the right answer to a different question.** Not "how do we fit in 8.3 GB" —
`--mmap` answers that for one word. It is the right answer if we ever want (a) one process serving
every costing instead of one container per profile, (b) a *bounded* rather than kernel-managed
memory ceiling, (c) multimodal costing, which ADR-0022 deferred and which Valhalla has natively, or
(d) elevation-aware pedestrian costing, which is Prototype B's open question and which
`osrm-viability-149.md` §1 records `foot.lua` as lacking. Any of those is a real reason. Memory
alone is not.

## GraphHopper (§5 of the brief) — disqualified on a harder ground than the ToS

`hosted-routing-alternatives.md` disqualified GraphHopper on a *narrow reading of a silence* in its
terms, and flagged that as its one judgement call. That judgement is no longer load-bearing.

**The Matrix API is not in the open-source project.** The web bundle ships
`RouteResource`, `IsochroneResource`, `MapMatchingResource`, `NearestResource`, `SPTResource`,
`MVTResource`, `PtRouteResource`, `PtIsochroneResource`, `PtMVTResource`, `I18NResource`,
`InfoResource`, `HealthCheckResource` — and no matrix resource. Every `Matrix*` class in the
repository lives under `client-hc/`
(`GHMatrixSyncRequester`, `GHMatrixBatchRequester`, `GraphHopperMatrixWeb`, `MatrixResponse`),
which is an HTTP **client** for the hosted GraphHopper Directions API. The feature request
[#131, "Distance matrix (Origin / Destination)"](https://github.com/graphhopper/graphhopper/issues/131),
has been **open since 2013-12-11** and is still open. Self-hosting GraphHopper therefore cannot
answer ADR-0024 §2's matrix at all, at any price.

**Its memory config is nonetheless the cleanest of the three, for the record.**
`graph.dataaccess.default_type: RAM_STORE` is the shipped default, commented "use RAM_STORE for
well equipped servers (default and recommended)"
([config-example.yml#L221-L222](https://github.com/graphhopper/graphhopper/blob/11.0/config-example.yml#L221)),
with `MMAP` and `MMAP_RO` — "Read-only memory mapped DA object" — as alternatives
([`DAType.java#L41-L55`](https://github.com/graphhopper/graphhopper/blob/11.0/core/src/main/java/com/graphhopper/storage/DAType.java#L41-L55)).
The deploy guide quantifies the trade in the same terms OSRM's maintainers do: planet import needs
"~60GB RAM … If you can accept much slower import times (3 days!) this can be reduced to 31GB RAM
when you set `datareader.dataaccess=MMAP`"
([deploy.md](https://github.com/graphhopper/graphhopper/blob/11.0/docs/core/deploy.md)). Same
architecture, same knob, same conclusion — mmap is the memory-for-latency dial across all three
engines.

Turn-by-turn with geometry is available (`RouteResource`, `instructions`, `points_encoded=false`
for GeoJSON). It does not matter; without a matrix, the provider cannot exist under ADR-0024 §2.

---

## What the docs claim vs. what I measured

Kept separate deliberately, because the two disagree in one direction and agree in another.

| claim | source | measured here |
| --- | --- | --- |
| Default `osrm-routed` RAM ≈ size of the output datafiles | OSRM wiki | **Confirmed exactly.** Predicted 5.620 GiB from the file lists; measured RSS 5.661 GiB |
| `--mmap` uses "no additional memory" | `routed.cpp` help text | **Confirmed in kind, not in letter.** 76 MiB at rest; 649 MiB after two 60×60 matrices — it is page cache, which is the point |
| `--mmap` costs performance | `danpat` (#5242), `mjjbell` (#6089) | **Confirmed for cold access only.** +0.58 s on a first 60×60; +0.44 s on a first cross-region route; **no measurable warm penalty** |
| mmap over virtiofs may fail with `ENODEV` (`MAP_SHARED`) | docker/sbx-releases#55 (Windows) | **Not reproduced on macOS/Docker Desktop.** Mapped and served correctly |
| mmap page-fault storms are tunable via block-device readahead | OSRM #7618 | **Not applicable.** No such knob for virtiofs. Untested whether it would ever be needed here |
| `ROUTE_GEOMETRY` disables waypoints | OSRM wiki, PR #6666 | **Not tested.** Ruled out on reading; the size ceiling (§1) made testing pointless |

---

## What I could not verify

Stated rather than filled in.

- **Whether `--mmap` holds up under sustained concurrent load.** Every measurement above is
  sequential, single-client, on an otherwise idle machine. That happens to match the workload
  (one user, one optimize run at a time), but it is not a load test, and OSRM #7618's failure mode
  only appears under traffic.
- **Whether the page cache stays warm across a realistic session.** The measurements show warm and
  cold; they do not show how quickly the VM evicts our pages when other containers or the host are
  busy. A user who optimizes twice an hour may pay the cold penalty every time. **This is the
  single most useful follow-up measurement** and it is cheap: `docker stats` plus a timed `table`
  request, sampled hourly across a real working day.
- **Whether `.osrm.turn_penalties_index` (928 MB across both profiles) can be deleted.** It is in
  neither loaded-file list, which is suggestive, not conclusive. The test is the one
  `build-osrm-graphs.sh:93-95` already documents: move it aside, restart, re-query `/table` and
  `/route?steps=true`, compare output.
- **Why the connectivity checksum in `hint` differs between the two allocators.** Observed
  (§8), harmless for us, unexplained. If hints are ever sent — they are a legitimate latency
  optimization for repeated queries on the same coordinates, which is exactly what re-optimize
  does — this needs understanding first.
- **Valhalla's tile disk footprint and RSS for Kantō+Kansai+Chūbu.** No first-party figure exists
  at any extract size that I could find. The `nilsnolde` remark "you can run the whole world on a
  few GB" is a maintainer's offhand comparison in an OSRM issue, not a published benchmark. Any
  Valhalla decision needs a measured build first — roughly a day, not a research task.
- **Whether Valhalla's `format: osrm` route output is faithful enough for `describeJourney` in
  practice.** I read the serializer and confirmed the fields; I did not run it. The `mode`
  vocabulary and the waypoint `distance` are the two that matter and both are in the source.
- **Whether Docker Desktop's virtiofs uses DAX.** The virtio-fs project calls DAX experimental and
  Docker's settings documentation does not mention it. I could not find a first-party Docker
  statement either way. The measurements make this academic for now.
- **Whether `--algorithm ch` would mmap better than MLD.** The argument in §2 (CH's hot structure
  is `.osrm.hsgr`, MLD's is the 3.26 GB `.osrm.cell_metrics`) is reasoning from `TheMarex`'s
  statement about MLD's access pattern, not a measurement. Testing it costs a full re-preprocess,
  and `osrm-viability-149.md` §1's reasons for MLD are unaffected.
- **Any macOS-specific report of virtiofs `MAP_SHARED` behaviour.** I searched `docker/for-mac`
  and found nothing on mmap over virtiofs. Absence of reports is not evidence of correctness; my
  own measurement is.

---

## Ranked options

### 1. Add `--mmap` to both `osrm-routed` commands — **recommended**

- **Cost:** one word per line in `docker-compose.yml`, plus a comment explaining why (the same
  three-line style the file already uses). No code change, no rebuild, no re-preprocess. The graphs
  on disk are already correct.
- **Risk:** low, and characterized rather than assumed. Cold-start and cold-region latency
  (+0.4–0.7 s, one-off per region per container lifetime); an untested sustained-concurrency
  profile; a page-fault amplification failure mode that is real in production elsewhere and whose
  usual remedy is unavailable under virtiofs. All three are reversible by deleting the word.
- **Forecloses:** nothing. It does not touch the registry, the provider, the decline mechanism, the
  Extract, the profile split, or the ADR-0024 §4 composition. It is the only option on this list
  with an empty forecloses row.
- **Opens:** a materially larger Extract. Serving memory stops scaling with graph size, so
  ADR-0024's "coverage grows by extending the Extract" becomes bounded by build memory alone —
  which `scripts/transfer-osrm-graphs.sh` already exists to route around. Nationwide Japan becomes
  a build problem, not a serving problem.

### 2. Also delete the unloaded files still on disk — **do after #1, independently**

- **Cost:** re-run the prune that `build-osrm-graphs.sh:102-104` already intends (it did not run on
  the current build: `road.osm.pbf`, `.ebg`, `.enw`, `.cnbg`, `.cnbg_to_ebg` are all still there),
  and *investigate* `.osrm.turn_penalties_index` with the move-aside test.
- **Risk:** low for the five the script names (already reasoned about in-repo); **unverified** for
  `turn_penalties_index`. Recovering from a wrong deletion is a full rebuild.
- **Recovers:** ~2.4 GB (foot) + ~1.8 GB (car) for the five, plus 928 MB if the index turns out to
  be droppable. **Disk only — this does not help the OOM at all.**
- **Forecloses:** re-running `osrm-customize` alone, which the script's own comment already notes is
  gone once `.ebg` is pruned.

### 3. Raise the Docker Desktop memory allocation — **do not; it is a ceiling, not a fix**

- **Cost:** free, a settings toggle.
- **Risk:** 11.39 GiB of graph plus VROOM plus `next dev` on a 16 GB host leaves macOS under 4 GB.
  It would probably work and it would be miserable.
- **Forecloses:** nothing structurally, but it re-establishes the assumption `--mmap` removes —
  that serving memory scales with Extract size — and so quietly re-caps how far coverage can grow.
  ADR-0024's 2026-08-10 amendment already listed this as lever 1 *for builds*; using it for serving
  is a different and worse trade.

### 4. `osrm-datastore` / `--shared-memory` — **no**

- **Cost:** a third container or an init step, `--dataset-name` per graph, coupled IPC namespaces
  and `/dev/shm` between containers, and a lock-file lifecycle with documented failure modes
  (`--remove-locks`, `--spring-clean`).
- **Benefit:** **zero.** Two different datasets means two copies (§4).
- **Forecloses:** the current property that each container is independent and restartable alone.

### 5. `--disable-feature-dataset` — **no**

- **Cost:** a flag.
- **Benefit:** 0.28–0.44 GiB, ~6%.
- **Forecloses:** ADR-0024 §6's shift decomposition (`ROUTE_STEPS` breaks `steps=true`) and the
  2026-08-11 out-of-Extract decline mechanism (`ROUTE_GEOMETRY` implies `skip_waypoints=true`).
  It converts an honest provider into a lying one to save 6%.

### 6. Per-region graphs with dispatch in `osrmProvider` — **no; already rejected, now confirmed**

- **Cost:** a region-to-service map in the provider, N×2 containers, and a routing decision pushed
  into the Facts layer.
- **Benefit:** build memory scales with the largest region rather than the total — a real win, and
  the only lever that removes rather than raises build pressure. `--mmap` gets the *serving* win
  without paying this.
- **Forecloses:** every cross-region road cell. Tokyo→Kyoto driving becomes unanswerable, and
  ADR-0024's 2026-08-10 amendment already worked through why that entangles with the
  profile-selection question. Confirmed from upstream: merging pre-`osrm-extract` is the documented
  pattern (§6), and there is no cross-extract routing to fall back on.

### 7. Migrate to Valhalla — **no, for this problem; keep for a different one**

- **Cost:** a new build pipeline, new config with three stock service limits that must be raised
  before a 60-point trip works, new pedestrian-speed calibration, a rewrite of `osrmProvider`'s
  request builders (response parsers largely survive via `format: osrm`), and an unmeasured disk
  footprint.
- **Risk:** moderate and mostly known. The architecture is genuinely what the user described, the
  memory ceiling is explicitly configurable, official arm64 images exist.
- **Forecloses:** little, and it *opens* several doors — one process for all costings (which
  simplifies PR 3b's `roadProfile`), a bounded rather than kernel-managed cache, native multimodal
  costing that ADR-0022 deferred, and elevation-aware pedestrian costing that Prototype B wants.
- **Why not now:** it spends a week to buy a property that one word buys today, and it re-opens
  ADR-0024 §4's decline mechanism and §6's decomposition for re-verification. **Revisit when the
  driver is multimodal costing or pedestrian elevation — not when the driver is memory.**

### 8. GraphHopper — **dead**

No matrix endpoint in the open-source project; [#131](https://github.com/graphhopper/graphhopper/issues/131)
open since 2013. ADR-0024 §2 requires a matrix. Nothing else about it matters.
