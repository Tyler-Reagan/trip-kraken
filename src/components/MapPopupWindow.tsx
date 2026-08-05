"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Moveable from "react-moveable";
import { X } from "lucide-react";
import { useTripStore } from "@/store/tripStore";

const MapView = dynamic(() => import("./MapView"), { ssr: false });
// Moveable is a class component; a static import (it's import-safe, and only ever *rendered*
// client-side, below, after `ready`) is what lets its ref forward — next/dynamic would swallow it.

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
 * Drag/resize is react-moveable, applied the way moveable actually wants: **uncontrolled during the
 * gesture**. The geometry lives in a ref and is written straight to the DOM in each handler; React
 * never re-renders mid-gesture. Driving it through React state instead makes moveable and React
 * race over the target's rect every frame — that was the source of the resize jitter. State exists
 * only to survive close/reopen (the component stays mounted and returns null while closed, so the
 * ref persists; the window comes back exactly where it was left).
 */
export default function MapPopupWindow() {
  const mapPopupOpen = useTripStore((s) => s.mapPopupOpen);
  const setMapPopupOpen = useTripStore((s) => s.setMapPopupOpen);

  const frameRef = useRef<Frame>(defaultFrame());
  const windowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const [ready, setReady] = useState(false);

  // Write the ref's geometry to the DOM. The single point that touches the element's box, shared by
  // open, viewport-resize, and (indirectly, via the handlers below) every drag/resize frame.
  const applyFrame = () => {
    const el = windowRef.current;
    if (!el) return;
    const f = frameRef.current;
    el.style.transform = `translate(${f.x}px, ${f.y}px)`;
    el.style.width = `${f.w}px`;
    el.style.height = `${f.h}px`;
  };

  // Moveable needs one paint to measure its target; gate it on this rather than mounting it dry.
  useEffect(() => setReady(true), []);

  // On open, and whenever the viewport changes, pull the window fully back into view (a shrunk
  // viewport must never strand it with no title bar to grab) and realign moveable's control box.
  useLayoutEffect(() => {
    if (!mapPopupOpen) return;
    const reclamp = () => {
      const f = frameRef.current;
      f.x = clamp(f.x, 0, window.innerWidth - f.w);
      f.y = clamp(f.y, 0, window.innerHeight - f.h);
      applyFrame();
      moveableRef.current?.updateRect();
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [mapPopupOpen]);

  if (!mapPopupOpen) return null;

  const f = frameRef.current;

  return (
    <>
      <div
        ref={windowRef}
        className="fixed left-0 top-0 z-40 card shadow-2xl overflow-hidden flex flex-col"
        style={{ transform: `translate(${f.x}px, ${f.y}px)`, width: f.w, height: f.h }}
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
          ref={moveableRef}
          className="tk-map-moveable"
          target={windowRef}
          dragTarget={titleRef}
          draggable
          resizable
          hideDefaultLines
          origin={false}
          // All eight edges/corners, not just one grip.
          renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
          // Snap to the viewport edges/centre as the window nears them — the reason to buy the lib.
          snappable
          snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
          bounds={{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, position: "client" }}
          // Uncontrolled: mutate the DOM here, record it in the ref, never setState mid-gesture.
          onDrag={({ target, beforeTranslate }) => {
            const fr = frameRef.current;
            fr.x = beforeTranslate[0];
            fr.y = beforeTranslate[1];
            (target as HTMLElement).style.transform = `translate(${fr.x}px, ${fr.y}px)`;
          }}
          onResize={({ target, width, height, drag }) => {
            const fr = frameRef.current;
            // Enforce the min by simply not applying past it: moveable reads the DOM back each
            // frame, so leaving the box at the floor is what holds the floor — no divergence.
            if (width >= MIN_W) { fr.w = width; fr.x = drag.beforeTranslate[0]; }
            if (height >= MIN_H) { fr.h = height; fr.y = drag.beforeTranslate[1]; }
            const el = target as HTMLElement;
            el.style.width = `${fr.w}px`;
            el.style.height = `${fr.h}px`;
            el.style.transform = `translate(${fr.x}px, ${fr.y}px)`;
          }}
        />
      )}
    </>
  );
}
