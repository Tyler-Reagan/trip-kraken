import { create } from "zustand";
import type { TripWithDetails, Location } from "@/types";

type ActiveView = "itinerary" | "map";

interface TripStore {
  // Data
  trip: TripWithDetails | null;
  tripId: string | null;

  // UI state
  activeView: ActiveView;
  selectedDayNumber: number | null;
  highlightedLocationId: string | null;
  nearbyAnchor: Location | null;
  showOptimize: boolean;
  showAddLocation: boolean;
  showLocationDrawer: boolean;

  // Setters
  setTrip: (trip: TripWithDetails) => void;
  setActiveView: (v: ActiveView) => void;
  setSelectedDayNumber: (n: number | null) => void;
  setHighlightedLocationId: (id: string | null) => void;
  setNearbyAnchor: (loc: Location | null) => void;
  setShowOptimize: (v: boolean) => void;
  setShowAddLocation: (v: boolean) => void;
  setShowLocationDrawer: (v: boolean) => void;

  // Async mutations — use get().tripId internally
  reload: () => Promise<void>;
  moveStop: (stopId: string, targetDayId: string, targetOrder: number) => Promise<void>;
  toggleExcluded: (locationId: string, excluded: boolean) => Promise<void>;

  // Composite action: switch to itinerary + highlight, then auto-clear
  handleMapLocationClick: (locationId: string) => void;
}

export const useTripStore = create<TripStore>()((set, get) => ({
  trip: null,
  tripId: null,

  activeView: "itinerary",
  selectedDayNumber: null,
  highlightedLocationId: null,
  nearbyAnchor: null,
  showOptimize: false,
  showAddLocation: false,
  showLocationDrawer: false,

  setTrip: (trip) => set({ trip, tripId: trip.id }),
  setActiveView: (v) => set({ activeView: v }),
  setSelectedDayNumber: (n) => set({ selectedDayNumber: n }),
  setHighlightedLocationId: (id) => set({ highlightedLocationId: id }),
  setNearbyAnchor: (loc) => set({ nearbyAnchor: loc }),
  setShowOptimize: (v) => set({ showOptimize: v }),
  setShowAddLocation: (v) => set({ showAddLocation: v }),
  setShowLocationDrawer: (v) => set({ showLocationDrawer: v }),

  reload: async () => {
    const tripId = get().tripId;
    if (!tripId) return;
    const res = await fetch(`/api/trips/${tripId}`);
    if (res.ok) set({ trip: await res.json() });
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

  toggleExcluded: async (locationId, excluded) => {
    const tripId = get().tripId;
    if (!tripId) return;
    await fetch(`/api/trips/${tripId}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excluded }),
    });
    await get().reload();
  },

  handleMapLocationClick: (locationId) => {
    set({ highlightedLocationId: locationId, activeView: "itinerary" });
    setTimeout(() => set({ highlightedLocationId: null }), 2000);
  },
}));
