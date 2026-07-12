"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { DEFAULT_ALLOWED_MODES, type TravelMode } from "@/lib/travelCost";

// Mirrors consumer maps' mode order; also travelCost.ts's resolvePrimaryMode precedence.
const MODE_OPTIONS: { mode: TravelMode; label: string }[] = [
  { mode: "transit", label: "Transit" },
  { mode: "driving", label: "Driving" },
  { mode: "walking", label: "Walking" },
  { mode: "bicycle", label: "Bicycle" },
];

export default function OptimizeModal() {
  const trip = useTripStore((s) => s.trip);
  const setShowOptimize = useTripStore((s) => s.setShowOptimize);
  const optimize = useTripStore((s) => s.optimize);
  const setAllowedModes = useTripStore((s) => s.setAllowedModes);
  const [dayBudgetHours, setDayBudgetHours] = useState<number>(8);
  const [modes, setModes] = useState<TravelMode[]>(() => [...(trip?.allowedModes ?? DEFAULT_ALLOWED_MODES)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!trip) return null;

  function toggleMode(mode: TravelMode) {
    setModes((current) => {
      const checked = current.includes(mode);
      // At least one mode must stay selected — an empty set would silently fall back to "every
      // mode allowed" (resolvePrimaryMode's default), which would contradict what the user sees.
      if (checked && current.length === 1) return current;
      return checked ? current.filter((m) => m !== mode) : [...current, mode];
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // The day count and dates come from the trip's required range (ADR-0015); only the soft
      // knobs are chosen here. Re-optimize replaces the plan wholesale.
      await setAllowedModes(modes);
      await optimize({ dayBudgetHours });
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
          <h2 id="optimize-modal-title" className="text-section text-ink">Plan your itinerary</h2>
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
          <strong className="text-ink">{includedCount} locations</strong> into optimized days using
          geographic proximity.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink">Travel modes</label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {MODE_OPTIONS.map(({ mode, label }) => {
                const isLastChecked = modes.length === 1 && modes.includes(mode);
                return (
                  <label
                    key={mode}
                    className="flex items-center gap-2 cursor-pointer select-none has-[:disabled]:cursor-not-allowed"
                    title={isLastChecked ? "At least one travel mode must stay selected" : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={modes.includes(mode)}
                      disabled={isLastChecked}
                      onChange={() => toggleMode(mode)}
                      className="rounded border-line-strong text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-sub">{label}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-faint">
              Transit already includes the walk to and from stations — no separate walking selection needed.
            </p>
          </div>

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
