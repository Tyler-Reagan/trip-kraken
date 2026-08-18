import { create } from "zustand";
import {
  deriveTripPlanDays,
  isTransit,
  type TripWithDetails,
  type Location,
  type Lodging,
  type Transit,
  type NearbyPlace,
} from "@/types";
import type { HealedPair, RoadProfile } from "@/types/path";
import { reorderPlacements, insertPlacement } from "@/lib/placementOrdering";
import type { Unplaced } from "@/lib/solver";

type ActiveSurface = "itinerary" | "places";

/** An along-route discovery search: a free-text query scoped to the corridor between two
 *  *consecutive* stops (#102, #134). `date` is the day to place adds on. */
export type RouteSearch = { from: Location; to: Location; date: string | null };

/** Which tab of the discovery tray is showing (#134). Null = tray closed. The nearby and
 *  route scopes persist independently so tab-switching returns to the last scope of each. */
export type DiscoveryMode = "nearby" | "route";

/**
 * A one-shot camera command for the map (#137): "point at this". Last write wins — a newer target
 * simply overwrites an unconsumed one — and `MapView` clears it the moment it moves the camera, so
 * the field is a *command*, never a record of where the map is looking. `MapView` is its only
 * consumer, and it reads this alone: it never watches `activeDayNumber` directly, which is what
 * keeps "which day is the itinerary on" and "what is the camera doing" from fusing into one
 * unstateable thing.
 */
export type FocusTarget =
  | { tier: "trip" }
  | { tier: "metro"; metroId: string }
  | { tier: "day"; dayNumber: number }
  | { tier: "stop"; locationId: string };

interface TripStore {
  // Data
  trip: TripWithDetails | null;
  tripId: string | null;

  // UI state
  activeSurface: ActiveSurface;
  /** The focal day of the day-navigator carousel, 1-based (#134). */
  activeDayNumber: number;
  mapPopupOpen: boolean;
  focusTarget: FocusTarget | null;
  /** Whether a passive day change still moves the camera (#137, policy b: explicit click > manual
   *  pan > passive scroll). Every explicit `focusMap` re-arms it; the user's own pan/zoom on the
   *  map disarms it, so paging the itinerary afterwards leaves their view where they put it. */
  autoFocusArmed: boolean;
  highlightedLocationId: string | null;
  inspectedLocationId: string | null;
  discoveryMode: DiscoveryMode | null;
  nearbySearchLocation: Location | null;
  nearbySearchDate: string | null;
  routeSearch: RouteSearch | null;
  showOptimize: boolean;
  showAddLocation: boolean;
  /** ADR-0023 §7 pre-flight/solver exclusions from the last optimize run (#120) — a property of
   *  that run, not of the trip, so it's kept separately from `trip` and survives the `reload()`
   *  `optimize()` triggers afterward. Cleared implicitly by the next `optimize()` call replacing it. */
  unplaced: Unplaced[];
  /** Non-fatal conditions from the last optimize run (#152), e.g. a pending lodging with no Anchor
   *  yet — surfaced in `OptimizeModal`, not per-Activity. */
  optimizeWarnings: string[];
  /** ADR-0026's self-heal (#171): the one new pair the last `removePlacement` call made adjacent,
   *  and what it costs to travel between them — `null` when that removal had nothing to heal
   *  (ADR-0026 §4's scope limits) or hasn't happened yet. A property of that one call, the same way
   *  `unplaced` is a property of the last `optimize()` — kept outside `trip` and cleared by every
   *  other mutation that could move a Placement, so a stale healed pair from an earlier removal
   *  never survives to label the wrong two stops. */
  healedPair: HealedPair | null;

  // Setters
  setTrip: (trip: TripWithDetails) => void;
  setActiveSurface: (v: ActiveSurface) => void;
  setActiveDayNumber: (n: number) => void;
  setMapPopupOpen: (v: boolean) => void;
  /** The one explicit "show me this on the map" action, behind every map link — the map's own
   *  tier bands and the itinerary's metro badges / stop links alike. */
  focusMap: (target: FocusTarget) => void;
  consumeFocusTarget: () => void;
  disarmAutoFocus: () => void;
  setHighlightedLocationId: (id: string | null) => void;
  setInspectedLocationId: (id: string | null) => void;
  setDiscoveryMode: (m: DiscoveryMode) => void;
  setNearbySearchLocation: (loc: Location | null, date?: string | null) => void;
  setRouteSearch: (search: RouteSearch | null) => void;
  closeDiscovery: () => void;
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
  /** Designate (or update, or release) a Location as the trip's arrival or departure (ADR-0028).
   *  `time` is `"HH:MM"` for a known time, `""` for a designated edge with no known time yet, or
   *  `null` to release the edge — the date component is always the trip's own start/end date and
   *  is never sent from the client. */
  saveTransitEdge: (locationId: string, which: "arrival" | "departure", time: string | null) => Promise<string | null>;
  /** Add a discovery result to the trip (and, when `date` is set, place it on that day at
   *  `order`, else appended). Returns an error message or null. Shared by the tray's Add
   *  button and dropping a result card on a day card (#134). */
  addDiscoveredPlace: (place: NearbyPlace, date: string | null, order?: number) => Promise<string | null>;
  setDayLabel: (date: string, label: string | null) => Promise<void>;
  setTransitCaveatDismissed: (v: boolean) => Promise<void>;
  setRoadProfile: (v: RoadProfile) => Promise<void>;
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
  activeDayNumber: 1,
  mapPopupOpen: false,
  focusTarget: null,
  autoFocusArmed: true,
  highlightedLocationId: null,
  inspectedLocationId: null,
  discoveryMode: null,
  nearbySearchLocation: null,
  nearbySearchDate: null,
  routeSearch: null,
  showOptimize: false,
  showAddLocation: false,
  unplaced: [],
  optimizeWarnings: [],
  healedPair: null,
  isEnriching: false,
  enrichProgress: null,
  _pollTimer: null,

