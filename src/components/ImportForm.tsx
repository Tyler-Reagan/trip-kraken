"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ImportedLocation = { id: string; name: string };

export default function ImportForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2: lodging picker state
  const [pendingTrip, setPendingTrip] = useState<{ id: string; locations: ImportedLocation[] } | null>(null);
  const [selectedLodgingId, setSelectedLodgingId] = useState<string | null>(null);
  const [savingLodging, setSavingLodging] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      // Show lodging picker before navigating
      setPendingTrip({ id: data.id, locations: data.locations ?? [] });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLodgingConfirm() {
    if (!pendingTrip) return;

    if (selectedLodgingId) {
      setSavingLodging(true);
      try {
        await fetch(`/api/trips/${pendingTrip.id}/locations/${selectedLodgingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isLodging: true }),
        });
      } catch {
        // Non-fatal: user can set it manually after navigating
      } finally {
        setSavingLodging(false);
      }
    }

    router.push(`/trips/${pendingTrip.id}`);
  }

  // ── Lodging picker (step 2) ───────────────────────────────────────────────
  if (pendingTrip) {
    return (
      <div className="card p-6 space-y-5 max-w-2xl mx-auto">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Which location is your base / lodging?
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Trip Kraken prepends your lodging to every day so the optimizer always routes from there.
            You can change this later.
          </p>
        </div>

        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {pendingTrip.locations.map((loc) => (
            <li key={loc.id}>
              <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <input
                  type="radio"
                  name="lodging"
                  value={loc.id}
                  checked={selectedLodgingId === loc.id}
                  onChange={() => setSelectedLodgingId(loc.id)}
                  className="accent-brand-600 h-4 w-4 flex-shrink-0"
                />
                <span className="text-sm text-gray-800 dark:text-gray-200">{loc.name}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => router.push(`/trips/${pendingTrip.id}`)}
            className="text-sm text-gray-500 dark:text-gray-400 hover:underline"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleLodgingConfirm}
            disabled={savingLodging || !selectedLodgingId}
            className="btn-primary"
          >
            {savingLodging ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Saving…
              </span>
            ) : (
              "Confirm & open trip"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Import form (step 1) ──────────────────────────────────────────────────
  return (
    <div className="card p-6 space-y-5 max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="url" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Google My Maps link
          </label>
          <input
            id="url"
            type="url"
            required
            placeholder="https://www.google.com/maps/d/viewer?mid=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="input"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Trip name{" "}
            <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            placeholder="Tokyo week"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 leading-relaxed">
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
          <strong className="text-gray-700 dark:text-gray-200">Anyone with the link can view</strong>{" "}
          and paste the URL here.
          Coordinates are embedded in the map — no extra processing needed.
        </p>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

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
