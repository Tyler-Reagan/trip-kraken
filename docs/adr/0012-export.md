# ADR-0012: Export

- **Status:** Accepted
- **Date:** 2026-06-24
- **Supersedes:** —
- **Superseded by:** —
- **Amended by:** ADR-0015 (`Stop`→`Placement`; the plan is day-clustered placements)
- **Constrained by:** ADR-0002 (domain model), ADR-0011 (handoff pattern)
- **Mirrors:** ADR-0009 / ADR-0011 (pluggable providers)
- **Note:** Decided in the 2026-06-24 grilling session.

## Context

Export is the north star's final stage (project memory: "export to Notion/Obsidian;
optional persistence"). Like discovery sources, travel cost, and transit, it is a set of
**multiple, volatile targets added over time** — Notion, Obsidian/Markdown, calendar
(iCal), a Google Maps route handoff, raw JSON. That is the same shape the project has
already chosen a pluggable interface for elsewhere (ADR-0003/0004/0009/0011).

## Decision

Export goes through a pluggable **`Exporter` interface**. Ship **Markdown first** — it
needs no auth, serves Obsidian directly, and doubles as a universal copy/paste fallback.
Add other targets as independent exporters:

- **File-artifact exporters** generate a downloadable artifact from the itinerary
  (Markdown, iCal from the day/stop/time data, JSON for portability/backup).
- **Service exporters** push to or deep-link an external service (Notion via its API; a
  Google Maps route handoff reusing ADR-0011's handoff mechanism).

Each exporter reads the domain model (ADR-0002: Trip → Stays → Days → Stops with
Anchors) and is responsible for its own auth/format concerns behind the interface. The
*architecture* is decided now; the *implementation* of any given target may wait — only
Markdown is committed as the first build.

## Alternatives considered

- **Hardcode one or two exports without an interface.** Rejected: each target becomes
  bespoke and the seam is re-derived later; inconsistent with the established pluggable
  pattern.
- **Defer export entirely.** Rejected as a *recording* choice: the north star's final
  stage should be architecturally pinned even if implementation trails. (Build priority
  is still free to trail — only Markdown is committed.)

## Consequences

- An `Exporter` interface is introduced; Markdown is its first implementation. Notion,
  iCal, JSON, and the Google Maps route handoff are contained later additions.
- Exporters depend on the domain model, so they benefit directly from the Lodging/Stay,
  Anchor, and Locked vocabulary (ADR-0002) — e.g. iCal can title days by Stay and place
  timed events from the optimizer's schedule.
- The Google Maps route export is a *handoff*, sharing the ADR-0011 deep-link approach
  rather than rendering a map.
- "Optional database persistence" from the original memory is already satisfied by the
  app's own SQLite store (ADR-0008); export is about *leaving* the app, not persisting
  within it.
