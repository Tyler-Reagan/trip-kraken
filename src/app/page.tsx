import { listTrips } from "@/lib/db";
import NewTripForm from "@/components/NewTripForm";
import ImportForm from "@/components/ImportForm";
import TripList from "@/components/TripList";
import HelpButton from "@/components/HelpButton";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const trips = listTrips();

  return (
    <div className="space-y-10">
      {/* Hero section */}
      <section className="text-center space-y-4 pt-4">
        <h1 className="text-4xl font-bold tracking-tight text-ink">
          Turn a list into a trip
        </h1>
        <p className="text-sub max-w-xl mx-auto">
          Start a blank trip and add places by searching Google, or import a Google
          My Maps you already have. Trip Kraken clusters them into optimized days.
        </p>
      </section>

      {/* Two co-equal entry points (ADR-0010) */}
      <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto items-stretch">
        <NewTripForm />
        <ImportForm />
      </div>

      {trips.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-ink">Your trips</h2>
          <TripList trips={trips} />
        </section>
      )}

      <HelpButton />
    </div>
  );
}
