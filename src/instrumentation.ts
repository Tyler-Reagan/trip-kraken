/**
 * Next.js server-startup hook (runs once per server instance, every runtime). Used for exactly one
 * thing: ADR-0009's enrichment-queue startup auto-recovery (#124) — re-enqueue any Location left
 * `enrichmentStatus: 'pending'` by a prior process's restart, deploy, or crash. Gated to the Node.js
 * runtime since it touches better-sqlite3, which the Edge runtime can't load.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverPendingEnrichment } = await import("@/lib/enrichmentQueue");
    recoverPendingEnrichment();
  }
}
