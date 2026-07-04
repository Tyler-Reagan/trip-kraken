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

### Phase a — Itinerary-first structure  ·  status: merged 2026-07-01 (#76)
Kill the three-equal-peer-tab model. Make the itinerary the surface the user lives in, with
the map as a bound companion and the Manifest as a staging step.
- Presentation (persistent split, expandable full-screen map, minimized rail, etc.) is an
  open design question — resolve it in the shape pass, not by assumption. A full-screen or
  minimized map is a focus state of the companion, not the map becoming first-class.
- Selecting a stop in the itinerary should reflect live on the map (and vice versa).
- Entry point: `$impeccable shape` (structural/IA change — plan before building).

### Phase c — Visual identity re-establishment  ·  status: complete (theme, accent, danger, day-hue palette, icon set, type scale, and the kraken mark all decided/landed)
Escape the anonymous-dark-Tailwind look; design the language toward the Things 3 / Felt /
Linear feel per PRODUCT.md.
- **Theme — DECIDED.** Neutral, readable dark + light modes; dark is the baseline, both
  wanted long-term. Base surfaces stay neutral (no thematic tinting); flair is reserved for
  accents/branding/SVG. Token system landed in `globals.css` (CSS vars: `:root` = light,
  `.dark` = dark) + `tailwind.config.ts` (`canvas`/`surface`/`ink`/`sub`/`faint`/`ghost`/
  `line` utilities). See [[feedback_readability_first_theming]].
  - **Component sweep — DONE.** All ~384 hardcoded `dark:gray-*` utilities across 15 files
    migrated to semantic tokens (`bg-surface`, `text-ink`, `text-sub`, `border-line`, ...) via
    the `colorize` pass. `--faint` tuned to clear AA for informational meta text (gray-400 on
    white was ~2.6:1). Only intentional map furniture keeps raw grays (`MapView` marker
    `BASE_COLOR` + the dark map tooltip) — deferred to a later map-layer theming pass. Retired
    the roadmap minor "Add label... placeholder near-invisible" (moved off `ghost`).
- **Accent — DECIDED (decision #2).** One teal/ink family (`brand-*` in
  `tailwind.config.ts`), mode-tuned rather than a flat hex: brighter/more saturated on dark
  surfaces (400/500), deeper on light (600/700). Same hue does CTAs, selection, focus rings,
  and (eventually) the kraken mark — no second accent color. Chosen live against real
  component chrome (`/theme-prototype`) over two flat-color candidates that were rejected
  (a single flat ink read as too quiet in dark mode; ink+coral read as too loud).
- **Danger — DECIDED alongside the accent.** Muted brick-red (`danger-*`), same 11-step
  scale shape as `brand-*`, replacing 9 files' worth of hardcoded stock-Tailwind `red-*`
  utilities. Deliberately desaturated relative to Tailwind's default red so it stays quiet
  next to the teal accent instead of competing with it.
- **Day-hue palette — RETUNED.** `src/lib/dayColors.ts` rebuilt as one 14-hue wheel at a
  fixed HSL saturation/lightness (a designed system, not a grab-bag of mismatched Tailwind
  swatches), with ~30°-wide gaps carved out around the new accent (~178°) and danger (~8°)
  hues. The old palette's `teal-400` (day 11) and `red-400` (day 6) sat close enough to
  those to be confusable with selection/error state — this set can't reproduce that.
- **Icon set — DONE.** Lucide (`lucide-react`). shadcn was considered but it's a
  component-copy system, not an icon library — it just defaults to Lucide internally, so
  installing Lucide directly gets the same icons without adopting shadcn's other primitives
  (which would mean running two design-token systems side by side). Rejected Phosphor
  (decorative weights work against restraint) and Tabler (breadth with no benefit for a
  single-user tool). Replaced across all components: the emoji mix (🏨→`Hotel`, 🚆→
  `TrainFront`, 🗺️→`Map`, plus the unicode `×`/`✕`/`★`/`≡` glyphs → `X`/`Star`/
  `GripVertical`) and the hand-rolled `SearchIcon`/`TrashIcon` (`src/components/icons.tsx`,
  now deleted) → `Search`/`Trash2`. The 🐙 in `layout.tsx` is deliberately untouched — it's
  the kraken brand mark placeholder, not a generic UI icon; see `docs/logo-handoff.md`.
