"use client";

/**
 * Palette status board for design-roadmap.md Phase c. Renders real component chrome with
 * the actual `bg-brand-*` / `bg-danger-*` Tailwind classes (not inline hex) so what's shown
 * here is exactly what's baked into tailwind.config.ts — no separate source of truth.
 * Delete once Phase c's remaining open items (day-hue retune, icon set, type scale) land.
 */

import { useEffect, useState } from "react";
import { DAY_COLORS, dayColorCss, dayTextColor } from "@/lib/dayColors";

export default function ThemePrototype() {
  const [dark, setDark] = useState(true);

  // The app's <html> is hardcoded `className="dark"` (layout.tsx) — light mode isn't wired
  // up anywhere yet, so Tailwind's `dark:` variant (which matches on a `.dark` ancestor,
  // and html is always that ancestor) is effectively always on. Toggle the real html class
  // while this page is mounted so the light-mode preview is genuine, and restore it on
  // unmount since dark is the app's actual current default.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    return () => root.classList.add("dark");
  }, [dark]);

  return (
    <div>
      <div className="min-h-screen bg-canvas text-ink p-8">
        <div className="max-w-3xl mx-auto space-y-10">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold mb-1">Palette status</h1>
              <p className="text-sm text-sub">
                design-roadmap.md Phase c. Confirmed tokens render below using their real
                Tailwind classes; open items are listed, not prototyped, until there's
                something concrete to compare.
              </p>
            </div>
            <button
              onClick={() => setDark((d) => !d)}
              className="shrink-0 btn-secondary text-sm"
            >
              {dark ? "Switch to light" : "Switch to dark"}
            </button>
          </header>

          {/* Confirmed: accent */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-sub uppercase tracking-wide">
              Confirmed — accent (brand-*)
            </h2>
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-brand-600 dark:bg-brand-500 shrink-0" aria-hidden />
                <span className="font-semibold text-[0.9375rem]">Day 3 · Kyoto</span>
                <span className="ml-auto text-sm text-sub">4 stops · 5h 20m</span>
              </div>
              <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-brand-50 dark:bg-brand-950/30">
                <span className="w-[22px] h-[22px] rounded-full bg-brand-600 dark:bg-brand-500 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                  2
                </span>
                <span className="text-sm">Nishiki Market</span>
                <span className="ml-auto text-xs text-brand-600 dark:text-brand-400 font-medium">
                  Selected
                </span>
              </div>
              <div className="flex gap-2.5 flex-wrap pt-1">
                <button className="btn-primary text-sm">Optimize itinerary</button>
                <button className="btn-secondary text-sm">Cancel</button>
                <span
                  tabIndex={0}
                  className="px-3 py-1.5 rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  Focus ring (tab to me)
                </span>
              </div>
            </div>
            <p className="text-xs text-faint">
              One teal/ink family for CTAs, selection, focus rings, and the kraken mark —
              600/700 for light surfaces, 400/500 for dark. No second accent hue.
            </p>
          </section>

          {/* Confirmed: danger */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-sub uppercase tracking-wide">
              Confirmed — danger (danger-*)
            </h2>
            <div className="card p-4 space-y-3">
              <p className="text-sm bg-danger-50 dark:bg-danger-950 border border-danger-200 dark:border-danger-800 text-danger-600 dark:text-danger-400 rounded-lg px-3 py-2">
                Could not import file — check the format and try again.
              </p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-faint">Remove stop</span>
                <button className="w-7 h-7 rounded flex items-center justify-center text-faint hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors">
                  ×
                </button>
              </div>
            </div>
            <p className="text-xs text-faint">
              Muted brick-red rather than stock Tailwind red — stays quiet next to the teal
              accent instead of competing with it. Same 11-step scale shape as brand-*.
            </p>
          </section>

          {/* Confirmed: day-hue wheel */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-sub uppercase tracking-wide">
              Confirmed — day-hue wheel (src/lib/dayColors.ts)
            </h2>
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {DAY_COLORS.map((_, i) => {
                  const day = i + 1;
                  return (
                    <div
                      key={day}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                      style={{ backgroundColor: dayColorCss(day), color: dayTextColor(day) }}
                      title={`Day ${day}`}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 pt-1 text-xs text-sub">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-brand-600 dark:bg-brand-500" aria-hidden />
                  accent (excluded ±~20°)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-danger-600 dark:bg-danger-500" aria-hidden />
                  danger (excluded ±~20°)
                </span>
              </div>
            </div>
            <p className="text-xs text-faint">
              One 14-hue wheel at a fixed HSL(_, 62%, 58%) — a designed system rather than
              mismatched Tailwind swatches — with two ~30°-wide gaps carved out around the
              accent (~178°) and danger (~8°) hues. The old palette had a{" "}
              <code className="text-xs">teal-400</code> (day 11) and{" "}
              <code className="text-xs">red-400</code> (day 6) close enough to be confusable
              with selection/error state; this set can't produce that collision.
            </p>
          </section>

          {/* Still open */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-sub uppercase tracking-wide">
              Still open
            </h2>
            <ul className="text-sm space-y-2 text-sub list-disc pl-5">
              <li>
                <span className="text-ink">Icon set</span> — emoji (🐙🏨🚆🗺️) mixed with a
                couple of hand-rolled SVGs; not a color decision but the icon stroke color
                will inherit from these tokens once unified.
              </li>
              <li>
                <span className="text-ink">Type scale + weight strategy</span> — untouched
                by this pass.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
