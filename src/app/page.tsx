import { listTrips } from "@/lib/db";
import ImportForm from "@/components/ImportForm";
import TripList from "@/components/TripList";
import HelpButton from "@/components/HelpButton";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const trips = listTrips();

  return (
    <div className="space-y-10">
      {/* Hero / import section */}
      <section className="text-center space-y-4 pt-4">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Turn a list into a trip
        </h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
          Paste a Google My Maps link and Trip Kraken will cluster your
          locations into optimized days, ready for you to tweak.
        </p>
      </section>

      <ImportForm />

      {trips.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Your trips</h2>
          <TripList trips={trips} />
        </section>
      )}

      <HelpButton />
    </div>
  );
}
