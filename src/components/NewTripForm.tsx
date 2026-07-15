"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DuplicateTripPrompt, type DuplicateTrip } from "./DuplicateTripPrompt";

export default function NewTripForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server finds an existing trip with this same name (#119 follow-up) — the form
  // parks here instead of silently creating a second indistinguishable trip.
  const [duplicate, setDuplicate] = useState<{ existingTrips: DuplicateTrip[]; suggestedName: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function clearDuplicate() {
    setDuplicate(null);
  }

  async function submitCreate(overrides?: { onDuplicate?: "rename" | "overwrite"; replaceTripId?: string; name?: string }) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: (overrides?.name ?? name).trim() || undefined,
          startDate,
          endDate,
          ...(overrides?.onDuplicate ? { onDuplicate: overrides.onDuplicate } : {}),
          ...(overrides?.replaceTripId ? { replaceTripId: overrides.replaceTripId } : {}),
        }),
      });
      const data = await res.json();

      if (res.status === 409 && data.duplicate) {
        setDuplicate({ existingTrips: data.existingTrips, suggestedName: data.suggestedName });
        setRenameValue(data.suggestedName);
        setLoading(false);
        return;
      }
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate || startDate > endDate) {
      setError("Pick a start and end date (start on or before end).");
      return;
    }
    await submitCreate();
  }

  function handleCreateRenamed() {
    submitCreate({ onDuplicate: "rename", name: renameValue });
  }

  function handleOverwrite() {
    if (!duplicate) return;
    const mostRecent = duplicate.existingTrips[0];
    submitCreate({ onDuplicate: "overwrite", replaceTripId: mostRecent.id, name: name.trim() || mostRecent.name });
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
            onChange={(e) => { setName(e.target.value); clearDuplicate(); }}
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="trip-start" className="text-sm font-medium text-ink">
              Start date
            </label>
            <input id="trip-start" type="date" required value={startDate} onChange={(e) => { setStartDate(e.target.value); clearDuplicate(); }} className="input" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="trip-end" className="text-sm font-medium text-ink">
              End date
            </label>
            <input id="trip-end" type="date" required value={endDate} min={startDate || undefined} onChange={(e) => { setEndDate(e.target.value); clearDuplicate(); }} className="input" />
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-950 border border-danger-200 dark:border-danger-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {duplicate ? (
          <DuplicateTripPrompt
            existingTrips={duplicate.existingTrips}
            renameValue={renameValue}
            onRenameChange={setRenameValue}
            confirmLabel="Create"
            onConfirmRenamed={handleCreateRenamed}
            onOverwrite={handleOverwrite}
            onCancel={clearDuplicate}
            loading={loading}
          />
        ) : (
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Creating…" : "Create trip"}
          </button>
        )}
      </form>
    </div>
  );
}
