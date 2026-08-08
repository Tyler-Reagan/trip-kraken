# ADR-0025: The app stays a BFF over HTTP services; what VROOM and OSRM change is where two upstream services run, not the shape of the deployment

- **Status:** Accepted
- **Date:** 2026-08-08
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0023 (VROOM is the Decision layer), ADR-0024 (OSRM is the primary road
  Facts source)
- **Note:** Decided while grilling PR 2's infrastructure scope. An earlier draft of this ADR argued
  that four containers made the application "not serverless-shaped." That argument was wrong and is
  not preserved: the draft was never pushed, so there is no published decision to supersede. The
  correction is recorded here because the wrong version's conclusion and the right version's
  conclusion happen to coincide, and a future reader deserves to know the conclusion rests on the
  second argument rather than the first.

## Context

ADR-0023 and ADR-0024 introduce the application's first dependency on software we run ourselves: a
VROOM solver, and one or more `osrm-routed` instances serving graphs compiled offline from an OSM
extract. ADR-0023 already recorded that `solve()` "gains an infrastructure dependency" and that an
unconfigured machine must fail loudly. What it did not settle is what that implies for deployment.

It is tempting to read "we now run containers" as "this application can no longer be hosted the way
Next.js applications are hosted." That reading is wrong, and naming why is the point of this ADR.

**`src/lib` already talks to routing and place services over HTTP.** Google Places and Google Routes
are upstream HTTP services with API keys, called from server-side code, returning JSON. VROOM and
OSRM are the same shape. The only difference is who operates them. From the application's side of
the boundary there is no architectural distinction between "an HTTP service Google runs" and "an
HTTP service we run" — same client code, same failure modes, same configuration mechanism.

ADR-0024 §2 is what preserves this. Because the Facts layer always materializes the matrix itself
rather than letting VROOM query the router, there is no shared state, no co-location requirement,
and no service-to-service link to keep alive. Every edge in the system is a plain request/response
between the app and one upstream.

So the true constraint is narrow and specific: **`osrm-routed` and VROOM are long-lived processes
that memory-map multi-gigabyte graphs and take tens of seconds to become ready.** They cannot run
*as* serverless functions. They can run anywhere that runs a container, and the application that
calls them can deploy anywhere it could have deployed before.

Two things genuinely do block hosting this application today, and neither is caused by this work:
authentication does not exist, and SQLite lives on the app's own disk. The README has recorded both
as caveats since long before VROOM was considered.

## Decision

**We will treat the application as a backend-for-frontend over HTTP services, and treat VROOM and
OSRM as two more upstream services alongside Google.** The deployment question they raise is
scoped to "where do those two services run," and today the answer is "the developer's machine,
because there are no users."

Concretely:

1. **No architectural accommodation is made for self-hosting.** No service mesh, no co-location
   assumption, no shared volume between the app and the routing services, no in-process embedding.
   Configuration is a URL per service, exactly as an API key is configuration for Google.
2. **The compose file is a development convenience, not the deployment.** It exists so one machine
   can run everything. It does not describe production and should not grow features that imply it
   does.
3. **Container hosting is deliberately undecided.** Fly.io, Railway, a VPS, or a managed container
   service would all serve; picking one now would be choosing without a requirement. What is
   decided is that the choice is *separable* from where the Next.js app runs.
4. **Graph scope is sized to the machine that builds it.** A regional extract is the default because
   the binding constraint is one developer's Docker memory allocation. That constraint is a property
   of today's host, not of the architecture, and lifts when a real host is chosen.
5. **Degradation outside that scope stays honest.** ADR-0024 §4's composition already answers cells
   the road graph cannot: they become `straightLine`. We do not add coverage machinery to compensate
   for a deliberately small graph.

**What would have to be true to host this**, recorded while the reasoning is live: an auth layer;
SQLite replaced or given durable storage, since a single file on the app's own disk does not survive
a hosted lifecycle; a container host for the routing services; and a graph either built on a machine
sized for the target region or built once and distributed as a volume rather than rebuilt per
environment. Only the third is attributable to this work.

## Alternatives considered

- **Claim the application is no longer serverless-shaped and design around that** — the earlier
  draft's position. Rejected because it is false, and expensively so: it would justify co-locating
  the app with the routing services, which throws away ADR-0024 §2's clean HTTP boundary in exchange
  for nothing. The containers not fitting in a function is a fact about the containers, not about
  the application that calls them.
- **Design v2 for a hosted deployment now** — registry-published images, environment-scoped
  configuration, a graph built in CI and shipped as a volume. Rejected as building for a requirement
  that does not exist, and front-loading the most expensive parts to serve nobody. The auth gap
  means the result still could not be exposed publicly.
- **Avoid the dependency instead, by using hosted routing providers.** Researched and rejected on the
  evidence — `docs/research/hosted-routing-alternatives.md`. The project's standing preference is to
  wrap economical third-party providers and build only the genuine gap, so this was the alternative
  that most deserved testing. It fails on licence rather than price: every hosted matrix API but one
  forbids the server-side materialization of results that ADR-0024 §2 requires. Self-hosting is not
  us over-building; it is the only arrangement whose terms permit the architecture. The one provider
  that passes, OpenRouteService, is a supplement worth adding to the registry rather than a
  replacement for the graph.
- **Say nothing until deployment is real.** Rejected: the wrong inference is cheap to make and
  expensive to unmake. A future reader finding a compose file with no rationale is most likely to
  conclude the containers are an oversight to be cleaned up, or that the app must ship beside them.

## Consequences

- **The app never assumes co-location.** Any code that reaches VROOM or OSRM does so by configured
  URL and must tolerate that URL pointing somewhere else entirely. This is a constraint on PR 3.
- **"It works on my machine" is the acceptance bar for the development environment**, stated rather
  than apologised for. Verification is a script a person runs, not a job a pipeline runs.
- **The README gains an environment section** covering the compose services, the graph build, and
  the service URLs. Until a host is chosen, it is the only deployment documentation there is.
- **A second developer is not free.** Onboarding means building the routing services and their
  graphs on their own hardware — the strongest practical argument for the hosted alternative under
  research.
- **This ADR is where a reversal starts.** When hosting becomes real, the "what would have to be
  true" list is the agenda.
- **ADR-0024's "plus CI" consequence is withdrawn** in its 2026-08-07 amendment: CI presupposes
  something to gate.
