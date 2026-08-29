import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules; keep them external so Next doesn't try to bundle them. @libsql/client's
  // local-file mode loads a native binding (ADR-0037); better-sqlite3 backs the separate,
  // read-only rail-graph store (transitGraphStore.ts) that ADR-0037 doesn't touch.
  serverExternalPackages: ["@libsql/client", "better-sqlite3"],
};

export default nextConfig;
