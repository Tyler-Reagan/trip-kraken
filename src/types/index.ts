export type TripWithDetails = {
  id: string;
  name: string;
  sourceUrl: string;
  numDays: number | null;
  startDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  locations: Location[];
  days: ItineraryDay[];
};

export type Location = {
  id: string;
  tripId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  excluded: boolean;
  isAnchor: boolean;
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
  stops: ItineraryStop[];
};

export type ItineraryStop = {
  id: string;
  dayId: string;
  locationId: string;
  order: number;
  notes: string | null;
  location: Location;
};

