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

export type ImportPayload = {
  url: string;
};

export type OptimizePayload = {
  numDays: number;
  startDate?: string;
};

export type UpdateLocationPayload = {
  excluded?: boolean;
  note?: string;
  name?: string;
};

export type MoveStopPayload = {
  stopId: string;
  targetDayId: string;
  targetOrder: number;
};
