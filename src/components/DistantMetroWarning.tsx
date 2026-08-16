"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { detectUncoveredSplit } from "@/lib/tripSplitWarning";

/**
 * #110's pre-optimize signal: the trip's included Activities span 2+ distant metro clusters and
 * at least one has no covering lodging. Optimize would still run fine — those Activities just
 * land in the Unassigned tray with a reason once it does — but a user who hasn't optimized yet
 * hasn't seen that tray, so this catches it earlier, while there's still time to add a lodging in
 * that city or fix an import mistake.
 *
 * Dismissal is session-local, not persisted (unlike `TransitEstimateCaveat`'s DB-backed flag) —
 * deliberately, because the underlying condition can flip: the same trip can gain a *new* uncovered
 * city after a permanent dismissal would have gone silent. Keying dismissal to the current finding
 * rather than a bare boolean means it reappears the moment the specific set of uncovered cities
 * actually changes, and stays gone otherwise (including across the re-renders every store update
 * triggers).
 */
export default function DistantMetroWarning() {
  const trip = useTripStore((s) => s.trip);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  if (!trip) return null;

  const uncovered = detectUncoveredSplit(trip);
  if (!uncovered) return null;

  const signature = uncovered.map((u) => u.label).sort().join("|");
  if (signature === dismissedSignature) return null;

  // Two independent counts share this sentence — how many *locations* are stranded, and how many
  // *places* they're stranded near — and conflating their pronouns is exactly the bug an earlier
  // draft had ("2 locations ... has"). Every pronoun below is deliberately pinned to whichever
  // count it actually refers back to, never the other one.
  const activityCount = uncovered.reduce((sum, u) => sum + u.activityCount, 0);
  const oneLocation = activityCount === 1;
  const names = uncovered.map((u) => u.label);
  const onePlace = names.length === 1;
  const placeList =
    names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

  return (
    <div className="card border-amber-200 dark:border-amber-800 px-4 py-3 flex gap-2.5 items-start">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="flex-1 text-sm text-sub">
        <span className="font-medium text-ink">
          {activityCount} location{oneLocation ? "" : "s"} near {placeList} {oneLocation ? "has" : "have"} no nearby lodging.
        </span>{" "}
        {/* Every JSX line break here needs its own {" "} — a bare newline between an expression
            and the next line's text silently collapses to nothing, not a space. */}
        {oneLocation ? "It" : "They"} won&rsquo;t be scheduled unless a lodging covers{" "}
        {onePlace ? "that area" : "those areas"} — add one, or this is fine if a trip to {placeList}{" "}
        isn&rsquo;t on the itinerary.
      </p>
      <button
        onClick={() => setDismissedSignature(signature)}
        className="tap-target text-faint hover:text-ink shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
