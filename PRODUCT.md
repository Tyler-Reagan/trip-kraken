# Product

## Register

product

## Users

A single technically-fluent traveler planning their own trips, using Trip Kraken
repeatedly across the lifecycle of a trip — from a rough Google My Maps list of
candidate places to a refined, day-by-day itinerary. It is self-hosted, local-first,
and single-user: there is no audience to impress, only a workflow to make effortless.
The user's job is to turn a flat pile of locations into a feasible, low-backtracking
plan, then iterate on it (reorder, exclude, discover nearby places) over multiple
sittings. They reach for the app in planning mode — focused, deliberate, often
returning to refine — not in a hurry and not casually browsing.

## Product Purpose

Trip Kraken turns a set of candidate Locations over a date range into an optimized,
feasible Plan — clustering geographically (k-means) and ordering within each Day
(nearest-neighbor TSP) — and then supports an iterative discovery → refinement loop.
Success is the *feeling of effortlessness*: the user gets from import to a trustworthy
itinerary with minimal friction, and refining it (drag a stop, exclude a place, pull
in something nearby) feels direct and immediate. The optimizer is the engine; the
interface's job is to make committing to and adjusting its output feel like moving
physical objects on a table, not editing a database.

## Brand Personality

Product with personality, held at a high craft bar. The design's entire craft budget
is spent on ergonomics, not decoration — personality is expressed *through* restraint
and quality rather than through flourish. Calm, precise, quietly confident; minimal
and direct but genuinely aesthetic, never sterile. Character appears in deliberate,
quiet touches — the kraken mark used once and well, a confident accent color, real
empty states, microcopy with a voice — none of which ever cost the user a click.
Three words: **effortless, precise, calm.**

## Anti-references

- **Consumer travel-app bubble** — TripAdvisor / Expedia gradients, stock hero photos,
  star-rating confetti, marketing chrome. This is a tool, not a storefront.
- **Generic SaaS dashboard** — warm-cream/beige body backgrounds, identical card grids,
  hero-metric templates, eyebrow kickers above every section.
- **Visual clutter of any kind** — competing accents, dense toolbars, decorative borders
  and shadows stacked on every element. When in doubt, remove it.
- **Heavy text-based input** — long forms, fields where a direct interaction (drag, tap,
  map click, picker) would do. Typing is the fallback, not the primary verb.

## Design Principles

1. **Ergonomics is the product.** Craft is spent making the workflow effortless, not on
   ornament. If a choice is prettier but slower to use, it loses.
2. **Direct manipulation over data entry.** Prefer drag, reorder, map interaction, and
   pickers over text fields and forms. Moving a stop should feel like moving an object.
3. **Personality through restraint.** Character shows in a few deliberate, quiet touches —
   never in clutter. One confident accent, the kraken used sparingly, considered empty
   states. Subtract before adding.
4. **The itinerary leads; the map serves it.** A deliberate surface hierarchy: the
   timeline/itinerary is the first-class surface (the product's purpose), the map is its
   visual companion in service of it, and the Manifest is a second-class staging area for
   building the itinerary. Design so the hierarchy reads — don't present the three as equals.
5. **Bank portability for free.** Build web-native now and concede nothing to the eventual
   iOS fork — but keep every interaction touch-portable (real hit targets, no hover-only
   paths, layouts that stack cleanly) and the design language (tokens, type scale,
   spacing, iconography, component semantics) clean enough to carry into SwiftUI later.

## Accessibility & Inclusion

Deferred, not declined. When prioritized, the floor is WCAG AA contrast, full keyboard
operability (including a keyboard alternative to drag-and-drop), and honoring
`prefers-reduced-motion`. Not an immediate priority, but no new work should actively
foreclose it.
