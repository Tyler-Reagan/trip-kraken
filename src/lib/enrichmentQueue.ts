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
 *    restart are surfaced by the "Retry" button in the UI. (ADR-0009 replaces this
 *    with pending-rows-as-queue + startup auto-recovery in a later branch.)
 */

import { getLocationForEnrichment, applyEnrichment, markEnrichmentFailed } from "@/lib/db";
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

      const loc = getLocationForEnrichment(item.locationId);
      // Location may have been deleted between enqueue and processing
      if (!loc) continue;

      try {
        // applyEnrichment writes only non-null fields (no overwrite with null) and marks
        // 'done'; an empty result marks the row 'failed'.
        applyEnrichment(item.locationId, await enrichLocation(loc));
      } catch {
        markEnrichmentFailed(item.locationId);
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
