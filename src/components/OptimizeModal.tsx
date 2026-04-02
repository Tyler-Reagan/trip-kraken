"use client";

import { useState } from "react";
import type { TripWithDetails } from "@/types";

interface Props {
  trip: TripWithDetails;
  onClose: () => void;
  onOptimized: (trip: TripWithDetails) => void;
}

export default function OptimizeModal({ trip, onClose, onOptimized }: Props) {
  const [numDays, setNumDays] = useState<number>(trip.numDays ?? 3);
  const [startDate, setStartDate] = useState<string>(
    trip.startDate
      ? new Date(trip.startDate).toISOString().slice(0, 10)
      : ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
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

      onOptimized(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const includedCount = trip.locations.filter((l) => !l.excluded).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="card w-full max-w-md p-6 space-y-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Plan your itinerary</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500">
          Trip Kraken will cluster your{" "}
          <strong>{includedCount} locations</strong> into optimized days using
          geographic proximity.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
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
            <label className="text-sm font-medium text-gray-700">
              Start date{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
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
