"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewTripForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate || startDate > endDate) {
      setError("Pick a start and end date (start on or before end).");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, startDate, endDate }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setLoading(false);
        return;
      }

      // Add locations by searching Places in the trip view (ADR-0010).
      router.push(`/trips/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="card p-6 space-y-5 h-full">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink">Start a new trip</h2>
        <p className="text-sm text-sub">
          Begin with a blank trip, then add places by searching Google.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="trip-name" className="text-sm font-medium text-ink">
            Trip name{" "}
            <span className="text-faint font-normal">(optional)</span>
          </label>
          <input
            id="trip-name"
            type="text"
            placeholder="Tokyo week"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="trip-start" className="text-sm font-medium text-ink">
              Start date
            </label>
            <input id="trip-start" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="trip-end" className="text-sm font-medium text-ink">
              End date
            </label>
            <input id="trip-end" type="date" required value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className="input" />
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-950 border border-danger-200 dark:border-danger-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Creating…" : "Create trip"}
        </button>
      </form>
    </div>
  );
}
