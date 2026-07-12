"use client";

import { Info } from "lucide-react";

/**
 * ADR-0019's accepted v1 limitation, surfaced to the user (#88): a transit Leg's timing is a
 * coarse estimate (per-line-type effective speed + a flat transfer allowance), not schedule-exact.
 * A Day with generous timing is unaffected; a Day resting on a tight last-train connection could
 * be called feasible when the real timetable disagrees — the one place the plan could be
 * optimistic, so it's stated plainly rather than left implicit (mirrors ADR-0017's "degrade
 * visibly, don't hide it").
 */
export default function TransitEstimateCaveat() {
  return (
    <div className="card border-amber-200 dark:border-amber-800 px-4 py-3 flex gap-2.5 items-start">
      <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="text-sm text-sub">
        <span className="font-medium text-ink">Transit timing is estimated.</span>{" "}
        Travel times use typical line speeds and a flat transfer allowance, not real timetables —
        it doesn&rsquo;t yet account for exact schedules or last trains.
      </p>
    </div>
  );
}
