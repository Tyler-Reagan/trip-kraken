# Optimistic updates handoff — lodging-date save & placement drag

**Status: not started.** Split into its own session the same way `logo-handoff.md` and
`typography-handoff.md` were — delete this file once resolved and fold a summary into
[`place-model-rebuild.md`](place-model-rebuild.md)'s status log (the doc that flagged this as the
last open item after the ADR-0015 rebuild).

## The gap

`src/store/tripStore.ts` has two mutation patterns side by side:

- **Optimistic** (`updateLocation`, `removePlacement`): patch `trip` in local state immediately,
  fire the request, then `reload()` to reconcile. The UI updates with no visible lag.
- **Round-trip-then-render** (`saveLodgingDates`, `movePlacement`): `await fetch(...)` then
  `await get().reload()`, with no local write first. The UI visibly waits on the network before
  a dragged stop moves or a lodging date change shows up.

Concretely:
- `saveLodgingDates` — `tripStore.ts:170-186`
- `movePlacement` — `tripStore.ts:149-158`, called from `ScheduleView.tsx`'s `handleDrop` on stop
  drag-and-drop

Compare against `removePlacement` (`tripStore.ts:160-168`), which is the pattern to match:
```ts
removePlacement: async (placementId) => {
  const tripId = get().tripId;
  if (!tripId) return;
  const t = get().trip;
  if (t) set({ trip: { ...t, placements: t.placements.filter((p) => p.id !== placementId) } });
  await fetch(`/api/trips/${tripId}/placements/${placementId}`, { method: "DELETE" });
  await get().reload();
},
```

## Why `movePlacement` is the harder one

`addPlacement`/`removePlacement` are simple list add/remove. `movePlacement` is not — the server
(`src/lib/db/index.ts:296-327`, function `movePlacement`) does real reordering that a naive client
patch would get wrong:

1. Shifts every placement on the **target date** with `order >= order` up by one (to open a slot).
2. Sets the moved placement's `date`/`order` to the target.
3. If the move crossed dates, re-compacts the **source date**'s remaining placements to a dense
   `0..n-1` `order` sequence (so removing a stop from day 2 doesn't leave gaps like `0, 2, 3`).

An optimistic client patch needs to reproduce steps 1–3 against `get().trip.placements` before the
fetch, or the day-of UI (order within `DayCard`) will briefly show stale/incorrect ordering until
`reload()` corrects it — which defeats the point of doing this optimistically at all. This is the
main reason it's real work, not a one-line copy of the `removePlacement` pattern.

## Suggested approach

1. Write a pure helper (e.g. in `tripStore.ts` or a small local function) that takes
   `placements: Placement[]`, `placementId`, `date`, `order` and returns the reordered array,
   mirroring the three steps above exactly. Ideally shared or cross-checked against
   `src/lib/db/index.ts`'s `movePlacement` so the two don't drift.
2. Call it in `set()` before the `fetch` in `tripStore.ts`'s `movePlacement`, same shape as
   `removePlacement`'s patch-then-fetch-then-reload.
3. For `saveLodgingDates`: patch the target location's `checkInDate`/`checkOutDate` (or clear both
   when `dates === null`) into `trip.locations` before the fetch. Note this function returns an
   error string on failure (unlike the other mutators, which are `void`) — on a non-OK response
   you'll want to roll the optimistic patch back (re-fetch or revert to the pre-patch location),
   not just leave the wrong value on screen until the user notices.
4. `deriveDays` (`src/types`) projects `placements` + lodging fields into the day-clustered view
   consumed by `ScheduleView`/`DayCard`/`MapView` — as long as the optimistic patch produces a
   consistent `trip` shape, `deriveDays` should pick it up the same way it does after `reload()`.
   No changes needed there.
5. Verify by hand in the browser: drag a stop within a day (reorders), drag a stop across days
   (moves + reorders both days), and edit lodging dates from the Manifest — all three should update
   the instant you release/blur, with no visible network wait, and should still match server state
   after `reload()` settles (i.e. the optimistic patch and the server's real logic must agree).

## Non-goals

Don't generalize this into a shared "optimistic mutation" abstraction across the store — only two
functions need it, and `updateLocation`/`removePlacement` already show the pattern inline. Adding a
wrapper/middleware for two call sites would be premature.
