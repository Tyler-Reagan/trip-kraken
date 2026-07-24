"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";

const MapView = dynamic(() => import("./MapView"), { ssr: false });
// react-moveable touches `window` on import; keep it out of the server bundle.
const Moveable = dynamic(() => import("react-moveable"), { ssr: false });

type Frame = { x: number; y: number; w: number; h: number };

const MARGIN = 24;
const DEFAULT_W = 540;
const DEFAULT_H = 500;
const MIN_W = 380;
const MIN_H = 320;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Where the window used to be pinned (`right-6 top-24`), but as real coordinates so it can move. */
function defaultFrame(): Frame {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  return { x: Math.max(MARGIN, vw - DEFAULT_W - MARGIN), y: 96, w: DEFAULT_W, h: DEFAULT_H };
}

/**
 * The map as a floating popup window (#134): pulled out of the page layout entirely, toggled from
 * the trip controls, dragged by its title bar and resized from any edge/corner. What renders
 * *inside* the canvas stays owned by the Maps UI overhaul (#128) — this component owns only the
 * window chrome and its placement.
 *
 * Drag/resize is react-moveable rather than hand-rolled: it owns pointer capture, edge handles, and
 * selection suppression during a gesture — the exact things the hand-rolled version kept getting
 * wrong. We stay the source of truth for the geometry (so the window persists where it's left) and
 * feed each gesture's result straight back into `frame`.
 */
export default function MapPopupWindow() {
  const mapPopupOpen = useTripStore((s) => s.mapPopupOpen);
  const setMapPopupOpen = useTripStore((s) => s.setMapPopupOpen);

  // Geometry lives here rather than in the store: nothing else needs to know where the window is,
  // and component state outlives closing it (the component stays mounted and returns null), so the
  // map reopens exactly where it was left. `position: fixed` + a translate makes x/y plain viewport
  // pixels, which is the coordinate system react-moveable's client bounds already speak.
  const [frame, setFrame] = useState<Frame>(defaultFrame);
  const windowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // Moveable measures its target on mount; give it one paint to exist first, and re-measure on
  // viewport resize. The same resize also pulls a window that fell off-screen back into reach —
  // otherwise a shrunk viewport could strand it with no title bar left to grab.
  useEffect(() => {
    setReady(true);
    const onResize = () =>
      setFrame((f) => ({
        ...f,
        x: clamp(f.x, 0, window.innerWidth - f.w),
        y: clamp(f.y, 0, window.innerHeight - f.h),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!mapPopupOpen) return null;

  return (
    <>
      <div
        ref={windowRef}
        className="fixed left-0 top-0 z-40 card shadow-2xl overflow-hidden flex flex-col"
        style={{ transform: `translate(${frame.x}px, ${frame.y}px)`, width: frame.w, height: frame.h }}
      >
        <div
          ref={titleRef}
          className="flex items-center justify-between px-3 py-1.5 border-b border-line bg-surface-2 shrink-0 cursor-grab active:cursor-grabbing"
        >
          <p className="text-xs font-medium text-ink select-none">Map</p>
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
      </div>

      {ready && (
        <Moveable
          className="tk-map-moveable"
          target={windowRef}
          dragTarget={titleRef}
          draggable
          resizable
          hideDefaultLines
          origin={false}
          // All eight edges/corners, not just one grip.
          renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
          // Snap to the viewport edges as the window nears them — the whole reason to buy the lib.
          snappable
          snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
          bounds={{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, position: "client" }}
          onDrag={({ beforeTranslate }) =>
            setFrame((f) => ({ ...f, x: beforeTranslate[0], y: beforeTranslate[1] }))
          }
          onResize={({ width, height, drag }) =>
            setFrame((f) => ({
              ...f,
              w: Math.max(width, MIN_W),
              h: Math.max(height, MIN_H),
              x: drag.beforeTranslate[0],
              y: drag.beforeTranslate[1],
            }))
          }
        />
      )}
    </>
  );
}
