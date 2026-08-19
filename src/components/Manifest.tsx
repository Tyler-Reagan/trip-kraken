"use client";

import { useState } from "react";
// `Map` is aliased: the icon would otherwise shadow the global Map constructor used below.
import { ChevronRight, Map as MapIcon, Star } from "lucide-react";
import { useTripStore } from "@/store/tripStore";
import { clusterByMetro } from "@/lib/metroCluster";
import { localityOf, metroKey, metroLabel } from "@/lib/tripMetros";
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
 * The row fills the column rather than the column being narrowed to the row. An activity row was
 * a name at one end and controls at the other with nothing between, and the empty middle was a
 * symptom rather than the disease: at this width the row was simply under-informative. It now
 * carries the locality — the ward or city *below* the metro its group already names — which is the
 * grain at which a traveller decides what belongs on the same day. Content earns the width; capping
 * it only hid that the row had nothing more to say.
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

function ActivityRow({ loc, metro }: { loc: Location; metro: string }) {
  const updateLocation = useTripStore((s) => s.updateLocation);
  const setInspectedLocationId = useTripStore((s) => s.setInspectedLocationId);
  const locality = localityOf(loc.address, metro);

  return (
    <div className={`card p-3 flex items-center gap-3 ${loc.excluded ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={!loc.excluded}
        onChange={(e) => updateLocation(loc.id, { excluded: !e.target.checked })}
        className="rounded border-line-strong text-brand-600 focus:ring-brand-500 shrink-0"
        title={loc.excluded ? "Excluded from the plan — click to include" : "Included — click to exclude"}
      />
      {/* Not flex-1: the slack belongs in one gutter before the controls, not between every
          descriptive item. Name, locality, and rating all describe the place, so they cluster; the
          duration stepper is the only control and holds the right edge on its own. */}
      <button
        onClick={() => setInspectedLocationId(loc.id)}
        className="min-w-0 shrink text-left group"
      >
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm text-ink truncate group-hover:text-brand-600 dark:group-hover:text-brand-400">
            {loc.name}
          </span>
          {/* The locality qualifies the name rather than being a second fact about the row, so it
              sits beside it — a second line would double the height of all 24 rows to say one
              word. Below `sm` it goes entirely: truncated to "To…" it is worse than absent, and
              the group heading already names the area. */}
          {locality && <span className="hidden sm:inline text-xs text-faint truncate shrink">{locality}</span>}
        </span>
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
      <span className="flex-1" />
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
type ActivityGroup = { key: string; label: string; items: Location[]; hasLodging: boolean };

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
    .map((c) => ({
      key: metroKey(c),
      label: metroLabel(c),
      items: c.activities,
      hasLodging: c.lodgings.length > 0,
    }))
    .sort((a, b) => firstIndex(a.items) - firstIndex(b.items));

  const placed = new Set(groups.flatMap((g) => g.items.map((a) => a.id)));
  const unplaced = activities.filter((a) => !placed.has(a.id));
  // Coverage is meaningless for places with no coordinates — flagging "no lodging" on a group
  // whose members aren't anywhere yet would be noise dressed as a warning.
  if (unplaced.length > 0) {
    groups.push({ key: "__unplaced", label: "Not yet located", items: unplaced, hasLodging: true });
  }

  return groups;
}

/**
 * A metro's activities under one heading. Rows stay flush with the Lodging strip and Transit card
 * above and below — an indent under the heading would put a third left edge on a surface that only
 * has two, and the heading already separates the groups.
 *
 * The heading carries whether this metro has lodging, because that is the one fact about a metro
 * that changes what the optimizer will do with it: activities in an uncovered metro don't get
 * scheduled (#118). It's the same `clusterByMetro` coverage the lodging wizard and #110's warning
 * read, stated here where the affected places actually are.
 */
function MetroGroup({ group }: { group: ActivityGroup }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 w-full text-left group/hdr"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span className="text-xs font-semibold text-sub group-hover/hdr:text-ink">{group.label}</span>
        <span className="text-xs text-faint tabular-nums">{group.items.length}</span>
        {!group.hasLodging && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">no lodging</span>
        )}
        {/* A hairline running to the right edge is what makes this read as a boundary rather than
            as another row of text — the groups need separating, and a rule costs no height. */}
        <span className="flex-1 h-px bg-line" aria-hidden />
      </button>
      {open && (
        <div className="space-y-2">
          {group.items.map((a) => <ActivityRow key={a.id} loc={a} metro={group.label} />)}
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
    <div className="space-y-6">
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
            : activities.map((a) => <ActivityRow key={a.id} loc={a} metro={groups[0]?.label ?? ""} />)}
        </div>
      </Group>

      <Group title="Transit">
        <TransitSection trip={trip} />
      </Group>
    </div>
  );
}
