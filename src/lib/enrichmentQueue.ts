/**
 * In-process enrichment queue.
 *
 * Provides a fire-and-forget mechanism to enrich locations with Google Place
 * Details after they are added to the DB. The queue is a singleton stored on
 * `globalThis` so it survives Next.js hot reloads without spawning duplicate
 * consumers.
 *
 * The consumer serializes all enrichment calls and enforces a 150ms inter-call
 * delay to stay within Google's ~10 QPS rate limit.
 *
 * ⚠️ Known limitation: the queue is in-memory. Pending items are lost on
 *    process restart. Locations left with enrichmentStatus='pending' after a
 *    restart are surfaced by the "Retry" button in the UI.
 */

import { getDb } from "@/lib/db";
import { enrichLocation } from "@/lib/places";

type QueueItem = { locationId: string };

const g = globalThis as unknown as {
  _enrichQueue?: QueueItem[];
  _enrichRunning?: boolean;
};

function getQueue(): QueueItem[] {
  if (!g._enrichQueue) g._enrichQueue = [];
  return g._enrichQueue;
}

async function runConsumer(): Promise<void> {
  // Guard against concurrent consumers (e.g. two rapid enqueue calls)
  if (g._enrichRunning) return;
  g._enrichRunning = true;

  try {
    while (getQueue().length > 0) {
      const item = getQueue().shift()!;

      type LocRow = {
        id: string;
        name: string;
        lat: number | null;
        lng: number | null;
        placeId: string | null;
      };

      const loc = getDb()
        .prepare("SELECT id, name, lat, lng, placeId FROM Location WHERE id = ?")
        .get(item.locationId) as LocRow | undefined;

      // Location may have been deleted between enqueue and processing
      if (!loc) continue;

      try {
        const enrichment = await enrichLocation(loc);

        if (Object.keys(enrichment).length > 0) {
          // COALESCE preserves existing values when enrichment returns nulls —
          // partial enrichment (e.g. coords resolved but details unavailable)
          // does not overwrite good data with null.
          getDb()
            .prepare(
              `UPDATE Location SET
                placeId      = COALESCE(?, placeId),
                lat          = COALESCE(?, lat),
                lng          = COALESCE(?, lng),
                address      = COALESCE(?, address),
                rating       = COALESCE(?, rating),
                reviewCount  = COALESCE(?, reviewCount),
                categories   = COALESCE(?, categories),
                phone        = COALESCE(?, phone),
                openTime     = COALESCE(?, openTime),
                closeTime    = COALESCE(?, closeTime),
                hoursJson    = COALESCE(?, hoursJson),
                enrichmentStatus = 'done'
              WHERE id = ?`
            )
            .run(
              enrichment.placeId ?? null,
              enrichment.lat ?? null,
              enrichment.lng ?? null,
              enrichment.address ?? null,
              enrichment.rating ?? null,
              enrichment.reviewCount ?? null,
              enrichment.categories ? JSON.stringify(enrichment.categories) : null,
              enrichment.phone ?? null,
              enrichment.openTime ?? null,
              enrichment.closeTime ?? null,
              enrichment.hoursJson ? JSON.stringify(enrichment.hoursJson) : null,
              item.locationId,
            );
        } else {
          // enrichLocation returned {} — couldn't resolve the place
          getDb()
            .prepare("UPDATE Location SET enrichmentStatus = 'failed' WHERE id = ?")
            .run(item.locationId);
        }
      } catch {
        getDb()
          .prepare("UPDATE Location SET enrichmentStatus = 'failed' WHERE id = ?")
          .run(item.locationId);
      }

      // Enforce Google rate limit between calls
      await new Promise<void>((r) => setTimeout(r, 150));
    }
  } finally {
    g._enrichRunning = false;
  }
}

/**
 * Enqueue a location for background enrichment.
 *
 * The location must already exist in the DB with enrichmentStatus='pending'.
 * The consumer runs asynchronously via setImmediate so the calling request
 * handler can return its response before any Google API calls are made.
 */
export function enqueueLocationEnrichment(locationId: string): void {
  getQueue().push({ locationId });
  // setImmediate yields to the event loop, ensuring this request's response
  // is sent before the consumer starts. Does not block the caller.
  setImmediate(() => {
    runConsumer().catch((err) =>
      console.error("[enrichmentQueue] consumer error:", err)
    );
  });
}
