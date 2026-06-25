"use client";

import { useState } from "react";
import { useTripStore } from "@/store/tripStore";

export default function OptimizeModal() {
  const trip = useTripStore((s) => s.trip);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const reload = useTripStore((s) => s.reload);
  // useState initializers use optional chaining so hooks are always called
  const [numDays, setNumDays] = useState<number>(trip?.numDays ?? 3);
  const [startDate, setStartDate] = useState<string>(
    trip?.startDate ? new Date(trip.startDate).toISOString().slice(0, 10) : ""
  );
  const [dayBudgetHours, setDayBudgetHours] = useState<number>(8);
  const [balanceCategories, setBalanceCategories] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const hasCategoryData = trip?.locations.some((l) => l.categories && l.categories.length > 0) ?? false;

  if (!trip) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    setLoading(true);

    try {
      if (!trip) return;
      const res = await fetch(`/api/trips/${trip.id}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numDays,
          startDate: startDate || undefined,
          dayBudgetHours,
          balanceCategories,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Optimization failed.");
        return;
      }

      await reload();
      // Keep the modal open to surface any reconciliation warnings (e.g. locks orphaned by
      // a day-count cut, ADR-0006); close immediately when there's nothing to report.
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setWarnings(data.warnings);
      } else {
        setShowOptimize(false);
      }
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
          <h2 id="optimize-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Plan your itinerary</h2>
          <button
            onClick={() => setShowOptimize(false)}
            disabled={loading}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          Trip Kraken will cluster your{" "}
          <strong className="text-gray-700 dark:text-gray-200">{includedCount} locations</strong> into optimized days using
          geographic proximity.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Number of days
            </label>
            <input
              type="number"
              min={1}
              max={30}
              required
              value={numDays}
              onChange={(e) => setNumDays(Number(e.target.value))}
              className="input"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Start date{" "}
              <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Day budget
              </label>
              <span className="text-sm text-gray-500 dark:text-gray-400">{dayBudgetHours}h</span>
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
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Balances days so no single day exceeds this visit time. Only applies when locations have durations set.
            </p>
          </div>

          {hasCategoryData && (
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={balanceCategories}
                onChange={(e) => setBalanceCategories(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
              />
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Balance categories across days
                </span>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  Spreads location types (restaurants, museums, etc.) evenly so no single day concentrates one category.
                </p>
              </div>
            </label>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {warnings.length > 0 && (
            <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 space-y-1">
              <p className="font-medium">Itinerary updated, with notes:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowOptimize(false)}
              className="btn-secondary flex-1"
            >
              {warnings.length > 0 ? "Done" : "Cancel"}
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? "Optimizing…" : warnings.length > 0 ? "Re-run" : "Generate itinerary"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
