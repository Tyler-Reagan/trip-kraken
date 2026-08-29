/**
 * Database client — the single connection and the migration runner (ADR-0008, moved to
 * Turso/libSQL by ADR-0037).
 *
 * libSQL's client is Promise-based even against a local file (unlike better-sqlite3, which was
 * synchronous) — that's the real cost of this move, not the driver swap itself: every query in
 * ./index.ts and every one of its callers gained `await`. `TURSO_DATABASE_URL` selects a remote
 * Turso database (production, per ADR-0037); leaving it unset falls back to a local `db/dev.db`
 * file, so local dev never needs network access. One connection is shared and stored on
 * globalThis so it survives Next.js hot reloads. Pending migrations are applied on first init via
 * Drizzle's migrator.
 *
 * getDrizzle() is the only data-access surface: all persistence goes through the typed Drizzle
 * layer in ./index.ts. There is no raw SQL handle exposed.
 */

import path from "path";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

const LOCAL_DB_URL = `file:${path.join(process.cwd(), "db", "dev.db")}`;
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

export type Drizzle = LibSQLDatabase<typeof schema>;

const g = globalThis as unknown as { _drizzle?: Promise<Drizzle> };

async function init(): Promise<Drizzle> {
  const url = process.env.TURSO_DATABASE_URL ?? LOCAL_DB_URL;
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  // WAL mode is a local-file pragma; a remote Turso connection manages its own storage and has
  // nothing to set here.
  if (url.startsWith("file:")) await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");

  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

export function getDrizzle(): Promise<Drizzle> {
  if (!g._drizzle) g._drizzle = init();
  return g._drizzle;
}
