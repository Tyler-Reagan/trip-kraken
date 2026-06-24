/**
 * Database client — the single connection and the migration runner (ADR-0008).
 *
 * better-sqlite3 is synchronous (the correct model for an in-process local DB). One
 * connection is shared and stored on globalThis so it survives Next.js hot reloads.
 * Pending migrations are applied on first init via Drizzle's migrator — this is the
 * forward-looking migration machinery; the initial migration simply creates the clean
 * schema.
 *
 * The schema in ./schema.ts is the Drizzle source of truth (ADR-0008). Queries currently
 * run as hand-written SQL over the raw better-sqlite3 handle (getSqlite) during the
 * incremental migration off node:sqlite; a typed Drizzle query accessor will return when
 * the repository's queries are ported.
 */

import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const DB_PATH = path.join(process.cwd(), "db", "dev.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

const g = globalThis as unknown as { _sqlite?: Database.Database };

function init(): Database.Database {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Apply pending migrations once, using a transient Drizzle instance.
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS_DIR });
  return sqlite;
}

export function getSqlite(): Database.Database {
  if (!g._sqlite) g._sqlite = init();
  return g._sqlite;
}
