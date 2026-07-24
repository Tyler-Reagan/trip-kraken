"use client";

import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

/**
 * The map as a floating popup window (#134): pulled out of the page layout entirely, toggled
 * from the trip controls. What renders *inside* the canvas stays owned by the Maps UI
 * overhaul (#128) — this component only owns the window chrome and placement.
 */
export default function MapPopupWindow() {
  const mapPopupOpen = useTripStore((s) => s.mapPopupOpen);
  const setMapPopupOpen = useTripStore((s) => s.setMapPopupOpen);

  if (!mapPopupOpen) return null;

  return (
    // Sized for the navigator the canvas now carries (#128): two tier bands and a docked stop
    // panel need more width than a bare map did, without becoming a second page column.
    <div className="fixed right-6 top-24 z-40 card shadow-2xl overflow-hidden w-[540px] max-w-[calc(100vw-3rem)]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line bg-surface-2">
        <p className="text-xs font-medium text-ink">Map</p>
        <button
          onClick={() => setMapPopupOpen(false)}
          className="text-faint hover:text-sub transition-colors"
          aria-label="Close map"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <MapView heightClass="h-[440px]" />
    </div>
  );
}
