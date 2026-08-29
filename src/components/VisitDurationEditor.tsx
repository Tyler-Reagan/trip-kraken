"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTripStore } from "@/store/tripStore";
import {
  VISIT_DURATION_OPTIONS,
  formatDuration,
  nearestVisitDurationIndex,
  nextVisitDuration,
  resolveVisitDuration,
} from "@/lib/visitDuration";
import type { Location } from "@/types";

/**
 * The one duration editor, mounted both on a Places-page row (`ActivityRow`) and in the
 * `LocationInspector` — extracted rather than duplicated (ADR-0023 §9, amended 2026-08-18) so an
 * edit in either place goes through the store's optimistic `updateLocation` instead of a bypassing
 * raw fetch.
 *
 * Two controls over one value: ± walks the coarse ladder (`nextVisitDuration`) for nudges, and
 * clicking the value opens a roller carrying every 15-minute stop for jumps. They're complementary,
 * not redundant — the ladder is cheap for "a bit longer", the roller is one gesture to anywhere.
 * The roller is a single flat list of durations rather than hours × minutes columns: a duration is
 * one scalar, and a two-column picker can express `0h 00m`, which isn't a legal value.
 *
 * Three behaviors here are load-bearing and predate this control's visual design:
 *
 * 1. The dirty check is against the raw `loc.visitDuration` (null-aware), never the resolved
 *    default. Seeding from the *effective* value and comparing against it would make merely opening
 *    the roller look like the user chose 30. `touchedRef` exists so only an actual edit commits —
 *    the programmatic scroll that positions the roller on open must not count as one.
 * 2. No coordination between simultaneous mounts for the same Location (the Places row and an open
 *    Inspector). Whichever instance isn't mid-edit renders `loc.visitDuration` fresh off the store,
 *    so two open editors stay in sync without a suppression flag.
 * 3. One interaction, one write. A stepper invites click storms and a roller fires scroll events
 *    continuously, so the commit is a trailing debounce — flushed on close and on unmount so a
 *    dismissed editor never drops the user's last edit.
 */

/** Must match the `h-8` on each roller row; the scroll maths reads positions in these units. */
const ROLLER_ROW_H = 32;
const COMMIT_DEBOUNCE_MS = 400;

