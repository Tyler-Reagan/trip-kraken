import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import TripClient from "@/components/TripClient";

export const dynamic = "force-dynamic";

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const trip = await db.trip.findUnique({
    where: { id },
    include: {
      locations: { orderBy: { name: "asc" } },
      days: {
        orderBy: { dayNumber: "asc" },
        include: {
          stops: {
            orderBy: { order: "asc" },
            include: { location: true },
          },
        },
      },
    },
  });

  if (!trip) notFound();

  return <TripClient trip={trip} />;
}
