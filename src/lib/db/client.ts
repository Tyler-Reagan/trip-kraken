/**
 * Drizzle client — the single database connection and the migration runner (ADR-0008).
 *
 * better-sqlite3 is synchronous (the correct model for an in-process local DB). The
 * connection is a globalThis singleton so it survives Next.js hot reloads. Pending
 * migrations are applied on first init — this is the forward-looking migration
 * machinery; the initial migration simply creates the clean schema.
 */

import path from "path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const DB_PATH = path.join(process.cwd(), "db", "dev.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

type Db = BetterSQLite3Database<typeof schema>;

const g = globalThis as unknown as { _drizzleDb?: Db };

function init(): Db {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

export function getDb(): Db {
  if (!g._drizzleDb) g._drizzleDb = init();
  return g._drizzleDb;
}

export { schema };
