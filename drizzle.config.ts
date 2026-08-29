import { defineConfig } from "drizzle-kit";

// ADR-0037: Turso/libSQL. Falls back to the local dev file when TURSO_DATABASE_URL isn't set, so
// `drizzle-kit generate` needs no environment setup for local development.
export default defineConfig({
  dialect: "turso",
  schema: "./src/lib/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:./db/dev.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
