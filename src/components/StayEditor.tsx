"use client";

import { useState } from "react";
import { useTripStore } from "@/store/tripStore";

/** A booking row in the editor. Dates are `yyyy-mm-dd` (what <input type="date"> speaks). */
type DraftStay = { lodgingLocationId: string; checkInDate: string; checkOutDate: string };

const dateOf = (iso: string) => iso.slice(0, 10);
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export default function StayEditor() {
  const trip = useTripStore((s) => s.trip);
  const saveStays = useTripStore((s) => s.saveStays);
  const setShowStays = useTripStore((s) => s.setShowStays);

  const locations = trip?.locations ?? [];
  const tripStart = trip?.startDate ? dateOf(new Date(trip.startDate).toISOString()) : "";

  const [draft, setDraft] = useState<DraftStay[]>(
    () =>
      trip?.stays.map((s) => ({
        lodgingLocationId: s.lodgingLocationId,
        checkInDate: s.checkInDate,
        checkOutDate: s.checkOutDate,
      })) ?? []
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
    // New booking starts where the last one ended (or the trip start), one night long.
    const last = draft[draft.length - 1];
    const checkInDate = last?.checkOutDate || tripStart || new Date().toISOString().slice(0, 10);
    setDraft((d) => [
      ...d,
      { lodgingLocationId: locations[0]?.id ?? "", checkInDate, checkOutDate: addDays(checkInDate, 1) },
    ]);
  }

  function removeRow(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(null);
    if (draft.some((s) => !s.lodgingLocationId)) {
      setError("Pick a lodging for every booking");
      return;
    }
    if (draft.some((s) => !s.checkInDate || !s.checkOutDate)) {
      setError("Every booking needs a check-in and check-out date");
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
      <div className="card w-full max-w-xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Lodging bookings</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            One row per reservation: where you sleep, from check-in to check-out. Each day&apos;s
            start and end anchor is derived from these. Leave empty for a trip with no fixed lodging.
          </p>
        </div>

        {draft.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic text-center py-3">No bookings yet.</p>
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
                <input
                  type="date"
                  value={s.checkInDate}
                  onChange={(e) => update(i, { checkInDate: e.target.value })}
                  aria-label="Check-in date"
                  className="input w-36 py-1.5 text-sm"
                />
                <span className="text-gray-400 shrink-0">→</span>
                <input
                  type="date"
                  value={s.checkOutDate}
                  min={s.checkInDate || undefined}
                  onChange={(e) => update(i, { checkOutDate: e.target.value })}
                  aria-label="Check-out date"
                  className="input w-36 py-1.5 text-sm"
                />
                <button
                  onClick={() => removeRow(i)}
                  aria-label="Remove booking"
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <button onClick={addRow} className="btn-secondary text-sm" disabled={locations.length === 0}>
          + Add booking
        </button>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={close} className="btn-secondary text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save bookings"}
          </button>
        </div>
      </div>
    </div>
  );
}
