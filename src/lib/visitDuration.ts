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
