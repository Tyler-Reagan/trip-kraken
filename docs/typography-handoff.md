# Type scale + weight strategy — handoff for a dedicated session

Audit done, nothing implemented yet. Split into its own session the same way the kraken
mark was — it doesn't block anything else in Phase c, and deserves the same
live-comparison treatment the accent color and day-hue palette got.

## What's already decided that constrains this

- **PRODUCT.md, Design Principles:** hierarchy should be carried by size/space, not gray
  value alone — this is *why* this pass exists. The `colorize` sweep (Phase c) moved the app
  onto semantic ink/sub/faint tokens, which carry less contrast range than an arbitrary gray
  ramp did; size/weight need to pick up more of the hierarchy work than they currently do.
- **Restraint + "precise, calm":** 3-4 type styles max per block (brand-visual-generator
  guidance). Not license to introduce a decorative typeface.
- **Avoid generic/overused fonts.** brand-visual-generator explicitly flags Inter as a
  cookie-cutter "AI font" choice — and the app currently uses exactly that (`layout.tsx`,
  `next/font/google`). This pass is the natural point to reconsider the font itself, not
  just resize what's there.

## Audit — current state

**Font:** Inter only, no serif/mono anywhere in the codebase (`grep font-mono` → 0 hits) —
despite the app being full of numeric content (itinerary times, durations, ratings, stop
counts) that never gets a distinct numeral treatment.

**Sizes in use** (raw counts across `src/`):

| Class | Count | Apparent role |
|---|---|---|
| `text-xs` | 78 | Meta/caption — durations, hours, review counts, labels |
| `text-sm` | 74 | Body — the workhorse, almost everything |
| `text-lg` | 12 | Mixed: modal/section headers (`h2`) *and* unrelated tap-target-sized close buttons (`×`) — same class doing two unrelated jobs |
| `text-xl` | 2 | Close buttons only (`OptimizeModal`, `AddLocationModal`) — no headings use it |
| `text-2xl` | 2 | Trip title (`TripClient` `h1`), header emoji |
| `text-4xl` | 1 | Homepage hero (`page.tsx` `h1`) |

**Weights in use:**

| Class | Count |
|---|---|
| `font-medium` | 30 |
| `font-semibold` | 27 |
| `font-bold` | 6 |
| `font-normal` | 2 |

**Real problem, not just "no system":** `text-lg` and `text-xl` are each doing double duty —
`text-lg font-semibold` marks a genuine section heading (`OptimizeModal`, `AddLocationModal`,
`NewTripForm`, `ImportForm`, "Your trips") in some places, but `text-lg`/`text-xl
leading-none` with no weight is *also* used purely to make an `×` close-glyph tappable
(`OptimizeModal:50`, `AddLocationModal:113`, `LocationInspector:137`, `TripList:54`). Those
are unrelated concerns (typographic hierarchy vs. hit-target sizing) sharing one class by
accident — worth separating regardless of what scale gets picked.

## Recommended roles to name (starting point, not final)

A named scale, each with a fixed size + weight + color pairing — not just a list of sizes:

- **Hero** — homepage/empty-state headline (currently `text-4xl font-bold`)
- **Page title** — trip name, top of a screen (currently `text-2xl font-bold`)
- **Section** — modal/card headers (currently `text-lg font-semibold`)
- **Body** — the workhorse (currently `text-sm`, untyped weight)
- **Meta/Caption** — durations, hours, counts (currently `text-xs`, `text-faint`/`text-sub`)
- **Numeral** — times, durations, ratings, counts — currently indistinguishable from Body;
  candidate for a monospace treatment (tabular figures read as more "precise/engineered,"
  matching PRODUCT.md's three words) without introducing a second display font.

## Open questions for that session

- **Ratio:** 1.25 (Major Third) vs. something looser given `text-sm`→`text-xs` is already a
  fairly tight, functional pair that shouldn't need to change much.
- **Font replacement for Inter:** IBM Plex Sans was floated informally during the earlier
  brand-visual pass (technical/precise character, avoids the generic-AI-font trap) as the
  body/UI workhorse, with IBM Plex Mono for the Numeral role and an optional serif/humanist
  display (Fraunces was floated) reserved for Hero-only moments. None of this is confirmed —
  decide it live against real content, not from a swatch.
- **Fixing the `text-lg`/`text-xl` double-duty** on close buttons — give tap-target sizing
  its own utility/class independent of whatever the new Section-heading size becomes.

## Recommended approach

Same pattern as `/theme-prototype` and the (separate-session) logo comparison: a disposable
route rendering real content — a trip header, a `DayCard`, a modal — at 2-3 candidate
scale/weight/font combinations side by side, judged live rather than in the abstract. Delete
once a scale is picked and rolled into the actual components.

## Not in scope for that session

Icon set (done — Lucide) and the kraken mark (separate session, `docs/logo-handoff.md`).
Don't fold either in just because a design session is open.
