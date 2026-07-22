"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { LocationInspectorContent } from "./LocationInspector";

const W = 280;
const MARGIN = 12;

/**
 * The itinerary's location inspector as an anchored popover (#134 — interaction locality:
 * detail appears beside the clicked row, not in a distant panel). Anchors to the DOM element
 * carrying `data-inspect-anchor=<locationId>`; if that row isn't mounted (its day was paged
 * away), there's nothing to anchor to and the popover doesn't render.
 */
export default function InspectorPopover() {
  const inspectedLocationId = useTripStore((s) => s.inspectedLocationId);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const trip = useTripStore((s) => s.trip);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure the anchor after render (the focal-stack spring settles the row's final position a
  // beat later, but the anchor's neighborhood is right immediately — good enough to open at).
  useLayoutEffect(() => {
    if (!inspectedLocationId) { setPos(null); return; }
    const anchor = document.querySelector(`[data-inspect-anchor="${CSS.escape(inspectedLocationId)}"]`);
    if (!anchor) { setPos(null); return; }
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(rect.right + 10, window.innerWidth - W - MARGIN));
    const top = Math.max(MARGIN, Math.min(rect.top - 8, window.innerHeight - 320));
    setPos({ left, top });
  }, [inspectedLocationId]);

  useEffect(() => {
    if (!inspectedLocationId) return;
    function onDown(e: PointerEvent) {
      const target = e.target as Node;
      // Clicks on the anchor row itself already toggle the inspector — don't double-close.
      const anchor = document.querySelector(`[data-inspect-anchor="${CSS.escape(inspectedLocationId!)}"]`);
      if (ref.current && !ref.current.contains(target) && !(anchor && anchor.contains(target))) {
        setInspectedLocationId(null);
      }
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [inspectedLocationId, setInspectedLocationId]);

  if (!inspectedLocationId || !trip || !pos) return null;
  const loc = trip.locations.find((l) => l.id === inspectedLocationId);
  if (!loc) return null;

  return (
    <div
      ref={ref}
      className="fixed z-40 card shadow-xl p-3 space-y-3 max-h-[60vh] overflow-y-auto"
      style={{ left: pos.left, top: pos.top, width: W }}
      role="dialog"
      aria-label={`Details for ${loc.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink leading-snug">{loc.name}</p>
        <button
          onClick={() => setInspectedLocationId(null)}
          className="text-faint hover:text-sub shrink-0 transition-colors"
          aria-label="Close inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <LocationInspectorContent loc={loc} />
    </div>
  );
}
