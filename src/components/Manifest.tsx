"use client";

import { useState } from "react";
// `Map` is aliased: the icon would otherwise shadow the global Map constructor used below.
import { ChevronRight, Map as MapIcon, Star } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { clusterByMetro } from "@/lib/metroCluster";
import { metroKey, metroLabel } from "@/lib/tripMetros";
import { isActivity, isLodging, type Location, type Lodging, type TripWithDetails } from "@/types";
import { NightStrip } from "./LodgingNightStrip";
import { TransitSection } from "./TransitEdgeSlots";
import VisitDurationEditor from "./VisitDurationEditor";

/**
 * The Manifest (ADR-0015 / ADR-0010) — the trip's inventory of places, grouped by `kind`. It is the
 * create-and-discover surface: every place lives here regardless of role, and intrinsic facts are
 * edited inline, including an Activity's visit duration directly on its row (ADR-0023 §9, amended
 * 2026-08-18) — hours editing still lives in the Inspector (open by clicking a row). The day-by-day
 * plan is the Timeline (separate surface).
 *
 * Width is capped rather than filling the page column: a row puts the name hard left and its
 * controls hard right, so at full width a short name leaves a lake of empty space down the middle
 * of every row. Capping is the honest fix — the alternative (letting the controls float in after
 * the name) makes the right edge ragged across a 24-row list.
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
        {/* The reason, on the row, in words — not a tooltip. A failed lookup is the one thing here
            a user has to act on, and "which one, and why" is the whole of what they need. */}
        {loc.enrichmentStatus === "failed" && (
          <span className="text-[11px] text-danger-600 dark:text-danger-400 truncate block">
            {loc.enrichmentError ?? "Couldn’t look this place up."}
          </span>
        )}
      </button>
      {loc.rating != null && (
        <span className="text-xs text-sub shrink-0 inline-flex items-center gap-0.5">
          <Star className="w-3 h-3 fill-current" />
          {loc.rating.toFixed(1)}
        </span>
      )}
      <VisitDurationEditor loc={loc} />
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

/** Activities sharing a metro, in the order the metro first appears in the trip's own list. */
type ActivityGroup = { key: string; label: string; items: Location[] };

/**
 * Groups activities by metro through #116's `clusterByMetro` — the same detector the optimizer's
 * coverage mask, the lodging wizard, and #110's split warning already share, so this adds no second
 * notion of "same city".
 *
 * Ungeocoded activities cluster into nothing (the detector works on points), so they'd silently
 * vanish from a grouped list. They get their own trailing group instead — which doubles as the
 * place a failed lookup is visible, since that's exactly why a place has no coordinates.
 */
function groupByMetro(activities: Location[], lodgings: Lodging[]): ActivityGroup[] {
  const clusters = clusterByMetro<Location, Lodging>(activities, lodgings);
  const order = new Map(activities.map((a, i) => [a.id, i]));
  const firstIndex = (g: Location[]) => Math.min(...g.map((a) => order.get(a.id) ?? Infinity));

  const groups: ActivityGroup[] = clusters
    .filter((c) => c.activities.length > 0)
    .map((c) => ({ key: metroKey(c), label: metroLabel(c), items: c.activities }))
    .sort((a, b) => firstIndex(a.items) - firstIndex(b.items));

  const placed = new Set(groups.flatMap((g) => g.items.map((a) => a.id)));
  const unplaced = activities.filter((a) => !placed.has(a.id));
  if (unplaced.length > 0) groups.push({ key: "__unplaced", label: "Not yet located", items: unplaced });

  return groups;
}

function MetroGroup({ group }: { group: ActivityGroup }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-sub hover:text-ink w-full"
      >
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="font-medium">{group.label}</span>
        <span className="text-faint tabular-nums">· {group.items.length}</span>
      </button>
      {open && (
        <div className="space-y-2 pl-4">
          {group.items.map((a) => <ActivityRow key={a.id} loc={a} />)}
        </div>
      )}
    </div>
  );
}

export default function Manifest() {
  const trip = useTripStore((s) => s.trip);
  if (!trip) return null;

  const lodgings = trip.locations.filter(isLodging);
  const activities = trip.locations.filter(isActivity);
  const excludedCount = activities.filter((a) => a.excluded).length;
  const groups = groupByMetro(activities, lodgings);

  if (trip.locations.length === 0) {
    return (
      <div className="card p-8 text-center text-sub space-y-3">
        <MapIcon className="w-8 h-8 mx-auto" />
        <p className="font-medium">No places yet</p>
        <p className="text-sm">
          Click <strong className="text-ink">+ Add location</strong> to search for places,
          then <strong className="text-ink">Plan itinerary</strong> to cluster them into days.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Group title={`Lodging${lodgings.length ? ` · ${lodgings.length}` : ""}`}>
        <LodgingSection trip={trip} activities={activities} />
      </Group>

      <Group title={`Activities · ${activities.length}${excludedCount ? ` · ${excludedCount} excluded` : ""}`}>
        <div className="space-y-2">
          {activities.length === 0 && <p className="text-sm text-faint">No activities yet.</p>}
          {/* One group is no grouping — a lone header over the whole list is chrome that says
              nothing the section heading hasn't already said. */}
          {groups.length > 1
            ? groups.map((g) => <MetroGroup key={g.key} group={g} />)
            : activities.map((a) => <ActivityRow key={a.id} loc={a} />)}
        </div>
      </Group>

      <Group title="Transit">
        <TransitSection trip={trip} />
      </Group>
    </div>
  );
}
