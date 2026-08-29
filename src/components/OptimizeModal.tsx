"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import type { RoadProfile } from "@/types/path";

const ROAD_PROFILES: { id: RoadProfile; label: string }[] = [
  { id: "walking", label: "Walking" },
  { id: "driving", label: "Driving" },
];

export default function OptimizeModal() {
  const trip = useTripStore((s) => s.trip);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const setRoadProfile = useTripStore((s) => s.setRoadProfile);
  const setHasJrPass = useTripStore((s) => s.setHasJrPass);
  const optimize = useTripStore((s) => s.optimize);
  const [dayBudgetHours, setDayBudgetHours] = useState<number>(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #152: a non-fatal condition from the run that just finished (e.g. a pending lodging with no
  // Anchor yet) — shown instead of closing the modal, so the user sees it before the tray reload
  // pulls their attention elsewhere.
  const [warnings, setWarnings] = useState<string[] | null>(null);

  if (!trip) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarnings(null);
    setLoading(true);
    try {
      // The day count and dates come from the trip's required range (ADR-0015); only the soft
      // knobs are chosen here. Re-optimize replaces the plan wholesale.
      await optimize({ dayBudgetHours });
      const runWarnings = useTripStore.getState().optimizeWarnings;
      if (runWarnings.length > 0) setWarnings(runWarnings);
      else setShowOptimize(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  const includedCount = trip.locations.filter((l) => !l.excluded).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="optimize-modal-title"
        className="card w-full max-w-md p-6 space-y-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="optimize-modal-title" className="text-section text-ink">
            Plan your itinerary
          </h2>
          <button
            onClick={() => setShowOptimize(false)}
            disabled={loading}
            className="tap-target text-faint hover:text-sub transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-body text-sub">
          Trip Kraken will cluster your{" "}
          <strong className="text-ink">{includedCount} locations</strong> into
          optimized days using geographic proximity.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink">
              Getting around
            </label>
            <div className="flex rounded-lg border border-line border-line-strong overflow-hidden w-fit">
              {ROAD_PROFILES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setRoadProfile(p.id)}
                  disabled={loading}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50
                    ${
                      trip.roadProfile === p.id
                        ? "bg-brand-600 dark:bg-brand-500 text-white"
                        : "bg-surface text-sub hover:bg-surface-2"
                    }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-faint">
              How road legs are routed. Trains and buses are unaffected — this
              only decides walking vs. driving between stops. Changeable any
              time; takes effect on the next optimize.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-ink cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={trip.hasJrPass}
                onChange={(e) => setHasJrPass(e.target.checked)}
                disabled={loading}
                className="rounded border-line-strong text-brand-600 focus:ring-brand-500 shrink-0"
              />
              I have a Japan Rail Pass
            </label>
            <p className="text-xs text-faint">
              Routes around lines your Pass doesn&apos;t cover. Nozomi and
              Mizuho Shinkansen still route — they&apos;re ridable on a Pass
              with a separate supplement ticket — but are flagged wherever they
              appear. Changeable any time; takes effect on the next optimize.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-ink">Day budget</label>
              <span className="text-sm text-sub">{dayBudgetHours}h</span>
            </div>
            <input
              type="range"
              min={4}
              max={14}
              step={1}
              value={dayBudgetHours}
              onChange={(e) => setDayBudgetHours(Number(e.target.value))}
              className="w-full accent-brand-600"
            />
            <p className="text-xs text-faint">
              The length of each day, including travel and waiting — not just
              time spent visiting.
            </p>
          </div>

          {error && (
            <p className="text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-950 border border-danger-200 dark:border-danger-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {warnings && warnings.length > 0 && (
            <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 space-y-1">
              {warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowOptimize(false)}
              className="btn-secondary flex-1"
            >
              {warnings && warnings.length > 0 ? "Close" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading
                ? "Optimizing…"
                : warnings && warnings.length > 0
                  ? "Optimize again"
                  : "Generate itinerary"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
