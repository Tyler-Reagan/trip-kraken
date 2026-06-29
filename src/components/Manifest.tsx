"use client";

import { useState } from "react";
import { useTripStore } from "@/store/tripStore";
import { isActivity, isLodging, isTransit, type Location, type Lodging } from "@/types";

/**
 * The Manifest (ADR-0015 / ADR-0010) — the trip's inventory of places, grouped by `kind`. It is the
 * create-and-discover surface: every place lives here regardless of role, and intrinsic facts are
 * edited inline. Lodging dates are the kind-elevating gesture; duration/hours editing lives in the
 * Inspector (open by clicking a row). The day-by-day plan is the Timeline (separate surface).
 */

function LodgingRow({ lodging }: { lodging: Lodging }) {
  const saveLodgingDates = useTripStore((s) => s.saveLodgingDates);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const [checkIn, setCheckIn] = useState(lodging.checkInDate);
  const [checkOut, setCheckOut] = useState(lodging.checkOutDate);
  const [error, setError] = useState<string | null>(null);

  async function save(nextIn: string, nextOut: string) {
    if (!nextIn || !nextOut || nextIn === lodging.checkInDate && nextOut === lodging.checkOutDate) return;
    const err = await saveLodgingDates(lodging.id, { checkInDate: nextIn, checkOutDate: nextOut });
    setError(err);
  }

  return (
    <div className="card p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        onClick={() => setInspectedLocationId(lodging.id)}
        className="font-medium text-sm text-gray-800 dark:text-gray-200 hover:text-brand-600 dark:hover:text-brand-400 text-left flex-1 min-w-[8rem] truncate"
      >
        🏨 {lodging.name}
      </button>
      <div className="flex items-center gap-1.5 text-sm">
        <input
          type="date" value={checkIn}
          onChange={(e) => { setCheckIn(e.target.value); save(e.target.value, checkOut); }}
          className="input py-1 text-xs w-[8.5rem]" aria-label="Check-in"
        />
        <span className="text-gray-400">→</span>
        <input
          type="date" value={checkOut} min={checkIn || undefined}
          onChange={(e) => { setCheckOut(e.target.value); save(checkIn, e.target.value); }}
          className="input py-1 text-xs w-[8.5rem]" aria-label="Check-out"
        />
      </div>
      <button
        onClick={() => saveLodgingDates(lodging.id, null)}
        className="text-gray-400 hover:text-red-500 text-lg leading-none px-1"
        title="Remove booking (back to an activity)"
        aria-label="Remove booking"
      >
        ×
      </button>
      {error && <p className="basis-full text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function ActivityRow({ loc }: { loc: Location }) {
  const updateLocation = useTripStore((s) => s.updateLocation);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const duration =
    loc.visitDuration != null
      ? `${Math.floor(loc.visitDuration / 60) ? `${Math.floor(loc.visitDuration / 60)}h ` : ""}${loc.visitDuration % 60 ? `${loc.visitDuration % 60}m` : ""}`.trim() || "—"
      : "—";

  return (
    <div className={`card p-3 flex items-center gap-3 ${loc.excluded ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={!loc.excluded}
        onChange={(e) => updateLocation(loc.id, { excluded: !e.target.checked })}
        className="rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
        title={loc.excluded ? "Excluded from the plan — click to include" : "Included — click to exclude"}
      />
      <button
        onClick={() => setInspectedLocationId(loc.id)}
        className="flex-1 min-w-0 text-left hover:text-brand-600 dark:hover:text-brand-400"
      >
        <span className="text-sm text-gray-800 dark:text-gray-200 truncate block">{loc.name}</span>
      </button>
      {loc.rating != null && (
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">★ {loc.rating.toFixed(1)}</span>
      )}
      <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right shrink-0">{duration}</span>
      {loc.enrichmentStatus === "pending" && (
        <span className="text-xs text-gray-400 animate-pulse shrink-0">…</span>
      )}
    </div>
  );
}

/** Inline form to elevate an existing activity into a lodging by giving it dates. */
function AddLodging({ activities }: { activities: Location[] }) {
  const saveLodgingDates = useTripStore((s) => s.saveLodgingDates);
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-brand-600 dark:text-brand-400 hover:underline">
        + set a place as lodging
      </button>
    );
  }

  async function submit() {
    if (!locationId || !checkIn || !checkOut) { setError("Pick a place and both dates."); return; }
    const err = await saveLodgingDates(locationId, { checkInDate: checkIn, checkOutDate: checkOut });
    if (err) { setError(err); return; }
    setOpen(false);
    setLocationId(""); setCheckIn(""); setCheckOut(""); setError(null);
  }

  return (
    <div className="card p-3 space-y-2">
      <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input py-1 text-sm">
        <option value="">Select a place…</option>
        {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <div className="flex items-center gap-1.5 text-sm">
        <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="input py-1 text-xs w-[8.5rem]" aria-label="Check-in" />
        <span className="text-gray-400">→</span>
        <input type="date" value={checkOut} min={checkIn || undefined} onChange={(e) => setCheckOut(e.target.value)} className="input py-1 text-xs w-[8.5rem]" aria-label="Check-out" />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={submit} className="btn-primary text-xs py-1 px-3">Save</button>
        <button onClick={() => { setOpen(false); setError(null); }} className="btn-secondary text-xs py-1 px-3">Cancel</button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{title}</h3>
      {children}
    </section>
  );
}

export default function Manifest() {
  const trip = useTripStore((s) => s.trip);
  if (!trip) return null;

  const lodgings = trip.locations.filter(isLodging);
  const transit = trip.locations.filter(isTransit);
  const activities = trip.locations.filter(isActivity);
  const excludedCount = activities.filter((a) => a.excluded).length;

  if (trip.locations.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500 dark:text-gray-400 space-y-3">
        <p className="text-4xl">🗺️</p>
        <p className="font-medium">No places yet</p>
        <p className="text-sm">
          Click <strong className="text-gray-700 dark:text-gray-200">+ Add location</strong> to search for places,
          then <strong className="text-gray-700 dark:text-gray-200">Plan itinerary</strong> to cluster them into days.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Group title={`Lodging${lodgings.length ? ` · ${lodgings.length}` : ""}`}>
        <div className="space-y-2">
          {lodgings.map((l) => <LodgingRow key={l.id} lodging={l} />)}
          <AddLodging activities={activities} />
        </div>
      </Group>

      <Group title={`Activities · ${activities.length}${excludedCount ? ` · ${excludedCount} excluded` : ""}`}>
        <div className="space-y-2">
          {activities.length === 0 && <p className="text-sm text-gray-400">No activities yet.</p>}
          {activities.map((a) => <ActivityRow key={a.id} loc={a} />)}
        </div>
      </Group>

      {transit.length > 0 && (
        <Group title={`Transit · ${transit.length}`}>
          <div className="space-y-2">
            {transit.map((t) => (
              <div key={t.id} className="card p-3 text-sm text-gray-600 dark:text-gray-300">🚆 {t.name}</div>
            ))}
          </div>
        </Group>
      )}
    </div>
  );
}
