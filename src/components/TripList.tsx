"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface TripSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: Date | string;
  _count: { locations: number };
}

const shortDate = (date: string) =>
  new Date(date.slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function TripList({ trips }: { trips: TripSummary[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, tripId: string) {
    e.preventDefault();
    setDeletingId(tripId);
    await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
    router.refresh();
    setDeletingId(null);
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((trip) => (
        <li key={trip.id} className="group relative">
          <Link
            href={`/trips/${trip.id}`}
            className="card p-4 block hover:shadow-md transition-shadow"
          >
            <p className="font-semibold text-ink truncate pr-6">{trip.name}</p>
            <p className="text-sm text-sub mt-1">
              {trip._count.locations} location
              {trip._count.locations !== 1 ? "s" : ""}
              {` · ${shortDate(trip.startDate)} → ${shortDate(trip.endDate)}`}
            </p>
            <p className="text-xs text-faint mt-2">
              {new Date(trip.createdAt).toLocaleDateString()}
            </p>
          </Link>
          <button
            onClick={(e) => handleDelete(e, trip.id)}
            disabled={deletingId === trip.id}
            className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
              text-ghost hover:text-danger-400 dark:hover:text-danger-400
              disabled:opacity-30 text-lg leading-none"
            aria-label={`Delete ${trip.name}`}
            title="Delete trip"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
