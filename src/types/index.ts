export type TripWithDetails = {
  id: string;
  name: string;
  sourceUrl: string | null; // nullable for blank-slate trips (ADR-0010)
  numDays: number | null;
  startDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  arrivalLocationId: string | null;   // trip-edge transport anchors (ADR-0005, #54)
  departureLocationId: string | null;
  locations: Location[];
  stays: Stay[];
  days: ItineraryDay[];
};

/** A date accommodation booking — a Lodging with check-in/check-out dates (ADR-0014). */
export type Stay = {
  id: string;
  tripId: string;
  lodgingLocationId: string;
  checkInDate: string;  // "YYYY-MM-DD"
  checkOutDate: string; // "YYYY-MM-DD" — half-open: nights are [checkInDate, checkOutDate)
};

/**
 * A role a Location plays in a trip, *derived* from what references it — not a stored flag
 * (ADR-0014). A Location is a "lodging" because a Stay references it, and "arrival"/"departure"
 * because the Trip's edge anchors reference it (ADR-0005). All current roles are *anchor* roles:
 * a Location with any role fills a Day's anchor slot and is never a scheduled activity Stop.
 */
export type LocationRole = "lodging" | "arrival" | "departure";

export type Location = {
  id: string;
  tripId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  excluded: boolean;
  roles: LocationRole[]; // derived from references (ADR-0014); [] for a plain candidate
  note: string | null;
  stops?: ItineraryStop[];
  rating: number | null;
  reviewCount: number | null;
  categories: string[] | null;
  visitDuration: number | null; // estimated visit time in minutes
  openTime: string | null;      // "HH:MM" 24-hour, e.g. "09:00" — Monday representative, used by optimizer
  closeTime: string | null;     // "HH:MM" 24-hour, e.g. "17:00" — Monday representative, used by optimizer
  hoursJson: Record<string, { open: string; close: string | null }> | null; // keys "0"–"6" (Sun–Sat)
  phone: string | null;
  enrichmentStatus: "done" | "pending" | "failed";
};

export type NearbyPlace = {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  categories: string[];
  priceLevel: number | null;  // 0–4
  distanceMeters: number | null;
  detailUrl?: string;         // Tabelog detail page href; absent for Google results
};

export type ItineraryDay = {
  id: string;
  tripId: string;
  dayNumber: number;
  date: Date | null;
  label: string | null;
  // A Day's anchors (ADR-0005): where its route starts and ends. Usually the Stay's lodging;
  // the first Day may start at an arrival anchor and the last Day end at a departure anchor.
  // The anchor Location's `roles` say which kind it is.
  startAnchor: Location | null;
  endAnchor: Location | null;
  // On a check-in day (you sleep somewhere different from where you woke) the new lodging is also
  // visited mid-route to drop bags (ADR-0013 Phase 2): the same Location as the overnight end
  // anchor, surfaced as a within-day waypoint. Null on round-trip days. Derived, never a Stop.
  checkInWaypoint: Location | null;
  stops: ItineraryStop[];
};

export type ItineraryStop = {
  id: string;
  dayId: string;
  locationId: string;
  order: number;
  notes: string | null;
  locked: boolean;
  location: Location;
};

