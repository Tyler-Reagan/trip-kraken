# ADR-0038: The client rebuilds as Swift/Apple-native; VROOM, OSRM, and the rail graph stay server-side for now, with full on-device execution as the stated end goal

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0023 (VROOM is the Decision layer), ADR-0024 (OSRM Facts source and
  capability-dispatched registry), ADR-0025 (the app is a BFF over HTTP services), ADR-0027 (Stadia
  basemap)

## Context

The web app (Next.js, React, TypeScript) is where CONTEXT.md's domain model and the routing/
optimization architecture recorded across ADR-0019 through ADR-0037 were built out. The user has
decided to leave that stack: the client becomes a native SwiftUI app for iOS and macOS, not a web
app kept alive behind a native wrapper.

Two different things could be meant by "Apple-native," and they carry very different amounts of
risk:

- **(A)** The client — UI, local persistence, sync — is rebuilt in Swift/SwiftUI, and talks to the
  same VROOM/OSRM/rail-graph services the web app talks to today, over the same HTTP boundary.
- **(B)** The server dependency is eliminated entirely: VROOM's solve and OSRM's road facts run
  on-device, alongside the rail graph, with no backend at all.

These are separable only because ADR-0025 already drew a clean boundary: "`osrm-routed` and VROOM
are long-lived processes... they can run anywhere that runs a container, and the application that
calls them can deploy anywhere it could have deployed before." That statement was written about a
Next.js client; nothing in it depends on the client being a web app rather than a native one. A
Swift client calling the same two upstream HTTP services is architecturally identical to today's
BFF from the services' point of view — only the caller's language changes.

(B) has no such precedent to lean on. VROOM is a self-hosted C++/Boost solver; there is no Apple
framework that performs multi-day vehicle-routing optimization, and no evidence yet that VROOM's
codebase cross-compiles for iOS/macOS without rework. Separately, ADR-0025's own research
(`docs/research/hosted-routing-alternatives.md`) already found that every hosted routing provider
but one forbids server-side materialization of a distance/time matrix — the exact operation VROOM
depends on — which is *why* OSRM is self-hosted today rather than bought. Apple's own routing
(`MKDirections`) is a turn-by-turn request API, not a bulk matrix API, and there is no reason yet to
assume it is licensed for the same kind of materialization; it was not evaluated as part of this
decision because VROOM itself has no on-device story regardless of which service answers road
facts. Committing to (B) now would mean starting client work by gambling an unbounded research spike
against an unproven port, with the whole rebuild blocked behind it.

## Decision

**We will rebuild the client as a Swift/SwiftUI app, targeting iOS and macOS, replacing Next.js,
React, Zustand, dnd-kit, and MapLibre entirely. This is Phase A.**

Concretely:

1. **UI**: SwiftUI, one multiplatform target rather than separate iOS/macOS codebases where
   feasible.
2. **Local persistence**: moves off `better-sqlite3` to an Apple-native store (SwiftData or GRDB —
   left open, to be settled when the persistence layer is actually built rather than pre-decided
   here).
3. **Sync**: moves off Turso to CloudKit. Turso's field-level three-way merge sync (`docs/adr/`
   pending write-up alongside the commit that built it) is the behavior to preserve, not the
   mechanism — CloudKit's own conflict model may or may not need the same shape of merge logic
   re-expressed on top of it.
4. **Maps**: moves off MapLibre/Stadia toward MapKit. This reopens rendering decisions ADR-0027,
   ADR-0029, and ADR-0034 made against MapLibre specifically (custom path-geometry rendering, metro-
   tier styling, client-side station labels). Not resolved here — worth its own ADR once the port
   reaches the map view, the same way the Stadia swap earned ADR-0027 rather than being folded into
   a larger change.
5. **VROOM, OSRM, and the OSM-Japan rail graph stay exactly where ADR-0025 put them** — self-hosted
   HTTP services, unmoved by this decision. The Swift client calls them the way the Next.js
   server-side code does today: by configured URL, tolerant of that URL pointing anywhere.
6. **CONTEXT.md is the spec the Swift port is judged against**, not rewritten for the occasion. The
   domain vocabulary (`Location`, `Path`, `Journey`, `Metro`, `Anchor`, …) is re-expressed as Swift
   types; the concepts do not change because the language did.

**Phase B — eliminating the server dependency entirely, including an on-device VROOM solve — is
recorded here as the accepted long-term direction, not merely a "maybe someday."** It is explicitly
**not started now**. No spike, no proof-of-concept cross-compile, before Phase A reaches feature
parity with the current web app. What would have to be true before Phase B is even attemptable,
recorded while the reasoning is live:

- VROOM's C++/Boost solver builds and runs correctly for arm64 iOS/macOS, including whatever
  threading and memory assumptions its local search makes.
- An on-device-legal source of road-network routing *facts* exists — the same matrix-materialization
  problem ADR-0025's research already found only one hosted provider (OpenRouteService, no
  purchasable tier) passes. Running OSRM's own routing engine on-device, compiled from the same open
  data pipeline that already builds its graphs, is the most likely answer, but this is unresearched.
- The OSM-Japan rail graph ships as bundled or downloadable data the device queries locally, rather
  than a service the client calls.
- App Store review tolerates a bundled compute-heavy solver of this shape and size.

## Alternatives considered

- **Ship a native shell wrapping the existing web app (WebView/Capacitor-style).** Rejected outright
  — this satisfies neither "fully optimized" nor "fully moving to Apple native frameworks." It would
  keep every web dependency this decision exists to remove.
- **Go straight to Phase B.** Rejected for now. It blocks all client-visible progress behind an
  open-ended, unproven C++ port, and reopens a licensing question (server-side matrix
  materialization) that ADR-0025's research already answered once at real cost. Recorded as the
  stated end goal rather than abandoned.
- **Keep the React client live and build a Swift app only as a Phase B research spike.** Rejected —
  does not match "fully moving over to the apple native frameworks." The user wants the client fully
  transitioned now, with the backend transition sequenced after.

## Consequences

- **Fly.io, Docker, VROOM, and OSRM infrastructure are unaffected by this ADR.** Nothing about
  ADR-0024's registry, ADR-0025's deployment posture, or the compose file changes.
- **The client/service HTTP boundary must stay as clean as ADR-0025 already made it, and arguably
  cleaner.** Phase B's existence as a stated goal means no Phase A shortcut should assume the server
  is always reachable or co-located — a future on-device solve replaces the *caller*, not the
  contract, only if the contract stayed honest.
- **MapKit, SwiftData/GRDB, and CloudKit are named directions, not final decisions.** Each is real
  enough to plan around but earns its own ADR at the point it's actually chosen, matching how
  ADR-0027 handled the basemap swap rather than bundling it into this one.
- **Next.js/React/Zustand/dnd-kit/MapLibre are retired once the Swift client reaches feature
  parity.** This ADR does not set a cutover date or commit to deleting the web client before parity
  exists.
- **Before Phase B is attempted, a follow-up ADR is expected**, evaluating the "what would have to be
  true" list above against actual findings — the same way ADR-0025's "what would have to be true to
  host this" section became the agenda for later work.
