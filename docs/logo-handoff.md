# Kraken mark — handoff for a dedicated session

Context for whoever (present or future you) picks up the logo/mascot work. Nothing here
blocks the rest of Phase c — this is intentionally split off so it can run on its own
timeline.

## What's already decided that constrains this

- **PRODUCT.md, Brand Personality:** "the kraken mark used once and well" — a single
  restrained mark, not a detailed illustrated mascot. Character through restraint, not
  decoration.
- **Accent color is locked:** `brand-600` `#0e6b63` (light) / `brand-500` `#3fa5a0` (dark) —
  a mode-tuned teal/ink family (`tailwind.config.ts`). The mark should very likely render in
  this color (or `brand-950`/`brand-900` for a near-black "ink" variant) rather than
  introducing a new hue — one confident accent, not two.
- **Anti-references (PRODUCT.md):** no consumer-travel-app gradients, no stock-photo
  texture, no cute mascot-store cliché. Anti-pattern list elsewhere also bans emoji as UI
  icons — the current 🐙 in the header/favicon is a placeholder, not the answer.
- **Current placeholder:** `src/app/layout.tsx` renders a 🐙 emoji next to the "Trip Kraken"
  wordmark. That's what this work replaces.

## Recommended approach

Skip external AI image-gen tools for the final mark — a photoreal or heavily-illustrated
image needs aggressive simplification before it works as a small flat UI mark/favicon
anyway. Instead, prototype directly as SVG:

1. Sketch 2-4 flat, single-color (or two-tone ink/teal) geometric kraken/tentacle concepts
   as inline SVG — few anchor points, works at 16px (favicon) and full header height alike.
2. Build a comparison page the same way the palette got decided this session — a disposable
   route under `src/app/` (see `src/app/theme-prototype/page.tsx` for the pattern: real
   Tailwind tokens, a light/dark toggle, side-by-side candidates) rendering the mark against
   the actual header, favicon-size, and empty-state contexts.
3. Pick one, then hand off to the **favicon-generator** skill to derive the actual favicon
   size set, and the **logo-generator** skill for clear-space/placement/usage rules once the
   mark is final.

## Open questions for that session

- Full mark (kraken/octopus silhouette) vs. abstracted glyph (e.g. a single tentacle curl,
  or a monogram) — the former reads more literally "kraken," the latter is more restrained
  and scales down cleaner.
- Whether it needs a "quiet" variant (ink-on-transparent, for use inside the app chrome) vs.
  a "loud" variant (for a marketing/README context, if one ever exists) — PRODUCT.md's
  "used once and well" argues against needing multiple variants; default to just one unless
  a concrete second use case shows up.
- Whether the display font chosen for empty-state copy (Fraunces was floated during the
  brand-visual pass, unconfirmed) should pair with the mark in any onboarding/empty-state
  moment, or whether the mark stands alone.

## Not in scope for that session

Icon set (Lucide, already decided — see `docs/design-roadmap.md` Phase c) and type scale
are separate, already-scoped pieces of Phase c. Don't fold them in just because a design
session is open; keep the mark work bounded.
