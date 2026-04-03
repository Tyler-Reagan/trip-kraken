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
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">
          Turn a list into a trip
        </h1>
        <p className="text-gray-500 max-w-xl mx-auto">
          Paste a shared Google Maps list link and Trip Kraken will cluster your
          locations into optimized days, ready for you to tweak.
        </p>
      </section>

      <ImportForm />

      {trips.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-700">Your trips</h2>
          <TripList trips={trips} />
        </section>
      )}

      {/* Instructions */}
      <section className="card p-6 space-y-3 max-w-2xl mx-auto text-sm text-gray-600">
        <h3 className="font-semibold text-gray-800">How to get your list link</h3>
        <ol className="list-decimal list-inside space-y-2">
          <li>Open Google Maps and go to <strong>Saved &rarr; Lists</strong>.</li>
          <li>Open the list you want to use as your trip base.</li>
          <li>Tap the <strong>Share</strong> button and copy the public link.</li>
          <li>Paste it above and hit <strong>Import</strong>.</li>
        </ol>
        <p className="text-xs text-gray-400">
          The list must be set to &quot;Anyone with the link&quot; for import to work.
        </p>
      </section>
    </div>
  );
}
