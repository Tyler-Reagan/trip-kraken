export default function TripLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-64 bg-surface-2 rounded-lg" />
          <div className="h-4 w-32 bg-surface-2 rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 bg-surface-2 rounded-lg" />
          <div className="h-9 w-32 bg-surface-2 rounded-lg" />
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-2">
        <div className="h-8 w-48 bg-surface-2 rounded-lg" />
        <div className="h-8 w-16 bg-surface-2 rounded-full" />
        <div className="h-8 w-16 bg-surface-2 rounded-full" />
        <div className="h-8 w-16 bg-surface-2 rounded-full" />
      </div>

      {/* Day cards */}
      <div className="flex gap-6 items-start">
        {/* Sidebar skeleton */}
        <div className="hidden lg:block w-72 shrink-0 space-y-2">
          <div className="h-4 w-40 bg-surface-2 rounded" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 bg-surface-2 rounded-lg" />
          ))}
        </div>

        {/* Cards skeleton */}
        <div className="flex-1 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-5 w-20 bg-surface-2 rounded" />
                <div className="h-4 w-12 bg-surface-2 rounded" />
              </div>
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-12 bg-surface-2 rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
