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
 * The queue itself is still in-memory and still loses pending items on process
 * restart — but per ADR-0009, `enrichmentStatus = 'pending'` rows *are* the durable
 * work-list, not a separate jobs table. `recoverPendingEnrichment` (called once from
 * `src/instrumentation.ts` on server startup, #124) re-scans for them and re-enqueues,
 * so a restart no longer strands a Location — only the UI's manual "Retry" affordance
 * for `'failed'` rows remains a human-triggered path.
 */

import {
  getLocationForEnrichment,
  applyEnrichment,
  markEnrichmentFailed,
  getPendingLocationIds,
} from "@/lib/db";
import { enrichLocation } from "@/lib/places";

type QueueItem = { locationId: string };

const g = globalThis as unknown as {
  _enrichQueue?: QueueItem[];
  _enrichRunning?: boolean;
  _enrichRecovered?: boolean;
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

      const loc = await getLocationForEnrichment(item.locationId);
      // Location may have been deleted between enqueue and processing
      if (!loc) continue;

      try {
        // applyEnrichment writes only non-null fields (no overwrite with null) and marks
        // 'done'; an empty result marks the row 'failed'.
        await applyEnrichment(item.locationId, await enrichLocation(loc));
      } catch (err) {
        // The thrown reason is the only account of *why* this row failed — the Retry affordance
        // has nothing else to show a user, so it's recorded rather than swallowed.
        await markEnrichmentFailed(
          item.locationId,
          err instanceof Error ? err.message : String(err),
        );
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
      console.error("[enrichmentQueue] consumer error:", err),
    );
  });
}

/**
 * ADR-0009's startup auto-recovery (#124): re-scan for every Location still `'pending'` — left
 * that way by a server restart, deploy, or crash dropping the in-memory queue — and re-enqueue
 * each one. Called once from `src/instrumentation.ts`. Guarded on `globalThis` the same way the
 * queue itself is, so a stray double-call in the same process (e.g. a dev-server re-init) doesn't
 * re-enqueue what the first call already picked up.
 */
export async function recoverPendingEnrichment(): Promise<void> {
  if (g._enrichRecovered) return;
  g._enrichRecovered = true;
  for (const locationId of await getPendingLocationIds()) {
    enqueueLocationEnrichment(locationId);
  }
}
