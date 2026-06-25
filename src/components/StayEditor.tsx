"use client";

import { useState } from "react";
import { useTripStore } from "@/store/tripStore";

type DraftStay = { lodgingLocationId: string; startNight: number; endNight: number };

export default function StayEditor() {
  const trip = useTripStore((s) => s.trip);
  const saveStays = useTripStore((s) => s.saveStays);
  const setShowStays = useTripStore((s) => s.setShowStays);

  const numDays = trip?.numDays ?? null;
  const locations = trip?.locations ?? [];

  const [draft, setDraft] = useState<DraftStay[]>(
    () => trip?.stays.map((s) => ({ lodgingLocationId: s.lodgingLocationId, startNight: s.startNight, endNight: s.endNight })) ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setShowStays(false);
  }

  function update(i: number, patch: Partial<DraftStay>) {
    setDraft((d) => d.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function addRow() {
    const lastEnd = draft.length ? Math.max(...draft.map((s) => s.endNight)) : 0;
    const start = lastEnd + 1;
    const end = numDays ? Math.min(start, numDays) : start;
    setDraft((d) => [...d, { lodgingLocationId: locations[0]?.id ?? "", startNight: start, endNight: end }]);
  }

  function removeRow(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(null);
    if (draft.some((s) => !s.lodgingLocationId)) {
      setError("Pick a lodging for every stay");
      return;
    }
    setSaving(true);
    const err = await saveStays(draft);
    setSaving(false);
    if (err) setError(err);
    else close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div className="card w-full max-w-lg p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Lodging &amp; stays</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Where you sleep for each stretch of nights. The optimizer anchors each day to its stay&apos;s
            lodging. Leave empty for a trip with no fixed lodging.
            {numDays ? ` Nights run 1–${numDays}.` : ""}
          </p>
        </div>

        {draft.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic text-center py-3">No stays yet.</p>
        ) : (
          <ul className="space-y-2">
            {draft.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <select
                  value={s.lodgingLocationId}
                  onChange={(e) => update(i, { lodgingLocationId: e.target.value })}
                  className="input flex-1 min-w-0 py-1.5 text-sm"
                >
                  <option value="">Select lodging…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <span className="text-xs text-gray-400 shrink-0">nights</span>
                <input
                  type="number"
                  min={1}
                  max={numDays ?? undefined}
                  value={s.startNight}
                  onChange={(e) => update(i, { startNight: Number(e.target.value) })}
                  className="input w-14 py-1.5 text-sm text-center"
                />
                <span className="text-gray-400">–</span>
                <input
                  type="number"
                  min={s.startNight}
                  max={numDays ?? undefined}
                  value={s.endNight}
                  onChange={(e) => update(i, { endNight: Number(e.target.value) })}
                  className="input w-14 py-1.5 text-sm text-center"
                />
                <button
                  onClick={() => removeRow(i)}
                  aria-label="Remove stay"
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <button onClick={addRow} className="btn-secondary text-sm" disabled={locations.length === 0}>
          + Add stay
        </button>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={close} className="btn-secondary text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save stays"}
          </button>
        </div>
      </div>
    </div>
  );
}
