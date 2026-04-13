import { DatabaseSync } from "node:sqlite";
import path from "path";
import { randomUUID } from "crypto";
import type { TripWithDetails, Location, ItineraryDay, ItineraryStop } from "@/types";

const DB_PATH = path.join(process.cwd(), "db", "dev.db");

function openDb(): DatabaseSync {
  const database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS Trip (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sourceUrl TEXT NOT NULL,
      numDays INTEGER,
      startDate TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS Location (
      id TEXT PRIMARY KEY,
      tripId TEXT NOT NULL REFERENCES Trip(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      placeId TEXT,
      excluded INTEGER NOT NULL DEFAULT 0,
      note TEXT
    )
  `);
  const locationAlters = [
    "ALTER TABLE Location ADD COLUMN rating REAL",
    "ALTER TABLE Location ADD COLUMN reviewCount INTEGER",
    "ALTER TABLE Location ADD COLUMN categories TEXT",
    "ALTER TABLE Location ADD COLUMN visitDuration INTEGER",
    "ALTER TABLE Location ADD COLUMN openTime TEXT",
    "ALTER TABLE Location ADD COLUMN closeTime TEXT",
    "ALTER TABLE Location ADD COLUMN isAnchor INTEGER NOT NULL DEFAULT 0",
  ];
  for (const sql of locationAlters) {
    try { database.exec(sql); } catch { /* column already exists */ }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS ItineraryDay (
      id TEXT PRIMARY KEY,
      tripId TEXT NOT NULL REFERENCES Trip(id) ON DELETE CASCADE,
      dayNumber INTEGER NOT NULL,
      date TEXT,
      label TEXT
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS ItineraryStop (
      id TEXT PRIMARY KEY,
      dayId TEXT NOT NULL REFERENCES ItineraryDay(id) ON DELETE CASCADE,
      locationId TEXT NOT NULL REFERENCES Location(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      notes TEXT
    )
  `);
  return database;
}

const g = globalThis as unknown as { _db?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!g._db) g._db = openDb();
  return g._db;
}

export const newId = () => randomUUID();

// ─── Row shapes returned by SQLite ───────────────────────────────────────────

type TripRow = {
  id: string; name: string; sourceUrl: string;
  numDays: number | null; startDate: string | null;
  createdAt: string; updatedAt: string;
};
type LocationRow = {
  id: string; tripId: string; name: string; address: string | null;
  lat: number | null; lng: number | null; placeId: string | null;
  excluded: number; isAnchor: number; note: string | null;
  rating: number | null; reviewCount: number | null; categories: string | null;
  visitDuration: number | null;
  openTime: string | null;
  closeTime: string | null;
};
type DayRow = {
  id: string; tripId: string; dayNumber: number;
  date: string | null; label: string | null;
};
type StopRow = { id: string; dayId: string; locationId: string; ord: number; notes: string | null };
type StopWithLocRow = StopRow & {
  loc_id: string; loc_tripId: string; loc_name: string;
  loc_address: string | null; loc_lat: number | null; loc_lng: number | null;
  loc_placeId: string | null; loc_excluded: number; loc_isAnchor: number; loc_note: string | null;
  loc_rating: number | null; loc_reviewCount: number | null; loc_categories: string | null;
  loc_visitDuration: number | null;
  loc_openTime: string | null;
  loc_closeTime: string | null;
};

// ─── Deserializers ────────────────────────────────────────────────────────────

