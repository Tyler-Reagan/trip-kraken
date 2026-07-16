"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DuplicateTripPrompt, type DuplicateTrip } from "./DuplicateTripPrompt";

export default function ImportForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server recognizes `url`'s map ID from an earlier import (#119 follow-up) — the
  // form parks here instead of silently creating another near-duplicate trip.
  const [duplicate, setDuplicate] = useState<{ existingTrips: DuplicateTrip[]; suggestedName: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function clearDuplicate() {
    setDuplicate(null);
  }

  async function submitImport(overrides?: { onDuplicate?: "rename" | "overwrite"; replaceTripId?: string; name?: string }) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
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

      // Land on the bumper page (not the trip view directly) so the user isn't parked on a
      // half-ready Places page while background enrichment runs — it redirects to
      // `?imported=1` (which still triggers the post-import lodging wizard once, #119) once done.
      router.push(`/trips/${data.id}/importing`);
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
    await submitImport();
  }

  function handleImportRenamed() {
    submitImport({ onDuplicate: "rename", name: renameValue });
  }

  function handleOverwrite() {
    if (!duplicate) return;
    const mostRecent = duplicate.existingTrips[0];
    submitImport({ onDuplicate: "overwrite", replaceTripId: mostRecent.id, name: name.trim() || mostRecent.name });
  }

  return (
    <div className="card p-6 space-y-5 h-full">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink">Import from Google My Maps</h2>
        <p className="text-sm text-sub">
          Already have a published map? Bring its places in with exact coordinates.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="url" className="text-sm font-medium text-ink">
            Google My Maps link
          </label>
          <input
            id="url"
            type="url"
            required
            placeholder="https://www.google.com/maps/d/viewer?mid=..."
            value={url}
            onChange={(e) => { setUrl(e.target.value); clearDuplicate(); }}
            className="input"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium text-ink">
            Trip name{" "}
            <span className="text-faint font-normal">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            placeholder="Tokyo week"
            value={name}
            onChange={(e) => { setName(e.target.value); clearDuplicate(); }}
            className="input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="import-start" className="text-sm font-medium text-ink">
              Start date
            </label>
            <input id="import-start" type="date" required value={startDate} onChange={(e) => { setStartDate(e.target.value); clearDuplicate(); }} className="input" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="import-end" className="text-sm font-medium text-ink">
              End date
            </label>
            <input id="import-end" type="date" required value={endDate} min={startDate || undefined} onChange={(e) => { setEndDate(e.target.value); clearDuplicate(); }} className="input" />
          </div>
        </div>

        <p className="text-xs text-sub bg-surface-2 rounded-lg px-3 py-2 leading-relaxed">
          Create a map at{" "}
          <a
            href="https://mymaps.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-brand-600 dark:text-brand-400"
          >
            mymaps.google.com
          </a>
          , add your places, then set it to{" "}
          <strong className="text-ink">Anyone with the link can view</strong>{" "}
          and paste the URL here.
          Coordinates are embedded in the map — no extra processing needed.
        </p>

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
            confirmLabel="Import"
            onConfirmRenamed={handleImportRenamed}
            onOverwrite={handleOverwrite}
            onCancel={clearDuplicate}
            loading={loading}
          />
        ) : (
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="btn-primary w-full"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                Importing…
              </span>
            ) : (
              "Import map"
            )}
          </button>
        )}
      </form>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
