"use client";

import { useState } from "react";
import { useTripStore } from "@/store/tripStore";
import { resolveVisitDuration, VISIT_DURATION_STEP_MINUTES } from "@/lib/visitDuration";
import type { Location } from "@/types";

/**
 * The one duration editor, mounted both on a Places-page row (`ActivityRow`) and in the
 * `LocationInspector` — extracted rather than duplicated (ADR-0023 §9, amended 2026-08-18) so an
 * edit in either place goes through the store's optimistic `updateLocation` instead of a bypassing
 * raw fetch.
 *
 * No coordination between simultaneous mounts for the same Location: whichever instance isn't
 * currently focused always renders `loc.visitDuration` fresh off the store, so two open editors for
 * one Location stay in sync without a suppression flag — the store is the only thing either of them
 * remembers between renders.
 *
 * The dirty check is against the raw `loc.visitDuration` (null-aware), never the resolved default —
 * seeding the input from the *effective* value and comparing against it would make a plain
 * focus-then-blur, with no typing at all, look like the user chose 30. `touched` exists so only an
 * actual edit can commit.
 */
export default function VisitDurationEditor({ loc }: { loc: Location }) {
  const updateLocation = useTripStore((s) => s.updateLocation);
  const [draft, setDraft] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);

  const committed = resolveVisitDuration(loc.visitDuration);
  const value = draft ?? committed;

  function handleFocus() {
    setDraft(committed);
    setTouched(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    setDraft(Number.isNaN(parsed) ? VISIT_DURATION_STEP_MINUTES : Math.max(VISIT_DURATION_STEP_MINUTES, parsed));
    setTouched(true);
  }

  function handleBlur() {
    if (touched && draft !== null && draft !== loc.visitDuration) {
      updateLocation(loc.id, { visitDuration: draft });
    }
    setDraft(null);
    setTouched(false);
  }

  const inputCls =
    "w-14 text-sm text-center bg-surface-2 border border-line border-line-strong rounded px-1 py-0.5 " +
    "focus:outline-none focus:ring-1 focus:ring-brand-400 " +
    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step={VISIT_DURATION_STEP_MINUTES}
        min={VISIT_DURATION_STEP_MINUTES}
        value={value}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={inputCls}
        aria-label="Visit duration in minutes"
      />
      <span className="text-xs text-faint">min</span>
      {loc.visitDuration !== null && (
        <button
          type="button"
          onClick={() => updateLocation(loc.id, { visitDuration: null })}
          className="text-xs text-faint hover:text-sub underline decoration-dotted"
          title={`Use the default (${resolveVisitDuration(null)} min)`}
        >
          reset
        </button>
      )}
    </div>
  );
}
