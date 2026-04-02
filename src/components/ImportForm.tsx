"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Method = "url" | "csv" | "kml";

const METHOD_CONFIG: Record<
  Method,
  { label: string; description: string; hint: React.ReactNode }
> = {
  url: {
    label: "Shared URL",
    description: "Paste a publicly shared Google Maps list link.",
    hint: (
      <>
        In Google Maps, open a list → tap <strong>Share</strong> → copy the
        link. The list must be set to <em>Anyone with the link</em>.
      </>
    ),
  },
  csv: {
    label: "Google Takeout CSV",
    description: "Export your saved places from Google and upload the CSV.",
    hint: (
      <>
        Go to{" "}
        <a
          href="https://takeout.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-brand-600"
        >
          takeout.google.com
        </a>
        , select only <strong>Saved</strong>, export, then upload the{" "}
        <code className="text-xs bg-gray-100 px-1 rounded">.csv</code> file for
        the list you want.
      </>
    ),
  },
  kml: {
    label: "KML / KMZ",
    description: "Export a Google My Maps layer and upload the file.",
    hint: (
      <>
        Open{" "}
        <a
          href="https://mymaps.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-brand-600"
        >
          mymaps.google.com
        </a>
        , open your map → ⋮ menu → <strong>Export to KML/KMZ</strong>. Both
        formats are accepted. Coordinates are embedded — no geocoding step
        required.
      </>
    ),
  },
};

export default function ImportForm() {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    // Pre-fill trip name from filename (strip extension)
    if (f && !name) {
      setName(f.name.replace(/\.(csv|kml|kmz)$/i, "").replace(/[_-]/g, " "));
    }
  }

  function handleMethodChange(next: Method) {
    setMethod(next);
    setError(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let res: Response;

      if (method === "url") {
        res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined }),
        });
      } else {
        if (!file) {
          setError("Please select a file.");
          setLoading(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        if (name.trim()) fd.append("name", name.trim());

        res = await fetch(`/api/import/${method}`, {
          method: "POST",
          body: fd,
        });
      }

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

  const cfg = METHOD_CONFIG[method];
  const canSubmit =
    !loading && (method === "url" ? url.trim().length > 0 : file !== null);

  const fileAccept =
    method === "csv" ? ".csv" : ".kml,.kmz";
  const filePlaceholder =
    method === "csv" ? "Saved Places.csv" : "My Map.kml or My Map.kmz";

  return (
    <div className="card p-6 space-y-5 max-w-2xl mx-auto">
      {/* Method tabs */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        {(Object.keys(METHOD_CONFIG) as Method[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => handleMethodChange(m)}
            className={`flex-1 py-2 text-sm font-medium transition-colors
              ${method === m
                ? "bg-brand-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
          >
            {METHOD_CONFIG[m].label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Method-specific input */}
        {method === "url" ? (
          <div className="space-y-1.5">
            <label htmlFor="url" className="text-sm font-medium text-gray-700">
              Google Maps list URL
            </label>
            <input
              id="url"
              type="url"
              required
              placeholder="https://maps.app.goo.gl/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="input"
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              {method === "csv" ? "Takeout CSV file" : "KML or KMZ file"}
            </label>
            <label
              className={`flex items-center gap-3 w-full rounded-lg border-2 border-dashed px-4 py-5
                cursor-pointer transition-colors
                ${file
                  ? "border-brand-400 bg-brand-50"
                  : "border-gray-300 hover:border-gray-400 bg-white"
                }`}
            >
              <span className="text-2xl">{file ? "✓" : "📂"}</span>
              <span className="text-sm text-gray-600 min-w-0">
                {file ? (
                  <span className="font-medium text-brand-700 truncate block">
                    {file.name}
                  </span>
                ) : (
                  <>
                    <span className="font-medium">Click to choose</span> or drag
                    &amp; drop
                    <span className="block text-gray-400 text-xs mt-0.5">
                      {filePlaceholder}
                    </span>
                  </>
                )}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept={fileAccept}
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
          </div>
        )}

        {/* Trip name — shared across all methods */}
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

        {/* Inline hint for the active method */}
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
          {cfg.hint}
        </p>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner />
              {method === "url"
                ? "Importing — this may take ~30 seconds…"
                : "Importing…"}
            </span>
          ) : (
            "Import list"
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
