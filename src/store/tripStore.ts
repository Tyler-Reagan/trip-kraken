import { create } from "zustand";
import type { TripWithDetails, Location, Lodging } from "@/types";
import { reorderPlacements, insertPlacement } from "@/lib/placementOrdering";

type ActiveSurface = "itinerary" | "places";
export type ScheduleFilter = number | "unassigned" | null;

/** An along-route discovery search: a free-text query scoped to the corridor between two of the
 *  trip's stops (#102). Distinct from an anchored `nearbySearchLocation` — they're mutually
 *  exclusive since both drive the single companion panel. `date` is the day to place adds on. */
export type RouteSearch = { from: Location; to: Location; date: string | null };

interface TripStore {
  // Data
  trip: TripWithDetails | null;
  tripId: string | null;

  // UI state
  activeSurface: ActiveSurface;
  mapShown: boolean;
  mapExpanded: boolean;
  selectedDayNumber: ScheduleFilter;
  highlightedLocationId: string | null;
  inspectedLocationId: string | null;
  nearbySearchLocation: Location | null;
  nearbySearchDate: string | null;
  routeSearch: RouteSearch | null;
  showOptimize: boolean;
  showAddLocation: boolean;

  // Setters
  setTrip: (trip: TripWithDetails) => void;
  setActiveSurface: (v: ActiveSurface) => void;
  setMapShown: (v: boolean) => void;
  setMapExpanded: (v: boolean) => void;
  setSelectedDayNumber: (n: ScheduleFilter) => void;
  setHighlightedLocationId: (id: string | null) => void;
  setInspectedLocationId: (id: string | null) => void;
  setNearbySearchLocation: (loc: Location | null, date?: string | null) => void;
  setRouteSearch: (search: RouteSearch | null) => void;
  setShowOptimize: (v: boolean) => void;
  setShowAddLocation: (v: boolean) => void;

  // Async mutations — use get().tripId internally
  reload: () => Promise<void>;
  optimize: (opts?: { dayBudgetHours?: number }) => Promise<void>;
  updateLocation: (
    locationId: string,
    fields: { excluded?: boolean; note?: string | null; name?: string; visitDuration?: number | null }
  ) => Promise<void>;
  addPlacement: (locationId: string, date: string, order?: number) => Promise<void>;
  movePlacement: (placementId: string, date: string, order: number) => Promise<void>;
  removePlacement: (placementId: string) => Promise<void>;
  saveLodgingDates: (
    locationId: string,
    dates: { checkInDate: string; checkOutDate: string } | null
  ) => Promise<string | null>;
  setDayLabel: (date: string, label: string | null) => Promise<void>;
  importBooking: (text: string) => Promise<string | null>;
  enrich: () => Promise<void>;

  // Enrichment progress (shown during manual retry)
  isEnriching: boolean;
  enrichProgress: { enriched: number; total: number; errors: number } | null;

  pollEnrichment: () => void;
  _pollTimer: ReturnType<typeof setTimeout> | null;

  handleMapLocationClick: (locationId: string) => void;
}

