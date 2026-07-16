"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TripWithDetails } from "@/types";

// How long to poll silently before offering a way past a stuck import (#124 — startup
// auto-recovery for pending rows lost to a server restart — isn't landed yet, so this page
// can't fully trust that `pending` always resolves on its own).
const ESCAPE_HATCH_DELAY_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;

type Phase = "polling" | "stuck";

export default function ImportingClient({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("polling");

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    function done() {
      if (!cancelled) router.replace(`/trips/${tripId}?imported=1`);
    }

    async function poll() {
      try {
        const res = await fetch(`/api/trips/${tripId}`);
        if (res.ok) {
          const trip: TripWithDetails = await res.json();
          const anyPending = trip.locations.some((l) => l.enrichmentStatus === "pending");
          if (!anyPending) return done();
        }
      } catch {
        // ignored — retried on the next tick, same as tripStore's pollEnrichment
      }
      if (!cancelled) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    const escapeHatchTimer = setTimeout(() => {
      if (!cancelled) setPhase("stuck");
    }, ESCAPE_HATCH_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearTimeout(escapeHatchTimer);
    };
  }, [tripId, router]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
      <Spinner />
      <p className="text-body text-sub">Fetching details for your imported places…</p>
      {phase === "stuck" && (
        <button
          onClick={() => router.replace(`/trips/${tripId}?imported=1`)}
          className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
        >
          Taking a while — continue anyway →
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-8 w-8 text-brand-600 dark:text-brand-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
