import { listTrips } from "@/lib/db";
import ImportForm from "@/components/ImportForm";
import TripList from "@/components/TripList";

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

      {/* Instructions */}
      <section className="card p-6 space-y-3 max-w-2xl mx-auto text-sm text-gray-600 dark:text-gray-400">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200">How to get your map link</h3>
        <ol className="list-decimal list-inside space-y-2">
          <li>Go to <a href="https://mymaps.google.com" target="_blank" rel="noopener noreferrer" className="underline text-brand-600 dark:text-brand-400">mymaps.google.com</a> and create a map.</li>
          <li>Add placemarks for all the locations you want to visit.</li>
          <li>Click the <strong className="text-gray-700 dark:text-gray-300">Share</strong> button and set access to <strong className="text-gray-700 dark:text-gray-300">Anyone with the link can view</strong>.</li>
          <li>Copy the URL from your browser&apos;s address bar and paste it above.</li>
        </ol>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          The map must be public for import to work. Coordinates are read directly from the map — no extra steps needed.
        </p>
      </section>
    </div>
  );
}
