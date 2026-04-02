"use client";

import Link from "next/link";

interface TripSummary {
  id: string;
  name: string;
  numDays: number | null;
  createdAt: Date | string;
  _count: { locations: number };
}

export default function TripList({ trips }: { trips: TripSummary[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((trip) => (
        <li key={trip.id}>
          <Link
            href={`/trips/${trip.id}`}
            className="card p-4 block hover:shadow-md transition-shadow"
          >
            <p className="font-semibold text-gray-900 truncate">{trip.name}</p>
            <p className="text-sm text-gray-500 mt-1">
              {trip._count.locations} location
              {trip._count.locations !== 1 ? "s" : ""}
              {trip.numDays ? ` · ${trip.numDays} days` : ""}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {new Date(trip.createdAt).toLocaleDateString()}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
