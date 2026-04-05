"use client";

import { useState, useEffect, useRef } from "react";

export default function HelpButton() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={containerRef} className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Floating instructions panel */}
      <div
        className={`w-80 card p-5 space-y-3 shadow-xl transition-all duration-200
          ${open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-2 pointer-events-none"
          }`}
        aria-hidden={!open}
      >
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">How to get your map link</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <li>
            Go to{" "}
            <a
              href="https://mymaps.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-brand-600 dark:text-brand-400"
              tabIndex={open ? 0 : -1}
            >
              mymaps.google.com
            </a>{" "}
            and create a map.
          </li>
          <li>Add placemarks for all the locations you want to visit.</li>
          <li>
            Click <strong className="text-gray-700 dark:text-gray-300">Share</strong> and set
            access to <strong className="text-gray-700 dark:text-gray-300">Anyone with the link can view</strong>.
          </li>
          <li>Copy the URL from your browser&apos;s address bar and paste it in the import field.</li>
        </ol>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          The map must be public for import to work. Coordinates are read directly from the map — no extra steps needed.
        </p>
      </div>

      {/* ? toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close help" : "Open help"}
        aria-expanded={open}
        className="w-10 h-10 rounded-full bg-brand-600 dark:bg-brand-500 text-white
          flex items-center justify-center text-lg font-bold shadow-lg
          hover:bg-brand-500 dark:hover:bg-brand-400
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
          focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 dark:focus-visible:ring-offset-gray-950
          transition-colors"
      >
        ?
      </button>
    </div>
  );
}
