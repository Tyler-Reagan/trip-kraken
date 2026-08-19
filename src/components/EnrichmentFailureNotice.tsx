"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";

/**
 * Places whose lookup failed, named — with the retry attached to the names rather than sitting in
 * the toolbar above them.
 *
 * This replaces a header button whose entire account of itself was a `title` tooltip. Two problems
 * with that, and the second is the disqualifying one: a tooltip is hover-only, and PRODUCT.md's
 * portability principle rules out hover-only paths outright, so on touch the button said "Retry
 * (1)" and nothing else, ever. Naming the places in the DOM fixes both at once.
 *
 * Dismissal is session-local and keyed to *which* places are failing, the same shape
 * {@link DistantMetroWarning} uses and for the same reason: a bare boolean would go permanently
 * silent, so a later import failing a different place would never be surfaced. Retrying and failing
 * again on the same set stays dismissed; a changed set reappears. Nothing here is persisted — a
 * reload is a fresh look at the trip.
 */
export default function EnrichmentFailureNotice() {
  const trip = useTripStore((s) => s.trip);
  const isEnriching = useTripStore((s) => s.isEnriching);
  const enrichProgress = useTripStore((s) => s.enrichProgress);
  const enrich = useTripStore((s) => s.enrich);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  if (!trip) return null;

  const failed = trip.locations.filter((l) => l.enrichmentStatus === "failed");
  if (failed.length === 0) return null;

  // Keyed on ids, not the count: swapping one failed place for another leaves the count identical
  // while the thing the user dismissed is no longer what's on screen.
  const signature = failed.map((l) => l.id).sort().join("|");
  if (signature === dismissedSignature) return null;

  const one = failed.length === 1;

  return (
    // Stacks below `sm`: side-by-side, the button squeezes the sentence into a four-word column.
    <div className="card border-danger-200 dark:border-danger-800 px-4 py-3 flex gap-2.5 items-start flex-wrap sm:flex-nowrap">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-danger-600 dark:text-danger-400" aria-hidden />
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm text-sub">
          <span className="font-medium text-ink">
            {one ? "One place couldn’t be looked up." : `${failed.length} places couldn’t be looked up.`}
          </span>{" "}
          {/* Each JSX line break needs its own {" "} — a bare newline between an expression and the
              next line's text collapses to nothing, not a space. */}
          {one ? "It has" : "They have"}{" "}
          no coordinates, hours, or rating yet, so the optimizer can&rsquo;t schedule{" "}
          {one ? "it" : "them"}.
        </p>
        <ul className="space-y-0.5">
          {failed.map((l) => (
            // The reason wraps rather than truncates. A half-shown sentence ("No matching place
            // found fo…") is the exact failure this notice exists to correct.
            <li key={l.id} className="text-xs text-sub flex flex-wrap gap-x-1.5 min-w-0">
              <span className="font-medium text-ink truncate max-w-full">{l.name}</span>
              <span className="text-faint">
                {l.enrichmentError ?? "No reason recorded — this one failed before failures were explained."}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={enrich}
          disabled={isEnriching}
          className="btn-secondary text-xs py-1 px-3 disabled:opacity-40"
        >
          {isEnriching
            ? enrichProgress
              ? `${enrichProgress.enriched}/${enrichProgress.total}`
              : "Retrying…"
            : "Retry"}
        </button>
        <button
          onClick={() => setDismissedSignature(signature)}
          className="tap-target shrink-0 text-faint hover:text-ink"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
