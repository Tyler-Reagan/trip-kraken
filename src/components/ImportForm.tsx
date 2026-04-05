"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ImportForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      router.push(`/trips/${data.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-6 space-y-5 max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="url" className="text-sm font-medium text-gray-700">
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
          <label htmlFor="name" className="text-sm font-medium text-gray-700">
            Trip name{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
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

        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
          Create a map at{" "}
          <a
            href="https://mymaps.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-brand-600"
          >
            mymaps.google.com
          </a>
          , add your places, then set it to{" "}
          <strong>Anyone with the link can view</strong> and paste the URL here.
          Coordinates are embedded in the map — no extra processing needed.
        </p>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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