- **Type scale + weight strategy — DECIDED.** Audited in `docs/typography-handoff.md`
  (current sizes/weights and their real usage counts, the Inter-is-generic problem, a
  `text-lg`/`text-xl` class doing double duty for both section headings and unrelated
  close-button tap targets), then decided live against real component shapes on a throwaway
  `/typography-prototype` route (deleted once folded in). IBM Plex Sans replaces Inter
  (`layout.tsx`, `tailwind.config.ts` font families); IBM Plex Mono is reserved for a new
  Numeral role (times, durations, counts, ratings) via `font-mono`. Named role utilities
  (`.text-hero`, `.text-page-title`, `.text-section`, `.text-body`, `.text-meta`,
  `.text-numeral`) landed in `globals.css`: a tight 1.25 ratio with a full weight bump
  (Body medium, headings bold) — chosen over a wider 1.333 ratio and a Fraunces-serif-Hero
  variant, both live-rejected. `.tap-target` splits the close-button hit-target sizing from
  heading size, fixing the `text-lg`/`text-xl` double duty. Applied to `TripClient`,
  `DayCard`, `OptimizeModal`, `AddLocationModal`. Dropped the Manifest's
  `uppercase tracking-wide` section eyebrows onto `.text-meta` — the one other outstanding
  item this bullet used to track.
- **Kraken mark — DECIDED.** A hand-vector "quiet glyph" distillation (a single tentacle
  curl) was tried first and rejected — it read as generic/off-brand at favicon size, not
  recognizably the kraken. Landed instead on **one illustrated mascot asset used everywhere**
  (header, `src/app/icon.png` favicon, `src/app/apple-icon.png`, `public/favicon.ico`),
  recolored to the locked `brand-500` teal, just scaled per context — no separate flat glyph.
  Supersedes the loud/quiet tiered system originally planned; PRODUCT.md → Brand Personality
  updated to match. `docs/logo-handoff.md` and `docs/typography-handoff.md` (both now-resolved
  handoff scaffolding) deleted.
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
- Detector: 4 `gray-on-color` warnings — `text-gray-400/500` on `bg-danger-50`
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
  follow-up for polish/Phase c (keep the map mounted under overlays). **Merged as #76.**
