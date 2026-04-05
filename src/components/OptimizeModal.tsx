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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!trip) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!trip) return;
      const res = await fetch(`/api/trips/${trip.id}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numDays,
          startDate: startDate || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Optimization failed.");
        return;
      }

      await reload();
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

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
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
