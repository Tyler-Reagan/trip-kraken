/**
 * Next.js server-startup hook (runs once per server instance, every runtime). Used for exactly one
 * thing: ADR-0009's enrichment-queue startup auto-recovery (#124) — re-enqueue any Location left
 * `enrichmentStatus: 'pending'` by a prior process's restart, deploy, or crash. Gated to the Node.js
 * runtime since it touches native modules (better-sqlite3, @libsql/client's local-file mode) the
 * Edge runtime can't load.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverPendingEnrichment } = await import("@/lib/enrichmentQueue");
    // Fire-and-forget, same as enqueueLocationEnrichment itself — startup shouldn't block on it.
    recoverPendingEnrichment().catch((err) => console.error("[instrumentation] enrichment recovery failed:", err));
  }
}