export default function VisitDurationEditor({ loc }: { loc: Location }) {
  const updateLocation = useTripStore((s) => s.updateLocation);
  const [draft, setDraft] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const value = draft ?? resolveVisitDuration(loc.visitDuration);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Only a real gesture may commit — a programmatic scroll on open must not (see #1 above).
  const touchedRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read through refs so the debounce and the unmount flush always see the current props, never
  // the values captured when the timer was scheduled.
  const locRef = useRef(loc);
  locRef.current = loc;
  const updateRef = useRef(updateLocation);
  updateRef.current = updateLocation;

  function writePending() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next !== null && next !== locRef.current.visitDuration) {
      updateRef.current(locRef.current.id, { visitDuration: next });
    }
  }
  const writeRef = useRef(writePending);
  writeRef.current = writePending;

  function schedule(next: number) {
    setDraft(next);
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      writeRef.current();
      setDraft(null);
    }, COMMIT_DEBOUNCE_MS);
  }

  function close() {
    setOpen(false);
    writeRef.current();
    setDraft(null);
  }

  function useDefault() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    setDraft(null);
    setOpen(false);
    if (loc.visitDuration !== null)
      updateLocation(loc.id, { visitDuration: null });
  }

  // A pending edit outlives this component — closing the Inspector mid-debounce must still save.
  useEffect(() => () => writeRef.current(), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Position on open only — re-running as the value changes would fight the user's own scrolling.
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    touchedRef.current = false;
    listRef.current.scrollTop = nearestVisitDurationIndex(value) * ROLLER_ROW_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleScroll() {
    const el = listRef.current;
    if (!el || !touchedRef.current) return;
    const i = Math.max(
      0,
      Math.min(
        VISIT_DURATION_OPTIONS.length - 1,
        Math.round(el.scrollTop / ROLLER_ROW_H),
      ),
    );
    schedule(VISIT_DURATION_OPTIONS[i]);
  }

  function handleRollerKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = listRef.current;
    if (!el) return;
    const cur = nearestVisitDurationIndex(value);
    const last = VISIT_DURATION_OPTIONS.length - 1;
    let next = cur;
    if (e.key === "ArrowDown") next = cur + 1;
    else if (e.key === "ArrowUp") next = cur - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    touchedRef.current = true;
    next = Math.max(0, Math.min(last, next));
    el.scrollTop = next * ROLLER_ROW_H;
    schedule(VISIT_DURATION_OPTIONS[next]);
  }

  const selectedIdx = nearestVisitDurationIndex(value);
  const isDefault = loc.visitDuration === null;

  return (
    // inline-flex, not flex: the Inspector mounts this under a plain block parent, where a
    // block-level flex container would stretch to the full panel width (and drag `min-w-full` on
    // the popover with it). As a flex item in the Manifest row, inline-flex blockifies to the same
    // content-sized box, so both mounts get one shrink-wrapped control.
    <div
      ref={rootRef}
      className="relative inline-flex items-center shrink-0 h-7 rounded-lg border border-line-strong bg-surface-2"
    >
      <button
        type="button"
        onClick={() => schedule(nextVisitDuration(value, -1))}
        className="w-7 h-[26px] grid place-items-center rounded-l-md text-faint hover:bg-surface-3 hover:text-ink active:text-brand-600 dark:active:text-brand-400"
        aria-label="Shorter visit"
      >
        −
      </button>

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Visit duration, ${formatDuration(value)}${isDefault ? " (default)" : ""}`}
        className={`min-w-[58px] h-[26px] text-numeral text-center hover:bg-surface-3 ${
          isDefault ? "text-faint font-medium" : "text-ink"
        } ${open ? "bg-brand-50 dark:bg-brand-950" : ""}`}
      >
        {formatDuration(value)}
      </button>

      <button
        type="button"
        onClick={() => schedule(nextVisitDuration(value, 1))}
        className="w-7 h-[26px] grid place-items-center rounded-r-md text-faint hover:bg-surface-3 hover:text-ink active:text-brand-600 dark:active:text-brand-400"
        aria-label="Longer visit"
      >
        +
      </button>

      {open && (
        // `min-w-full` (not a fixed width) keeps the popover the size of the control it hangs off,
        // so it doesn't overhang into the Inspector's `overflow-y-auto` clipping box.
        <div className="card absolute right-0 top-[calc(100%+6px)] z-30 min-w-full p-2 shadow-xl">
          <div className="relative flex justify-center">
            {/* Bottom-anchored: the list is always 96px tall and sits at the bottom of this box, so
                the selected row is always 32–64px up from the bottom edge. */}
            <div className="pointer-events-none absolute inset-x-0.5 bottom-8 h-8 rounded-md border-y border-line-strong bg-brand-50 dark:bg-brand-950" />
            <div className="pointer-events-none absolute inset-x-0 bottom-[66px] h-[30px] z-[2] bg-gradient-to-b from-surface to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30px] z-[2] bg-gradient-to-t from-surface to-transparent" />
            <div
              ref={listRef}
              onScroll={handleScroll}
              onWheel={() => (touchedRef.current = true)}
              onPointerDown={() => (touchedRef.current = true)}
              onKeyDown={handleRollerKey}
              tabIndex={0}
              role="listbox"
              aria-label="Visit duration"
              className="relative z-[1] h-24 overflow-y-auto snap-y snap-mandatory outline-none rounded-md focus-visible:ring-2 focus-visible:ring-brand-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="h-8" />
              {VISIT_DURATION_OPTIONS.map((m, i) => (
                <div
                  key={m}
                  role="option"
                  aria-selected={i === selectedIdx}
                  className={`h-8 px-2.5 grid place-items-center snap-center text-numeral whitespace-nowrap transition-colors ${
                    i === selectedIdx ? "text-ink" : "text-faint"
                  }`}
                >
                  {formatDuration(m)}
                </div>
              ))}
              <div className="h-8" />
            </div>
          </div>

          {/* No "currently using the default" line: the dimmed value already says that, and a
              second copy is what forced this popover wider than the control. */}
          <button
            type="button"
            onClick={useDefault}
            disabled={isDefault}
            className="mt-2 pt-1.5 w-full whitespace-nowrap border-t border-line text-[11px] text-faint hover:text-ink disabled:opacity-40 disabled:hover:text-faint"
          >
            Use default ({formatDuration(resolveVisitDuration(null))})
          </button>
        </div>
      )}
    </div>
  );
}
