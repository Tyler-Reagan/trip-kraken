/**
 * A single source for how an Activity's `visitDuration` (minutes, nullable) resolves to what the
 * optimizer actually uses, and how any duration is displayed (ADR-0023 §9, amended 2026-08-18).
 *
 * `null` keeps meaning "the user hasn't said" — there is no DB default and no backfill. Every
 * caller that needs to know whether a value is a default rather than a choice already holds the
 * raw `Location.visitDuration` and checks `=== null` itself; this module only resolves the
 * effective minutes, not a compound "value + provenance" shape, since no caller ever needed both
 * from one place.
 */

/** The flat default (ADR-0023 §9, amended 2026-08-18) — retires category-seeded duration rather
 * than deferring it. Visible and editable in the UI, unlike the invisible `DEFAULT_VISIT_MINS = 60`
 * this reverses, which is what makes inventing a number honest here where it wasn't there. */
export const DEFAULT_VISIT_MINUTES = 30;

/** The inline editor's step, and its floor — reverting to "unset" is a distinct action that writes
 * `null`, never a value this step can reach. */
export const VISIT_DURATION_STEP_MINUTES = 15;

/** The editor's practical ceiling. Deliberately below the API's own 1440 bound (see the locations
 * PATCH route): 1440 is the outer limit of what's *storable*, 720 is the longest single visit worth
 * offering in a picker. A stored value above this still displays fine — it's only the roller's
 * range that stops here. */
export const VISIT_DURATION_MAX_MINUTES = 720;

export function clampVisitDuration(mins: number): number {
  return Math.max(VISIT_DURATION_STEP_MINUTES, Math.min(VISIT_DURATION_MAX_MINUTES, mins));
}

/**
 * The ± buttons' stops: 15m below 1h, 30m to 2h, 1h above — the step grows with the value, so the
 * buttons stay useful across the whole range instead of pretending 15 minutes is a meaningful unit
 * at the four-hour mark. That halves the clicks from the 30m default to a 3h visit (10 → 5).
 *
 * A coarse *sequence* rather than a step added to whatever value is current, because the two aren't
 * equivalent: the roller can land on 105m, and adding a band-sized step there gives 105 → 135 → 75,
 * which can't be undone. Moving between fixed stops means every + is reversed by a −, and an
 * off-ladder value snaps onto the ladder rather than wandering further off it.
 */
export const VISIT_DURATION_LADDER: number[] = (() => {
  const out: number[] = [];
  for (let m = VISIT_DURATION_STEP_MINUTES; m <= VISIT_DURATION_MAX_MINUTES;
       m += m < 60 ? 15 : m < 120 ? 30 : 60) out.push(m);
  return out;
})();

export function nextVisitDuration(mins: number, direction: 1 | -1): number {
  const stop = direction > 0
    ? VISIT_DURATION_LADDER.find((v) => v > mins)
    : [...VISIT_DURATION_LADDER].reverse().find((v) => v < mins);
  return stop ?? clampVisitDuration(mins);
}

/** Every value the roller offers — one flat list, because a duration is one scalar. A two-column
 * hours × minutes picker can express `0h 00m`, which isn't a legal duration; this shape makes the
 * invalid state unrepresentable instead of guarding against it. */
export const VISIT_DURATION_OPTIONS: number[] = Array.from(
  { length: VISIT_DURATION_MAX_MINUTES / VISIT_DURATION_STEP_MINUTES },
  (_, i) => (i + 1) * VISIT_DURATION_STEP_MINUTES,
);

/** The roller index to open on. Nearest rather than exact: the API accepts any integer from 15 to
 * 1440, so a stored value off the 15-minute grid (or above the ceiling) is reachable and must still
 * open the picker somewhere sensible rather than falling back to the first row. */
export function nearestVisitDurationIndex(mins: number): number {
  const i = Math.round(mins / VISIT_DURATION_STEP_MINUTES) - 1;
  return Math.max(0, Math.min(VISIT_DURATION_OPTIONS.length - 1, i));
}

/** What the optimizer and the UI both use in place of an unset `visitDuration`. */
export function resolveVisitDuration(visitDuration: number | null | undefined): number {
  return visitDuration ?? DEFAULT_VISIT_MINUTES;
}

/** `0` minutes is unreachable through the editor (see `VISIT_DURATION_STEP_MINUTES`), so this only
 * ever renders a positive duration. */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