function parseTrip(r: TripRow) {
  return {
    id: r.id, name: r.name, sourceUrl: r.sourceUrl,
    numDays: r.numDays ?? null,
    startDate: r.startDate ? new Date(r.startDate) : null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

function parseLocation(r: LocationRow): Location {
  return {
    ...r,
    excluded: r.excluded !== 0,
    isAnchor: r.isAnchor !== 0,
    categories: r.categories ? JSON.parse(r.categories) : null,
  };
}

function parseStopWithLoc(r: StopWithLocRow): ItineraryStop {
  return {
    id: r.id, dayId: r.dayId, locationId: r.locationId,
    order: r.ord, notes: r.notes,
    location: {
      id: r.loc_id, tripId: r.loc_tripId, name: r.loc_name,
      address: r.loc_address, lat: r.loc_lat, lng: r.loc_lng,
      placeId: r.loc_placeId, excluded: r.loc_excluded !== 0, note: r.loc_note,
      rating: r.loc_rating, reviewCount: r.loc_reviewCount,
      categories: r.loc_categories ? JSON.parse(r.loc_categories) : null,
      visitDuration: r.loc_visitDuration ?? null,
      openTime: r.loc_openTime ?? null,
      closeTime: r.loc_closeTime ?? null,
      isAnchor: r.loc_isAnchor !== 0,
    },
  };
}

// ─── Transaction helper ───────────────────────────────────────────────────────

function transaction<T>(fn: () => T): T {
  getDb().exec("BEGIN");
  try {
    const result = fn();
    getDb().exec("COMMIT");
    return result;
  } catch (err) {
    getDb().exec("ROLLBACK");
    throw err;
  }
}

// ─── Exported query helpers ───────────────────────────────────────────────────

export function listTrips() {
  const rows = getDb().prepare(`
    SELECT t.*, COUNT(l.id) as locationCount
    FROM Trip t
    LEFT JOIN Location l ON l.tripId = t.id
    GROUP BY t.id
    ORDER BY t.createdAt DESC
  `).all() as (TripRow & { locationCount: number })[];

  return rows.map((r) => ({
    ...parseTrip(r),
    _count: { locations: r.locationCount },
  }));
}

export function getTripWithDetails(id: string): TripWithDetails | null {
  const tripRow = getDb().prepare("SELECT * FROM Trip WHERE id = ?").get(id) as TripRow | undefined;
  if (!tripRow) return null;

  const locationRows = getDb().prepare(
    "SELECT * FROM Location WHERE tripId = ? ORDER BY name ASC"
  ).all(id) as LocationRow[];

  const dayRows = getDb().prepare(
    "SELECT * FROM ItineraryDay WHERE tripId = ? ORDER BY dayNumber ASC"
  ).all(id) as DayRow[];

  const stopRows = getDb().prepare(`
    SELECT s.id, s.dayId, s.locationId, s.ord, s.notes,
           l.id as loc_id, l.tripId as loc_tripId, l.name as loc_name,
           l.address as loc_address, l.lat as loc_lat, l.lng as loc_lng,
           l.placeId as loc_placeId, l.excluded as loc_excluded, l.note as loc_note,
           l.rating as loc_rating, l.reviewCount as loc_reviewCount,
           l.categories as loc_categories, l.visitDuration as loc_visitDuration,
           l.openTime as loc_openTime, l.closeTime as loc_closeTime,
           l.isAnchor as loc_isAnchor
    FROM ItineraryStop s
    JOIN Location l ON l.id = s.locationId
    JOIN ItineraryDay d ON d.id = s.dayId
    WHERE d.tripId = ?
    ORDER BY s.ord ASC
  `).all(id) as StopWithLocRow[];

  const days: ItineraryDay[] = dayRows.map((day) => ({
    id: day.id, tripId: day.tripId, dayNumber: day.dayNumber,
    date: day.date ? new Date(day.date) : null,
    label: day.label,
    stops: stopRows.filter((s) => s.dayId === day.id).map(parseStopWithLoc),
  }));

  return { ...parseTrip(tripRow), locations: locationRows.map(parseLocation), days };
}

function requireTrip(tripId: string): TripWithDetails {
  const trip = getTripWithDetails(tripId);
  if (!trip) throw new Error(`Trip ${tripId} not found after write — possible DB inconsistency`);
  return trip;
}

export function createTripWithLocations(data: {
  name: string;
  sourceUrl: string;
  locations: Array<{
    name: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    placeId?: string | null;
  }>;
}): TripWithDetails {
  const tripId = newId();
  const insertTrip = getDb().prepare(
    "INSERT INTO Trip (id, name, sourceUrl, numDays, startDate, createdAt, updatedAt) VALUES (?, ?, ?, NULL, NULL, datetime('now'), datetime('now'))"
  );
  const insertLoc = getDb().prepare(
    "INSERT INTO Location (id, tripId, name, address, lat, lng, placeId, excluded, note) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)"
  );

  transaction(() => {
    insertTrip.run(tripId, data.name, data.sourceUrl);
    for (const loc of data.locations) {
      insertLoc.run(newId(), tripId, loc.name, loc.address ?? null, loc.lat ?? null, loc.lng ?? null, loc.placeId ?? null);
    }
  });

  return requireTrip(tripId);
}

export function rebuildItinerary(
  tripId: string,
  numDays: number,
  startDate: string | null,
  dayPlans: Array<{ dayNumber: number; locationIds: string[] }>
): TripWithDetails {
  const deleteDays = getDb().prepare("DELETE FROM ItineraryDay WHERE tripId = ?");
  const updateTrip = getDb().prepare(
    "UPDATE Trip SET numDays = ?, startDate = ?, updatedAt = datetime('now') WHERE id = ?"
  );
  const insertDay = getDb().prepare(
    "INSERT INTO ItineraryDay (id, tripId, dayNumber, date, label) VALUES (?, ?, ?, ?, NULL)"
  );
  const insertStop = getDb().prepare(
    "INSERT INTO ItineraryStop (id, dayId, locationId, ord, notes) VALUES (?, ?, ?, ?, NULL)"
  );

  transaction(() => {
    deleteDays.run(tripId);
    updateTrip.run(numDays, startDate ? new Date(startDate).toISOString() : null, tripId);

    for (const plan of dayPlans) {
      const dayId = newId();
      const date =
        startDate && plan.dayNumber > 0
          ? new Date(
              new Date(startDate).getTime() + (plan.dayNumber - 1) * 86400000
            ).toISOString()
          : null;
      insertDay.run(dayId, tripId, plan.dayNumber, date);
      for (let i = 0; i < plan.locationIds.length; i++) {
        insertStop.run(newId(), dayId, plan.locationIds[i], i);
      }
    }
  });

  return requireTrip(tripId);
}

export function addStopToDay(
  tripId: string,
  locationId: string,
  dayId: string
): TripWithDetails {
  const db = getDb();

  const loc = db.prepare("SELECT id FROM Location WHERE id = ? AND tripId = ?").get(locationId, tripId);
  if (!loc) throw new Error("Location not found in trip");

  const day = db.prepare("SELECT id FROM ItineraryDay WHERE id = ? AND tripId = ?").get(dayId, tripId);
  if (!day) throw new Error("Day not found in trip");

  const { maxOrd } = db
    .prepare("SELECT MAX(ord) as maxOrd FROM ItineraryStop WHERE dayId = ?")
    .get(dayId) as { maxOrd: number | null };

  const ord = (maxOrd ?? -1) + 1;
  db.prepare(
    "INSERT INTO ItineraryStop (id, dayId, locationId, ord, notes) VALUES (?, ?, ?, ?, NULL)"
  ).run(newId(), dayId, locationId, ord);

  return requireTrip(tripId);
}

export function moveStop(
  tripId: string,
  stopId: string,
  targetDayId: string,
  targetOrder: number
): TripWithDetails {
  const getStop = getDb().prepare("SELECT * FROM ItineraryStop WHERE id = ?");
  const getDay = getDb().prepare("SELECT * FROM ItineraryDay WHERE id = ? AND tripId = ?");
  const shiftOrds = getDb().prepare(
    "UPDATE ItineraryStop SET ord = ord + 1 WHERE dayId = ? AND ord >= ?"
  );
  const updateStop = getDb().prepare(
    "UPDATE ItineraryStop SET dayId = ?, ord = ? WHERE id = ?"
  );
  const getRemaining = getDb().prepare(
    "SELECT id FROM ItineraryStop WHERE dayId = ? ORDER BY ord ASC"
  );
  const setOrd = getDb().prepare("UPDATE ItineraryStop SET ord = ? WHERE id = ?");

  transaction(() => {
    const stop = getStop.get(stopId) as StopRow | undefined;
    if (!stop) throw new Error("Stop not found");

    const targetDay = getDay.get(targetDayId, tripId);
    if (!targetDay) throw new Error("Target day not found");

    const sourceDayId = stop.dayId;

    shiftOrds.run(targetDayId, targetOrder);
    updateStop.run(targetDayId, targetOrder, stopId);

    if (sourceDayId !== targetDayId) {
      const remaining = getRemaining.all(sourceDayId) as { id: string }[];
      for (let i = 0; i < remaining.length; i++) {
        setOrd.run(i, remaining[i].id);
      }
    }
  });

  return requireTrip(tripId);
}
