"use client";

import { useState } from "react";

interface Props {
  tripId: string;
  onClose: () => void;
  onAdded: () => void;
}

export default function AddLocationModal({ tripId, onClose, onAdded }: Props) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/trips/${tripId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), address: address.trim() || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to add location.");
        return;
      }

      onAdded();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="card w-full max-w-md p-6 space-y-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a location</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500">
          Added locations will appear in the sidebar. Re-optimize to include them
          in the schedule.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              required
              placeholder="Senso-ji Temple"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Address{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="2 Chome-3-1 Asakusa, Taito City, Tokyo"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={loading || !name} className="btn-primary flex-1">
              {loading ? "Adding…" : "Add location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
