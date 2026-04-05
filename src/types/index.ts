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
  note: string | null;
  stops?: ItineraryStop[];
  rating: number | null;
  reviewCount: number | null;
  categories: string[] | null;
};

export type NearbyPlace = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  categories: string[];
  priceLevel: number | null;  // 0–4
  distanceMeters: number | null;
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

