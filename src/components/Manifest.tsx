"use client";

import { Map, Star, TrainFront } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { isActivity, isLodging, isTransit, type Location, type TripWithDetails } from "@/types";
import { NightStrip } from "./LodgingNightStrip";

/**
 * The Manifest (ADR-0015 / ADR-0010) — the trip's inventory of places, grouped by `kind`. It is the
 * create-and-discover surface: every place lives here regardless of role, and intrinsic facts are
 * edited inline. Lodging dates are the kind-elevating gesture; duration/hours editing lives in the
 * Inspector (open by clicking a row). The day-by-day plan is the Timeline (separate surface).
 */

/**
 * Lodging section (#113): the drag-select night strip, captioned rather than legended — a color
 * legend and an opt-in "?"/first-touch ghost hint both lost out in `/prototype` comparisons (since
 * torn down) to this one-line gesture caption, which read as intuitive without extra chrome.
 */
function LodgingSection({ trip, activities }: { trip: TripWithDetails; activities: Location[] }) {
  // Excluded activities are kept in the trip but intentionally out of the plan (ADR-0015) — the
  // lodging dropdown promotes a place *into* the plan, so an excluded one shouldn't be offered.
  const promotable = activities.filter((a) => !a.excluded);
  return (
    <div className="space-y-2">
      <p className="text-xs text-faint">
        Drag across nights to add a stay · drag a block&rsquo;s edge to resize, its middle to move · click to edit or remove
      </p>
      <NightStrip trip={trip} lodgings={trip.locations.filter(isLodging)} activities={promotable} />
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
        className="rounded border-line-strong text-brand-600 focus:ring-brand-500 shrink-0"
        title={loc.excluded ? "Excluded from the plan — click to include" : "Included — click to exclude"}
      />
      <button
        onClick={() => setInspectedLocationId(loc.id)}
        className="flex-1 min-w-0 text-left hover:text-brand-600 dark:hover:text-brand-400"
      >
        <span className="text-sm text-ink truncate block">{loc.name}</span>
      </button>
      {loc.rating != null && (
        <span className="text-xs text-sub shrink-0 inline-flex items-center gap-0.5">
          <Star className="w-3 h-3 fill-current" />
          {loc.rating.toFixed(1)}
        </span>
      )}
      <span className="text-xs text-sub w-12 text-right shrink-0">{duration}</span>
      {loc.enrichmentStatus === "pending" && (
        <span className="text-xs text-faint animate-pulse shrink-0">…</span>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-meta text-faint">{title}</h3>
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
      <div className="card p-8 text-center text-sub space-y-3">
        <Map className="w-8 h-8 mx-auto" />
        <p className="font-medium">No places yet</p>
        <p className="text-sm">
          Click <strong className="text-ink">+ Add location</strong> to search for places,
          then <strong className="text-ink">Plan itinerary</strong> to cluster them into days.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Group title={`Lodging${lodgings.length ? ` · ${lodgings.length}` : ""}`}>
        <LodgingSection trip={trip} activities={activities} />
      </Group>

      <Group title={`Activities · ${activities.length}${excludedCount ? ` · ${excludedCount} excluded` : ""}`}>
        <div className="space-y-2">
          {activities.length === 0 && <p className="text-sm text-faint">No activities yet.</p>}
          {activities.map((a) => <ActivityRow key={a.id} loc={a} />)}
        </div>
      </Group>

      {transit.length > 0 && (
        <Group title={`Transit · ${transit.length}`}>
          <div className="space-y-2">
            {transit.map((t) => (
              <div key={t.id} className="card p-3 text-sm text-sub flex items-center gap-1.5">
                <TrainFront className="w-4 h-4 shrink-0" />
                {t.name}
              </div>
            ))}
          </div>
        </Group>
      )}
    </div>
  );
}