- 2026-07-02 — Phase c theme decision. Prototyped designed-dark vs light on a throwaway
  `/theme-prototype` route; user rejected thematic surface tinting and chose **neutral, readable
  dark + light** (dark baseline, both wanted), flair reserved for accents/branding. Folded the
  winning tokens into `globals.css` (CSS-var token sets for `:root`/`.dark`) + `tailwind.config.ts`
  (semantic color utilities); rewired the shared primitives (`.card`, `.btn-*`, `.input`, body,
  nav) to consume them. Accent left open (#2); brand green is the placeholder. Prototype route
  deleted. Component-tree sweep off `dark:gray-*` pairs still pending.
- 2026-07-03 — Phase c accent/danger/day-hue decided. Compared flat-ink vs ink+coral candidates
  live on `/theme-prototype`; both rejected (flat ink too quiet in dark, ink+coral too loud), then
  landed on a mode-tuned single teal/ink family. Baked into `tailwind.config.ts` (`brand-*`
  brighter/more saturated on dark, deeper on light) and verified against real trip chrome
  (`Re-optimize`, active tab, `Nearby` links, delete-hover). Added a matching `danger-*` scale
  (muted brick-red, same 11-step shape) and replaced hardcoded `red-*` across 9 component files.
  Rebuilt the 14-hue day palette (`src/lib/dayColors.ts`) as one designed hue wheel with gaps
  carved out around the new accent/danger hues, fixing a real collision (old `teal-400`/`red-400`
  day hues read as selection/error state). Chose **Lucide** (`lucide-react`, installed) as the
  icon direction over shadcn's default bundling, Phosphor, and Tabler — not yet wired into
  components. `/theme-prototype` kept (not deleted) as a living status board for Phase c's
  remaining open items; delete once type scale + icon swap land. tsc 0 throughout.
- 2026-07-03 — Phase c `colorize` sweep (via `$impeccable colorize`). Migrated all ~384
  hardcoded `dark:gray-*` utilities across 15 files (`src/components/*` + `src/app/*`) onto the
  semantic tokens; meta-chip rewritten as a clean ink/canvas inversion (`bg-ink text-canvas`).
  Tuned `--faint` in both themes to clear WCAG AA for informational meta text (dark ~4.6:1,
  light ~4.8:1); the "Add label..." placeholder moved off decorative `ghost` onto readable
  `faint`. Remaining raw grays are intentional map furniture only (`MapView` `BASE_COLOR` +
  dark tooltip). Verified: tsc 0, Tailwind compiles all token utilities, impeccable detector
  clean (`[]`), a real trip page (`/trips/:id`) renders 200 with tokens and zero leftover gray
  in output. Browser eyeball of both themes still worth a human pass. Accent still open (#2).
- 2026-07-03 — Icon set wired in. Considered `/shadcn` for this (it defaults to Lucide
  internally) but it's a full component framework with its own semantic tokens and
  primitives — adopting it just for icons would mean running two design-token systems side
  by side, so installed `lucide-react` directly instead. Deleted the hand-rolled
  `src/components/icons.tsx` (`SearchIcon`/`TrashIcon` → `Search`/`Trash2`) and replaced
  every remaining emoji/unicode-glyph icon across `Manifest`, `LocationInspector`,
  `AddLocationModal`, `NearbyDrawer`, `DayCard`, `UnassignedCard`: 🏨→`Hotel`, 🚆→
  `TrainFront`, 🗺️→`Map`, `★`→`Star`, `×`/`✕`→`X`, `≡`→`GripVertical`. Left the 🐙 in
  `layout.tsx` untouched — it's the kraken brand mark placeholder (see
  `docs/logo-handoff.md`), not a generic icon; swapping it for a Lucide icon would just be
  trading one placeholder for another. Verified live in the browser (Itinerary + Places
  tabs, hover states) and `npm test` + `tsc` both clean.
- 2026-07-04 — Type scale + weight strategy audited, not decided. Counted actual usage
  (`text-xs` 78, `text-sm` 74, `text-lg` 12, `text-xl`/`text-2xl` 2 each, `text-4xl` 1;
  `font-medium` 30, `font-semibold` 27, `font-bold` 6) and found `text-lg`/`text-xl` doing
  two unrelated jobs — genuine section headings in some places, tap-target sizing for
  unrelated `×` close-glyphs in others. Confirmed zero `font-mono` usage anywhere despite
  heavy numeric/time content. Wrote up the full audit plus open questions (ratio, whether to
  replace Inter — flagged elsewhere as a generic/overused choice — with something like IBM
  Plex Sans/Mono) as `docs/typography-handoff.md`, split into its own session the same way
  the kraken mark was. No code changed.
- 2026-07-04 — Type scale + weight strategy decided and landed. Compared three directions
  live on a throwaway `/typography-prototype` route against real component shapes (trip
  header, DayCard, modal): kept Inter as a control, IBM Plex Sans + Plex Mono numerals at a
  1.25 ratio, and a Fraunces-hero variant at a looser ratio — Plex won, Fraunces was
  rejected as an unneeded flourish. Iterated twice more on size vs. weight (a wider 1.333
  ratio and a heavier-weight-same-footprint variant, tested separately, then combined) before
  converging on the 1.25 ratio with the full weight bump and Plex Mono's larger numeral size.
  Folded in: `layout.tsx`/`tailwind.config.ts` swap Inter → Plex Sans (+ Plex Mono via
  `font-mono`); `globals.css` gained named role utilities (`.text-hero`, `.text-page-title`,
  `.text-section`, `.text-body`, `.text-meta`, `.text-numeral`) and `.tap-target` (splits the
  close-button hit target from heading size, fixing the `text-lg`/`text-xl` double duty).
  Applied across `TripClient`, `DayCard`, `OptimizeModal`, `AddLocationModal`. Also dropped
  the Manifest's `uppercase tracking-wide` section eyebrows onto `.text-meta` and deleted
  `/theme-prototype` (its own stated deletion condition — type scale + icon swap both
  landed — is now met). tsc 0; verified live against a real trip
  (header/DayCard/Optimize-modal) in the browser. Only the kraken mark remains open in
  Phase c.
- 2026-07-04 — Kraken mark decided and landed, closing out Phase c. A hand-authored SVG
  "quiet glyph" (single tentacle curl, flat two-color) was built and previewed at favicon
  sizes — rejected as generic, not recognizably the kraken at 16/32px. Replaced the whole
  loud/quiet tiered plan with **one illustrated mascot PNG used everywhere**: recolored to
  `brand-500` teal, wired into the header (`layout.tsx`, replacing the 🐙 placeholder) and
  used to generate `src/app/icon.png`, `src/app/apple-icon.png`, and `public/favicon.ico`.
  PRODUCT.md → Brand Personality updated to match; `docs/logo-handoff.md` and
  `docs/typography-handoff.md` deleted as resolved handoff scaffolding. **Phase c complete.**