  setTrip: (trip) => set({ trip, tripId: trip.id }),
  setActiveSurface: (v) =>
    set({ activeSurface: v, inspectedLocationId: null, discoveryMode: null, nearbySearchLocation: null, routeSearch: null }),
  // The *passive* day change (#137): paging the carousel — arrows, index strip, drag-to-edge
  // dwell. It follows the camera along only while auto-focus is armed, and never opens the map
  // popup: paging days is itinerary navigation that the map tags along with, not a map link.
  // Paging also closes the inspector popover — its anchor row leaves the DOM with the old day.
  setActiveDayNumber: (n) =>
    set({
      activeDayNumber: n,
      inspectedLocationId: null,
      ...(get().autoFocusArmed ? { focusTarget: { tier: "day" as const, dayNumber: n } } : {}),
    }),
  setMapPopupOpen: (v) => set({ mapPopupOpen: v }),
  // Explicit (#137): always sets the target, always re-arms, and ensures the map is visible to
  // receive it (#128 decision 5) — without forcing any particular map size. A day target moves the
  // itinerary's focal day too, so the two surfaces never disagree about which day is being looked at.
  focusMap: (target) =>
    set({
      focusTarget: target,
      autoFocusArmed: true,
      mapPopupOpen: true,
      ...(target.tier === "day" ? { activeDayNumber: target.dayNumber, inspectedLocationId: null } : {}),
    }),
  consumeFocusTarget: () => set({ focusTarget: null }),
  disarmAutoFocus: () => set({ autoFocusArmed: false }),
  setHighlightedLocationId: (id) => set({ highlightedLocationId: id }),
  setInspectedLocationId: (id) => set({ inspectedLocationId: id }),
  // Tab-switching only — scope for the target mode must already exist (the tray disables the
  // tab otherwise); scope itself is chosen from the day card's triggers, not the tray (#134).
  setDiscoveryMode: (m) => set({ discoveryMode: m }),
  setNearbySearchLocation: (loc, date) =>
    loc
      ? set({ nearbySearchLocation: loc, nearbySearchDate: date ?? null, discoveryMode: "nearby" })
      : set({ nearbySearchLocation: null, nearbySearchDate: null, discoveryMode: get().routeSearch ? "route" : null }),
  setRouteSearch: (search) =>
    search
      ? set({ routeSearch: search, discoveryMode: "route" })
      : set({ routeSearch: null, discoveryMode: get().nearbySearchLocation ? "nearby" : null }),
  closeDiscovery: () =>
    set({ discoveryMode: null, nearbySearchLocation: null, nearbySearchDate: null, routeSearch: null }),
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
    // A full re-solve can rearrange or discard the healed pair's two Placements entirely — never
    // leave a stale self-heal label pointing at stops that may not even be adjacent any more.
    set({ healedPair: null });
    // fetch only rejects on a network failure — an HTTP 500 (e.g. an unreachable VROOM, which
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
    // unplaced/warnings (#120, #152) ride on this response only — reload() below refetches the
    // trip itself and would not otherwise carry them.
    const body = await res.json().catch(() => ({}));
    set({ unplaced: body?.unplaced ?? [], optimizeWarnings: body?.warnings ?? [] });
    await get().reload();
  },

  updateLocation: async (locationId, fields) => {
    const tripId = get().tripId;
    if (!tripId) return;
    // Optimistic: reflect the edit immediately (exclude toggle, duration), then reconcile on reload.
    // "visitDuration" in fields, not fields.visitDuration != null: a duration edit stales the plan
    // whether it sets, changes, or clears the value, and `unplaced`/`optimizeWarnings` were computed
    // from whatever it was before this edit either way.
    const t = get().trip;
    if (t) {
      set({
        trip: { ...t, locations: t.locations.map((l) => (l.id === locationId ? { ...l, ...fields } : l)) },
        ...("visitDuration" in fields ? { unplaced: [], optimizeWarnings: [] } : {}),
      });
    }
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
    // A new insertion can land right on top of the healed pair's gap — stale by construction.
    set({ healedPair: null });
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
    // A reorder can move either half of the healed pair away from the other — stale by construction.
    set({ healedPair: null });
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
    const res = await fetch(`/api/trips/${tripId}/placements/${placementId}`, { method: "DELETE" });
    // ADR-0026 self-heal (#171): rides on this response only, the same way unplaced/warnings ride
    // on optimize()'s — reload() below refetches the trip itself and would not otherwise carry it.
    const body = await res.json().catch(() => ({}));
    set({ healedPair: body?.healedPair ?? null });
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

  saveTransitEdge: async (locationId, which, time) => {
    const tripId = get().tripId;
    if (!tripId) return "No trip loaded";
    const field = which === "arrival" ? "arriveAt" : "departAt";
    const t = get().trip;
    if (t) {
      // The date component mirrors the write path (ADR-0028 §3): the trip's own start/end date,
      // composed here only for the optimistic patch — the server recomputes it from its own read
      // of the trip rather than trusting this value.
      const edgeDate = which === "arrival" ? t.startDate : t.endDate;
      const value = time === null ? null : time === "" ? edgeDate : `${edgeDate}T${time}`;
      const relegateIfBareActivity = (l: Location): Location => {
        const arriveAt = isTransit(l) ? l.arriveAt : null;
        const departAt = isTransit(l) ? l.departAt : null;
        if (arriveAt == null && departAt == null) {
          const { arriveAt: _a, departAt: _d, ...rest } = l as Transit;
          return { ...rest, kind: "activity" };
        }
        return { ...l, kind: "transit", arriveAt, departAt };
      };
      const patched: Location[] = t.locations.map((l) => {
        if (l.id === locationId) {
          const arriveAt = which === "arrival" ? value : isTransit(l) ? l.arriveAt : null;
          const departAt = which === "departure" ? value : isTransit(l) ? l.departAt : null;
          return relegateIfBareActivity({ ...l, kind: "transit", arriveAt, departAt } as Transit);
        }
        // Assigning a new edge releases whoever held it before (ADR-0028 §2's uniqueness
        // invariant) — the optimistic patch has to uphold it too, or the client briefly shows two
        // Locations both claiming the same edge.
        if (value != null && isTransit(l) && l[field] != null) return relegateIfBareActivity({ ...l, [field]: null });
        return l;
      });
      set({ trip: { ...t, locations: patched } });
    }
    const res = await fetch(`/api/trips/${tripId}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: time }),
    });
    if (!res.ok) {
      await get().reload();
      const data = await res.json().catch(() => ({}));
      return (data as { error?: string }).error ?? "Failed to save transit time";
    }
    await get().reload();
    return null;
  },

  addDiscoveredPlace: async (place, date, order) => {
    const tripId = get().tripId;
    if (!tripId) return "No trip loaded";
    // Same reasoning as addPlacement: a new stop can land inside the healed pair's gap.
    set({ healedPair: null });
    try {
      const res = await fetch(`/api/trips/${tripId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          placeId: place.placeId,
          rating: place.rating,
          reviewCount: place.reviewCount,
          categories: place.categories,
        }),
      });
      // 409 = already in the trip — not an error, just nothing new to place.
      if (res.status === 409) {
        await get().reload();
        return null;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return (data as { error?: string }).error ?? "Failed to add location";
      }
      const newLocation = (await res.json()) as { id?: string };
      if (date && newLocation.id) {
        await fetch(`/api/trips/${tripId}/placements`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: newLocation.id,
            date,
            ...(order !== undefined ? { order } : {}),
          }),
        });
      }
      await get().reload();
      return null;
    } catch {
      return "Network error. Could not add location.";
    }
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

  // Optimistic — a dismissed banner should disappear immediately, not wait on a round trip.
  setTransitCaveatDismissed: async (v) => {
    const tripId = get().tripId;
    const t = get().trip;
    if (!tripId || !t) return;
    set({ trip: { ...t, transitCaveatDismissed: v } });
    await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transitCaveatDismissed: v }),
    });
  },

  // Optimistic, same pattern as setTransitCaveatDismissed — this must persist (unlike
  // OptimizeModal's dayBudgetHours, which is per-run local state) because the Facts layer reads
  // it off the Trip at matrix time (ADR-0024, amended 2026-08-11).
  setRoadProfile: async (v) => {
    const tripId = get().tripId;
    const t = get().trip;
    if (!tripId || !t) return;
    set({ trip: { ...t, roadProfile: v } });
    await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roadProfile: v }),
    });
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
    // Clicking a map dot surfaces the stop in the itinerary: page the carousel to the day
    // holding it (the stop's row only exists in the DOM when its day is focal), then flash it.
    // Deliberately sets the day directly rather than through `setActiveDayNumber` — this travels
    // itinerary-ward, so it must not emit a focus target and yank the camera out from under the
    // dot the user just clicked.
    const trip = get().trip;
    const day = trip ? deriveTripPlanDays(trip).find((d) => d.stops.some((s) => s.location.id === locationId)) : undefined;
    set({
      highlightedLocationId: locationId,
      activeSurface: "itinerary",
      ...(day ? { activeDayNumber: day.dayNumber } : {}),
    });
    setTimeout(() => set({ highlightedLocationId: null }), 2000);
  },
}));
