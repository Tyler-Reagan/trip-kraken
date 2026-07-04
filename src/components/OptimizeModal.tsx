"use client";

import { useState } from "react";
import { useTripStore } from "@/store/tripStore";

export default function OptimizeModal() {
  const trip = useTripStore((s) => s.trip);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const optimize = useTripStore((s) => s.optimize);
  const [dayBudgetHours, setDayBudgetHours] = useState<number>(8);
  const [balanceCategories, setBalanceCategories] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCategoryData = trip?.locations.some((l) => l.categories && l.categories.length > 0) ?? false;

  if (!trip) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // The day count and dates come from the trip's required range (ADR-0015); only the soft
      // knobs are chosen here. Re-optimize replaces the plan wholesale.
      await optimize({ dayBudgetHours, balanceCategories });
      setShowOptimize(false);
    } catch {
      setError("Network error. Please try again.");
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
          <h2 id="optimize-modal-title" className="text-lg font-semibold text-ink">Plan your itinerary</h2>
          <button
            onClick={() => setShowOptimize(false)}
            disabled={loading}
            className="text-faint hover:text-sub text-xl leading-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-sub">
          Trip Kraken will cluster your{" "}
          <strong className="text-ink">{includedCount} locations</strong> into optimized days using
          geographic proximity.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-ink">
                Day budget
              </label>
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
              Balances days so no single day exceeds this visit time. Only applies when locations have durations set.
            </p>
          </div>

          {hasCategoryData && (
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={balanceCategories}
                onChange={(e) => setBalanceCategories(e.target.checked)}
                className="mt-0.5 rounded border-line-strong text-brand-600 focus:ring-brand-500 shrink-0"
              />
              <div>
                <span className="text-sm font-medium text-ink">
                  Balance categories across days
                </span>
                <p className="text-xs text-faint mt-0.5">
                  Spreads location types (restaurants, museums, etc.) evenly so no single day concentrates one category.
                </p>
              </div>
            </label>
          )}

          {error && (
            <p className="text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-950 border border-danger-200 dark:border-danger-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowOptimize(false)}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? "Optimizing…" : "Generate itinerary"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
