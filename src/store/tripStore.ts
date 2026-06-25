import { create } from "zustand";
import type { TripWithDetails, Location } from "@/types";

type ActiveView = "itinerary" | "map";
export type ScheduleFilter = number | "unassigned" | null;

interface TripStore {
  // Data
  trip: TripWithDetails | null;
  tripId: string | null;

  // UI state
  activeView: ActiveView;
  selectedDayNumber: ScheduleFilter;
  highlightedLocationId: string | null;
  inspectedLocationId: string | null;
  nearbySearchLocation: Location | null;
  nearbySearchDayId: string | null;
  showOptimize: boolean;
  showAddLocation: boolean;
  showStays: boolean;

  // Setters
  setTrip: (trip: TripWithDetails) => void;
  setActiveView: (v: ActiveView) => void;
  setSelectedDayNumber: (n: ScheduleFilter) => void;
  setHighlightedLocationId: (id: string | null) => void;
  setInspectedLocationId: (id: string | null) => void;
  setNearbySearchLocation: (loc: Location | null, dayId?: string | null) => void;
  setShowOptimize: (v: boolean) => void;
  setShowAddLocation: (v: boolean) => void;
  setShowStays: (v: boolean) => void;

  // Async mutations — use get().tripId internally
  reload: () => Promise<void>;
  moveStop: (stopId: string, targetDayId: string, targetOrder: number) => Promise<void>;
  removeStop: (stopId: string) => Promise<void>;
  setStopLocked: (stopId: string, locked: boolean) => Promise<void>;
  addLocationToDay: (locationId: string, dayId: string) => Promise<void>;
  saveStays: (stays: Array<{ lodgingLocationId: string; startNight: number; endNight: number }>) => Promise<string | null>;
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

  activeView: "itinerary",
  selectedDayNumber: null,
  highlightedLocationId: null,
  inspectedLocationId: null,
  nearbySearchLocation: null,
  nearbySearchDayId: null,
  showOptimize: false,
  showAddLocation: false,
  showStays: false,
  isEnriching: false,
  enrichProgress: null,
  _pollTimer: null,

  setTrip: (trip) => set({ trip, tripId: trip.id }),
  setActiveView: (v) => set({ activeView: v, inspectedLocationId: null }),
  setSelectedDayNumber: (n) => set({ selectedDayNumber: n, inspectedLocationId: null }),
  setHighlightedLocationId: (id) => set({ highlightedLocationId: id }),
  setInspectedLocationId: (id) => set({ inspectedLocationId: id }),
  setNearbySearchLocation: (loc, dayId) => set({ nearbySearchLocation: loc, nearbySearchDayId: dayId ?? null }),
  setShowOptimize: (v) => set({ showOptimize: v }),
  setShowAddLocation: (v) => set({ showAddLocation: v }),
  setShowStays: (v) => set({ showStays: v }),

  reload: async () => {
    const tripId = get().tripId;
    if (!tripId) return;
    const res = await fetch(`/api/trips/${tripId}`);
    if (res.ok) {
      set({ trip: await res.json() });
      get().pollEnrichment();
    }
  },

  pollEnrichment: () => {
    const { trip, _pollTimer } = get();
    if (_pollTimer !== null) clearTimeout(_pollTimer);
    const hasPending = trip?.locations.some((l) => l.enrichmentStatus === "pending") ?? false;
    if (!hasPending) { set({ _pollTimer: null }); return; }
    const timer = setTimeout(async () => { await get().reload(); }, 2000);
    set({ _pollTimer: timer });
  },

  moveStop: async (stopId, targetDayId, targetOrder) => {
    const tripId = get().tripId;
    if (!tripId) return;
    await fetch(`/api/trips/${tripId}/stops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stopId, targetDayId, targetOrder }),
    });
    await get().reload();
  },

  removeStop: async (stopId) => {
    const tripId = get().tripId;
    if (!tripId) return;
    await fetch(`/api/trips/${tripId}/stops/${stopId}?keepLocation=true`, { method: "DELETE" });
    await get().reload();
  },

  setStopLocked: async (stopId, locked) => {
    const tripId = get().tripId;
    if (!tripId) return;
    await fetch(`/api/trips/${tripId}/stops/${stopId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked }),
    });
    await get().reload();
  },

  addLocationToDay: async (locationId, dayId) => {
    const tripId = get().tripId;
    if (!tripId) return;
    await fetch(`/api/trips/${tripId}/stops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, targetDayId: dayId }),
    });
    await get().reload();
  },

  saveStays: async (stays) => {
    const tripId = get().tripId;
    if (!tripId) return "No trip loaded";
    const res = await fetch(`/api/trips/${tripId}/stays`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stays }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return (data as { error?: string }).error ?? "Failed to save stays";
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
    set({ highlightedLocationId: locationId, activeView: "itinerary" });
    setTimeout(() => set({ highlightedLocationId: null }), 2000);
  },
}));
