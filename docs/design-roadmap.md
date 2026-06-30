# Design Re-establishment Roadmap

A living record of the design work surfaced by the first impeccable critique of the
trip-planning surface, so present and deferred work is not forgotten between when it is
identified and when it is executed. Update status as work lands; do not delete deferred
items until they are done or consciously dropped.

**Sources**
- Critique snapshot: `.impeccable/critique/2026-06-30T06-11-10Z__src-components-tripclient-tsx.md` (score 22/40)
- Strategy: `PRODUCT.md` — esp. principle 4 (surface hierarchy) and the Things 3 / Felt / Linear anchors

## Decisions locked

- **Ambition: re-establish the visual language.** Theme (dark vs light), accent, type,
  iconography, and the day-hue palette are all open and designed up from the PRODUCT.md
  principles — not evolved in place. No users yet, so disruption is free.
- **Surface hierarchy (PRODUCT.md §4).** Itinerary/timeline is first-class; the map is its
  companion in service of it ("first-and-a-half"); the Manifest is a second-class staging
  area. The current three-equal-peer-tabs IA contradicts this and is the structural target.
- **Execution order: b → a → c.** Cheap connective wins first, the big identity swing last.
- **Scope this pass: the three P1s only.** P2s and minors are deferred but tracked below.

## Execution plan (P1s, ordered)

### Phase b — Day-color throughline  ·  status: merged (#75)
The 14-hue per-day color system exists but lives only on the map. Thread each day's color
through the schedule so the timeline and map read as one system.
- DayCard header ("Day N"), the day-filter chips, and the stop-number badges adopt the
  day's color instead of generic brand-green.
- Entry point: `$impeccable colorize`.
- **Dependency for Phase c:** the *hues themselves* may be retuned when the language is
  re-established. What's durable here is the plumbing (color flows from a single per-day
  source into header + chip + badge + map). Phase c must sweep back through this.
- **Merged 2026-06-30 (#75).**

### Phase a — Itinerary-first structure  ·  status: implemented (branch `feat/itinerary-first-shell`; visual confirmation + review pending)
Kill the three-equal-peer-tab model. Make the itinerary the surface the user lives in, with
the map as a bound companion and the Manifest as a staging step.
- Presentation (persistent split, expandable full-screen map, minimized rail, etc.) is an
  open design question — resolve it in the shape pass, not by assumption. A full-screen or
  minimized map is a focus state of the companion, not the map becoming first-class.
- Selecting a stop in the itinerary should reflect live on the map (and vice versa).
- Entry point: `$impeccable shape` (structural/IA change — plan before building).

### Phase c — Visual identity re-establishment  ·  status: not started
Escape the anonymous-dark-Tailwind look; design the language toward the Things 3 / Felt /
Linear feel per PRODUCT.md.
- Real type scale + weight strategy so size/space carry hierarchy (not gray value alone).
- One coherent icon set replacing the emoji/SVG mix (🐙🏨🚆🗺️ + SearchIcon/TrashIcon).
- Deliberately committed accent and theme decision; retune the day-hue palette as a system.
- Drop the `uppercase tracking-wide` section eyebrows in the Manifest.
- Entry points: `$impeccable shape` (language direction) → `$impeccable typeset` → `$impeccable colorize`.
- **Must revisit Phases b and a** with the re-established tokens.

## Deferred backlog (tracked, not this pass)

### P2 — Hover-only controls have no touch path
Row action buttons (`opacity-0 group-hover:opacity-100`) and map tooltips are hover-gated —
hides affordances and breaks the "bank iOS portability for free" principle. Make actions
always-visible or focus/tap-revealed; give the map a tap-driven info path. → `$impeccable adapt`

### P2 — Inconsistent selection language + panel construction
Three active-state treatments (tabs = green fill, day filters = black/white inversion, nearby
filters = green outline); two close glyphs (× / ✕); two side panels built differently
(Inspector uses `.card`, NearbyDrawer hand-rolled). Unify: one selected-state token, one close
icon, one shared panel shell. → `$impeccable polish`

### Minor observations
- `text-gray-300` italic "Add label…" placeholder is near-invisible.
- Inspector + Nearby can both open at once, squeezing the main column to a sliver.
- Nearby drawer stacks ~7 control groups in 320px — progressive-disclosure candidate.
- Map click-select, tooltip, and legend are all pointer-only.
- Detector: 4 `gray-on-color` warnings — `text-gray-400/500` on `bg-red-50`
  (`DayCard.tsx:263`, `UnassignedCard.tsx:159`).

### Deferred accessibility (PRODUCT.md — noted, not immediate)
WCAG AA contrast, full keyboard operability, a keyboard alternative to drag-and-drop, and
honoring `prefers-reduced-motion`. Not this pass; no new work should foreclose it.

## Status log

- 2026-06-30 — First critique (22/40). Roadmap created; decisions locked. No code changed yet.
- 2026-06-30 — Phase b implemented on `feat/day-color-throughline`. Extracted the day palette to
  `src/lib/dayColors.ts` (single source for map + timeline); threaded color into DayCard headers
  (dot + neutral label, mirroring the map legend), stop-number badges (filled hue, contrast-picked
  ink/paper text — 6.6:1 worst case), and the day-filter chips (persistent dot + day-tinted active
  state). Brand green stays reserved for actions/selection; day color is wayfinding only. tsc 0,
  tests green, page compiles (200). Visual confirmation of the Itinerary view still pending (the
  day-colored UI is behind the Itinerary tab; SSR defaults to Places). **Merged as #75.**
- 2026-06-30 — Phase a implemented on `feat/itinerary-first-shell`. Replaced the 3-equal-peer-tab
  IA (Places/Itinerary/Map) with a 2-surface switch (`Itinerary` | `Places`); map is no longer a
  peer view. Store: `activeView` → `activeSurface` + `mapShown`/`mapExpanded`. Itinerary is now a
  split — ScheduleView (primary) + a companion rail showing one of Nearby > Inspector > Map by
  priority, with collapse (`Hide map`) and full-bleed (`Expand`) controls; stacks on narrow widths.
  Default landing: Itinerary when a plan exists, else Places. Inspector/NearbyDrawer made width-full
  so the companion column sizes them; MapView gained a `heightClass` prop for the expanded state.
  Partially retires the deferred P2 "two panels squeeze the main column" (companion shows one at a
  time). tsc 0, tests green, fresh-server SSR verified (planned trip lands on Itinerary with day
  colors; empty trip lands on Places; no Map peer tab). Interactive checks (toggles, stop→companion
  swap, drag) pending a browser. Map remounts when toggling companion content — a known perf
  follow-up for polish/Phase c (keep the map mounted under overlays).