export const useTripStore = create<TripStore>()((set, get) => ({
  trip: null,
  tripId: null,

  activeSurface: "itinerary",
  mapShown: true,
  mapExpanded: false,
  selectedDayNumber: null,
  highlightedLocationId: null,
  inspectedLocationId: null,
  nearbySearchLocation: null,
  nearbySearchDate: null,
  routeSearch: null,
  showOptimize: false,
  showAddLocation: false,
  isEnriching: false,
  enrichProgress: null,
  _pollTimer: null,

  setTrip: (trip) => set({ trip, tripId: trip.id }),
  setActiveSurface: (v) =>
    set({ activeSurface: v, inspectedLocationId: null, nearbySearchLocation: null, routeSearch: null, mapExpanded: false }),
  setMapShown: (v) => set({ mapShown: v }),
  setMapExpanded: (v) => set({ mapExpanded: v }),
  setSelectedDayNumber: (n) => set({ selectedDayNumber: n, inspectedLocationId: null }),
  setHighlightedLocationId: (id) => set({ highlightedLocationId: id }),
  setInspectedLocationId: (id) => set({ inspectedLocationId: id }),
  // Anchored and route search share the one companion slot — opening either closes the other.
  setNearbySearchLocation: (loc, date) =>
    set({ nearbySearchLocation: loc, nearbySearchDate: date ?? null, routeSearch: loc ? null : get().routeSearch }),
  setRouteSearch: (search) => set({ routeSearch: search, nearbySearchLocation: search ? null : get().nearbySearchLocation }),
  setShowOptimize: (v) => set({ showOptimize: v }),
  setShowAddLocation: (v) => set({ showAddLocation: v }),

  reload: async () => {
    const tripId = get().tripId;
    if (!tripId) return;
    // A transient fetch failure (e.g. the dev server mid-restart) must not kill the enrichment
    // poll loop below — reschedule regardless of outcome so it retries on the next tick instead
    // of silently going quiet for the rest of the session.
    try {
      const res = await fetch(`/api/trips/${tripId}`);
      if (res.ok) set({ trip: await res.json() });
    } catch {
      // ignored — polled again shortly via pollEnrichment()
    }
    get().pollEnrichment();
  },

  pollEnrichment: () => {
    const { trip, _pollTimer } = get();
    if (_pollTimer !== null) clearTimeout(_pollTimer);
    const hasPending = trip?.locations.some((l) => l.enrichmentStatus === "pending") ?? false;
    if (!hasPending) { set({ _pollTimer: null }); return; }
    const timer = setTimeout(async () => { await get().reload(); }, 2000);
    set({ _pollTimer: timer });
  },

  optimize: async (opts) => {
    const tripId = get().tripId;
    if (!tripId) return;
    // fetch only rejects on a network failure — an HTTP 500 (e.g. a missing transit graph, which
    // fails loudly by design) resolves with ok: false. Throw on it so callers surface the error
    // instead of silently reloading an unchanged plan.
    const res = await fetch(`/api/trips/${tripId}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
    if (!res.ok) {
      const message = await res.json().then((b) => b?.error).catch(() => null);
      throw new Error(message || `Optimize failed (${res.status})`);
    }
    await get().reload();
  },

  updateLocation: async (locationId, fields) => {
    const tripId = get().tripId;
    if (!tripId) return;
    // Optimistic: reflect the edit immediately (exclude toggle, duration), then reconcile on reload.
    const t = get().trip;
    if (t) set({ trip: { ...t, locations: t.locations.map((l) => (l.id === locationId ? { ...l, ...fields } : l)) } });
    await fetch(`/api/trips/${tripId}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    await get().reload();
  },

  addPlacement: async (locationId, date, order) => {
    const tripId = get().tripId;
    if (!tripId) return;
    // Optimistic: insert the placement locally (mirroring the server's shift-siblings logic via
    // the shared placementOrdering helper) so the stop appears on the day with no round-trip lag.
    const t = get().trip;
    if (t) {
      const id = crypto.randomUUID();
      set({ trip: { ...t, placements: insertPlacement(t.placements, tripId, { id, locationId, date, order }) } });
    }
    await fetch(`/api/trips/${tripId}/placements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, date, order }),
    });
    await get().reload();
  },

  movePlacement: async (placementId, date, order) => {
    const tripId = get().tripId;
    if (!tripId) return;
    // Optimistic: reproduce the server's move/shift/re-densify logic locally via the shared
    // placementOrdering helper, so a dragged stop moves instantly instead of waiting on reload().
    const t = get().trip;
    if (t) set({ trip: { ...t, placements: reorderPlacements(t.placements, placementId, date, order) } });
    await fetch(`/api/trips/${tripId}/placements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placementId, date, order }),
    });
    await get().reload();
  },

  removePlacement: async (placementId) => {
    const tripId = get().tripId;
    if (!tripId) return;
    // Optimistic: drop the placement immediately so the stop leaves the day without a round-trip lag.
    const t = get().trip;
    if (t) set({ trip: { ...t, placements: t.placements.filter((p) => p.id !== placementId) } });
    await fetch(`/api/trips/${tripId}/placements/${placementId}`, { method: "DELETE" });
    await get().reload();
  },

  saveLodgingDates: async (locationId, dates) => {
    const tripId = get().tripId;
    if (!tripId) return "No trip loaded";
    // dates === null clears the booking (relegates to activity); otherwise sets check-in/out.
    // Either direction flips the Location's `kind` discriminant, so the optimistic patch has to
    // build a properly-shaped Activity/Lodging object rather than just nulling a field.
    const t = get().trip;
    if (t) {
      const patched: Location[] = t.locations.map((l) => {
        if (l.id !== locationId) return l;
        if (dates === null) {
          const { checkInDate: _checkInDate, checkOutDate: _checkOutDate, ...rest } = l as Lodging;
          return { ...rest, kind: "activity" };
        }
        return { ...l, kind: "lodging", checkInDate: dates.checkInDate, checkOutDate: dates.checkOutDate };
      });
      set({ trip: { ...t, locations: patched } });
    }
    const body = dates === null ? { checkInDate: null } : dates;
    const res = await fetch(`/api/trips/${tripId}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Roll back the optimistic patch by asking the server what's actually true.
      await get().reload();
      const data = await res.json().catch(() => ({}));
      return (data as { error?: string }).error ?? "Failed to save lodging dates";
    }
    await get().reload();
    return null;
  },

  setDayLabel: async (date, label) => {
    const tripId = get().tripId;
    if (!tripId) return;
    await fetch(`/api/trips/${tripId}/days`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, label }),
    });
    await get().reload();
  },

  importBooking: async (text) => {
    const tripId = get().tripId;
    if (!tripId) return "No trip loaded";
    const res = await fetch(`/api/trips/${tripId}/lodging/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return (data as { error?: string }).error ?? "Failed to import booking";
    }
    await get().reload();
    return null;
  },

  enrich: async () => {
    const tripId = get().tripId;
    if (!tripId) return;
    set({ isEnriching: true, enrichProgress: null });
    try {
      const res = await fetch(`/api/trips/${tripId}/enrich`, { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { enriched: number; total: number; errors: number };
        set({ enrichProgress: data });
        await get().reload();
      }
    } finally {
      set({ isEnriching: false });
    }
  },

  handleMapLocationClick: (locationId) => {
    // Map dots live in the itinerary companion; clicking one surfaces the stop in the
    // adjacent list. Drop out of full-bleed so the highlighted row is in view.
    set({ highlightedLocationId: locationId, activeSurface: "itinerary", mapExpanded: false });
    setTimeout(() => set({ highlightedLocationId: null }), 2000);
  },
}));
