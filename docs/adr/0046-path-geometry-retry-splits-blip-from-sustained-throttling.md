# ADR-0046: Automatic path-geometry retry stays a short blip window; a sustained failure hands off to a person

- **Status:** Accepted
- **Date:** 2026-09-11
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0042 (MapKit's own throttle-retry-with-backoff and its bounded, globally-paced
  concurrency), ADR-0043 (trip-less path-geometry endpoint, the server half `CompositeGeometryProvider`
  reconciles against)
- **Note:** Numbered 0046, not 0044/0045 — both are already referenced throughout
  `swift/TripKrakenKit`/`swift/TripKrakenApp` (on-device MapKit search/enrichment; the trip-less optimize
  endpoint) but neither file exists in `docs/adr/`. Pre-existing gap, not created or fixed here.

## Context

Reported symptom: a large trip's map sits at "Calculating routes (N left)…" for what reads as a hang.
Traced the actual mechanism, not just the symptom:

`MapKitGeometryProvider.routeWithRetry` (ADR-0042) retries a `.throttled` `MKDirections` response up to
`maxRetries` (3) times with doubling backoff (2s → 4s → 8s, worst case ~14s), entirely inside one
`geometry(for:)` call. Separately, `PathGeometryCache.fetch` wraps *every* provider call — both the
on-device and server halves, composed via `CompositeGeometryProvider` — in its own round-based retry: up
to `maxRetryRounds` (5) rounds at a fixed `retryDelay` of 4s.

Each loop was reasoned through for a different failure shape:

- MapKitGeometryProvider's retry exists for a `.throttled` response specifically — Apple's real,
  undocumented on-device rate limit sitting underneath the 60-second sliding window `throttlePace()`
  already paces requests against *preventively*. A `.throttled` response means this exact attempt got
  bounced anyway; a short, second-scale backoff is a reasonable attempt to ride out a momentary burst.
  This is deliberately tested (`MapKitGeometryProviderTests.swift`'s "throttling is retried with backoff,
  then succeeds" and "exhausting retries under sustained throttling marks the pair for retry, not
  failure").
- `PathGeometryCache`'s round-based retry exists for the composite/HTTP side's own outages —
  `CompositeGeometryProvider.attempt()` converts a thrown error (the dev server not reachable yet,
  `NSURLErrorDomain -1004`, a genuine network blip) into "retry the whole batch." This session traced
  exactly that failure mode directly in `dev.log` earlier.

Composing the two providers means a single pair can now hit both, unintentionally. A pair still throttled
after MapKit's own retry comes back via `retryIndices`; `PathGeometryCache.fetch` treats that identically
to "the whole batch failed" and re-invokes the entire provider chain fresh — which re-runs MapKit's full
3-attempt/~14s-worst-case backoff again, for up to 5 outer rounds. Worst case: `5 × (14s + 4s) ≈ 90
seconds` for one stubborn pair. On a 16-day trip with a correspondingly large total pair count — exactly
the scenario ADR-0042's own doc comment named as this design's accepted risk — a handful of such pairs is
what presents as "hanging at N left."

A sharper problem underneath the arithmetic: `PathGeometryCache`'s 4-second retry delay is tuned for the
composite-outage failure mode (recoverable within single-digit seconds) but is essentially inert against
MapKit's actual constraint — a 60-second sliding window. Five rounds at 4 seconds spans only ~20 real
seconds, nowhere near enough for a sustained rate-limit window to clear. The outer loop was, without
anyone deciding this, retrying against a clock it cannot realistically outlast.

This session also added a person-facing escape hatch: a per-leg retry row in the sidebar
(`GeometryGapRow`), and `PathGeometryCache.retry(pair:...)`, an explicit bypass of `ensure`'s "already
held" skip. That retry is a no-op while the pair is still `inFlight` — which, given the ~90-second
compounding above, is the moment someone is *most* likely to reach for the button.

## Decision

**Automatic retry stays cheap and short — long enough to smooth a genuine blip, not long enough to try
to outlast a sustained rate-limit window it cannot win against anyway. Anything that survives it is
handed to a person, not a longer background loop.**

`PathGeometryCache.maxRetryRounds` drops from 5 to 2 (an automatic window of roughly one provider call's
own worst case plus ~4-8 extra seconds, instead of ~90). `MapKitGeometryProvider`'s own throttle-specific
retry-with-backoff is unchanged — it stays the one place that reacts to an actual `.throttled` response,
since it already has context (this specific attempt just got bounced) a generic outer loop doesn't.

This is an explicit ownership split, not a bare tuning change: a provider retries a single attempt's own
transient failure; the cache retries a whole-request outage; neither one tries to wait out a rate-limit
window measured in tens of seconds. A person doing something else and coming back later already supplies
that real wall-clock gap for free — which is exactly what the sidebar's manual retry is for, and why it
was worth building before this ADR, not after.

## Alternatives considered

- **Remove MapKitGeometryProvider's internal throttle retry; push everything to `PathGeometryCache`.**
  Rejected: reverses a deliberately tested decision, and makes the *common* case (a one-off throttle
  bounce, immediately recoverable) pay the outer loop's full round delay to punish the *rare* sustained
  case.
- **Widen `PathGeometryCache`'s retryDelay to actually span MapKit's 60-second window** (e.g. 5 rounds ×
  15s ≈ 75s). Rejected: makes the hang honest instead of shrinking it. A person still stares at "N left"
  for over a minute, and it ignores the manual-retry escape hatch already built.
- **Bring back the periodic background sweep from earlier this session**, tuned to a longer interval.
  Rejected — re-opens a decision the user already made explicitly (manual retry only), and doesn't touch
  the compounding math; it would just poll into the same wall on a slower cadence.
- **Leave both loops as-is; only add the manual retry.** Rejected: doesn't fix the reported symptom. The
  manual retry's usefulness is gated on the automatic window being short enough that tapping it isn't
  usually a silent no-op.

## Consequences

- **Worst case per stubborn pair drops from ~90s to roughly ~20-25s**, and "Calculating routes (N left)"
  should settle noticeably faster on a large trip.
- **The manual retry button's dead/no-op window shrinks accordingly.** It's still possible to tap retry
  while a pair is mid-automatic-retry (a no-op, guarded by `inFlight`), but that window is now short
  enough to be a minor rough edge rather than the most likely moment someone reaches for the button.
- **`PathGeometryCache`'s retry rounds and `MapKitGeometryProvider`'s throttle retry now have an explicit,
  stated division of labor.** A future reader tuning either number should know which failure mode it
  covers before changing it.
- **Not addressed here, left as a smaller follow-up:** `GeometryGapRow` can't currently distinguish "never
  asked" from "an automatic retry round is quietly still running" — both show the same "Route not resolved
  yet" state. Worth a small visual difference (e.g. muting the retry control while genuinely in flight)
  as a follow-up; not required for this decision to be correct on its own.
- **Confirms, rather than changes, ADR-0042's `throttlePace`/`maxConcurrency` design** — the sliding-window
  request-start limiter and bounded concurrency are unaffected; this ADR only narrows how long a *result*
  is retried after the request itself already went out.
