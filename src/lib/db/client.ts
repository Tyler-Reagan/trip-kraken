/**
 * Database client — the single connection and the migration runner (ADR-0008).
 *
 * better-sqlite3 is synchronous (the correct model for an in-process local DB). One
 * connection is shared and stored on globalThis so it survives Next.js hot reloads.
 * Pending migrations are applied on first init via Drizzle's migrator — this is the
 * forward-looking migration machinery; the initial migration simply creates the clean
 * schema.
 *
 * Two surfaces over the same connection:
 *   - getDrizzle(): the typed Drizzle layer (the ADR-0008 data-access boundary) used by
 *     the repository in ./index.ts.
 *   - getSqlite():  the raw better-sqlite3 handle, still used by route handlers whose
 *     hand-written SQL has not yet been moved into the repository (tracked follow-up).
 */

import path from "path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const DB_PATH = path.join(process.cwd(), "db", "dev.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

type Drizzle = BetterSQLite3Database<typeof schema>;

const g = globalThis as unknown as { _sqlite?: Database.Database; _drizzle?: Drizzle };

function init(): void {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  g._sqlite = sqlite;
  g._drizzle = db;
}

export function getDrizzle(): Drizzle {
  if (!g._drizzle) init();
  return g._drizzle!;
}

export function getSqlite(): Database.Database {
  if (!g._sqlite) init();
  return g._sqlite!;
}
