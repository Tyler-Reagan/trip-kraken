"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type Rect = { x: number; y: number; w: number; h: number };

const MARGIN = 24;
const DEFAULT_W = 540;
const DEFAULT_H = 500;
const MIN_W = 380;
const MIN_H = 320;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Where the window used to be pinned (`right-6 top-24`), but as real coordinates so it can move. */
function defaultRect(): Rect {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  return { x: Math.max(MARGIN, vw - DEFAULT_W - MARGIN), y: 96, w: DEFAULT_W, h: DEFAULT_H };
}

/**
 * The map as a floating popup window (#134): pulled out of the page layout entirely, toggled from
 * the trip controls, and dragged by its title bar / resized from its corner grip. What renders
 * *inside* the canvas stays owned by the Maps UI overhaul (#128) — this component only owns the
 * window chrome and its placement.
 */
export default function MapPopupWindow() {
  const mapPopupOpen = useTripStore((s) => s.mapPopupOpen);
  const setMapPopupOpen = useTripStore((s) => s.setMapPopupOpen);
  // Geometry lives here rather than in the store: nothing else needs to know where the window is,
  // and component state outlives closing it (the component stays mounted and returns null), so the
  // map reopens exactly where it was left.
  const [rect, setRect] = useState<Rect>(defaultRect);
  const [gesture, setGesture] = useState<"move" | "resize" | null>(null);

  // A viewport that shrank out from under the window would otherwise strand it off-screen with no
  // title bar left to grab. Only ever pulls it back into view; never resizes it.
  useEffect(() => {
    const onResize = () =>
      setRect((r) => ({
        ...r,
        x: clamp(r.x, 0, window.innerWidth - r.w),
        y: clamp(r.y, 0, window.innerHeight - r.h),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // One gesture for both the title-bar drag and the corner grip — identical pointer bookkeeping,
  // differing only in which fields of the rect the delta lands on. Pointer (not mouse) events, so
  // the same code drives a mouse, finger, or pen, as elsewhere in the app.
  function startGesture(e: React.PointerEvent, mode: "move" | "resize") {
    if (e.button !== 0) return;
    // Let the close button be a button.
    if (mode === "move" && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const from = { px: e.clientX, py: e.clientY, ...rect };
    setGesture(mode);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - from.px;
      const dy = ev.clientY - from.py;
      setRect(
        mode === "move"
          ? {
              ...from,
              x: clamp(from.x + dx, 0, window.innerWidth - from.w),
              y: clamp(from.y + dy, 0, window.innerHeight - from.h),
            }
          : {
              ...from,
              w: clamp(from.w + dx, MIN_W, window.innerWidth - from.x),
              h: clamp(from.h + dy, MIN_H, window.innerHeight - from.y),
            }
      );
    };
    const stop = () => {
      setGesture(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  if (!mapPopupOpen) return null;

  return (
    <div
      className={`fixed z-40 card shadow-2xl overflow-hidden flex flex-col ${gesture ? "select-none" : ""}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        onPointerDown={(e) => startGesture(e, "move")}
        className="flex items-center justify-between px-3 py-1.5 border-b border-line bg-surface-2 shrink-0 touch-none cursor-grab active:cursor-grabbing"
      >
        <p className="text-xs font-medium text-ink">Map</p>
        <button
          onClick={() => setMapPopupOpen(false)}
          className="text-faint hover:text-sub transition-colors"
          aria-label="Close map"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <MapView />
      </div>

      {/* Corner grip: the classic two-line hatch, drawn rather than iconed so it stays a hairline. */}
      <span
        onPointerDown={(e) => startGesture(e, "resize")}
        role="separator"
        aria-label="Resize map"
        className="absolute bottom-0 right-0 w-4 h-4 z-10 cursor-nwse-resize touch-none"
        style={{
          background:
            "linear-gradient(135deg, transparent 45%, var(--border-strong) 45%, var(--border-strong) 58%, transparent 58%, transparent 70%, var(--border-strong) 70%, var(--border-strong) 83%, transparent 83%)",
        }}
      />
    </div>
  );
}
