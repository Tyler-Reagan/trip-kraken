import { notFound } from "next/navigation";
import { getTripWithDetails } from "@/lib/db";
import TripClient from "@/components/TripClient";

export const dynamic = "force-dynamic";

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = getTripWithDetails(id);
  if (!trip) notFound();
  return <TripClient trip={trip} />;
}
