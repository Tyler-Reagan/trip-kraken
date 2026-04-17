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
  nearbyAnchor: Location | null;
  showOptimize: boolean;
  showAddLocation: boolean;

  // Setters
  setTrip: (trip: TripWithDetails) => void;
  setActiveView: (v: ActiveView) => void;
  setSelectedDayNumber: (n: ScheduleFilter) => void;
  setHighlightedLocationId: (id: string | null) => void;
  setInspectedLocationId: (id: string | null) => void;
  setNearbyAnchor: (loc: Location | null) => void;
  setShowOptimize: (v: boolean) => void;
  setShowAddLocation: (v: boolean) => void;

  // Async mutations — use get().tripId internally
  reload: () => Promise<void>;
  moveStop: (stopId: string, targetDayId: string, targetOrder: number) => Promise<void>;
  removeStop: (stopId: string) => Promise<void>;
  addLocationToDay: (locationId: string, dayId: string) => Promise<void>;
  toggleAnchor: (locationId: string, isAnchor: boolean) => Promise<void>;
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
  nearbyAnchor: null,
  showOptimize: false,
  showAddLocation: false,
  isEnriching: false,
  enrichProgress: null,
  _pollTimer: null,

  setTrip: (trip) => set({ trip, tripId: trip.id }),
  setActiveView: (v) => set({ activeView: v }),
  setSelectedDayNumber: (n) => set({ selectedDayNumber: n }),
  setHighlightedLocationId: (id) => set({ highlightedLocationId: id }),
  setInspectedLocationId: (id) => set({ inspectedLocationId: id }),
  setNearbyAnchor: (loc) => set({ nearbyAnchor: loc }),
  setShowOptimize: (v) => set({ showOptimize: v }),
  setShowAddLocation: (v) => set({ showAddLocation: v }),

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

  toggleAnchor: async (locationId, isAnchor) => {
    const tripId = get().tripId;
    if (!tripId) return;
    await fetch(`/api/trips/${tripId}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAnchor }),
    });
    await get().reload();
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
