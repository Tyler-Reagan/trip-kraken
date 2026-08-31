/**
 * Local <-> Turso sync for one Trip at a time (ADR-0037 follow-up).
 *
 * Local `db/dev.db` is free to develop against; Turso is the deployed app's database. This does a
 * git-style three-way merge between them, field by field, using `db/.sync/<tripId>.json` as the
 * merge base — the last state both sides are known to have agreed on (the equivalent of a
 * remote-tracking ref). Diffing local and remote against that base, rather than against each
 * other, is what lets a field changed on only one side fast-forward silently, while the same field
 * changed on both sides to different values surfaces as a named conflict instead of one edit
 * silently overwriting the other. Deletes are handled the same way: a row missing from one side is
 * either a clean delete (the other side didn't touch it since base) or a real edit-vs-delete
 * conflict.
 *
 * A fresh id on both sides (no base entry) is treated as base = {} for every field, so add/add
 * degrades into the same per-field logic rather than needing its own case.
 *
 * Usage:
 *   tsx scripts/db-sync.ts status <tripId>
 *   tsx scripts/db-sync.ts sync <tripId> [--ours Table/id/field] [--theirs Table/id/field]...
 *
 * Conflicts print as `Table/id/field` triples (row-level edit-vs-delete conflicts use the literal
 * field name `__row__`). Resolve by rerunning `sync` with `--ours` (keep local's value) or
 * `--theirs` (keep Turso's value) for each one; rows with no conflict merge automatically either
 * way. Only rows that fully resolve this run get written or recorded in the base snapshot — a row
 * left in conflict is untouched on both sides and retried next run.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { trip, location, placement, journeyRoadKind } from "@/lib/db/schema";

type Row = Record<string, unknown>;
type Collection = Record<string, Row>; // id -> row
type Db = LibSQLDatabase<typeof schema>;
type AnyTable =
  typeof trip | typeof location | typeof placement | typeof journeyRoadKind;

const TABLE_LABELS = [
  "Trip",
  "Location",
  "Placement",
  "JourneyRoadKind",
] as const;
type TableLabel = (typeof TABLE_LABELS)[number];

const TABLES: { label: TableLabel; table: AnyTable }[] = [
  { label: "Trip", table: trip },
  { label: "Location", table: location },
  { label: "Placement", table: placement },
  { label: "JourneyRoadKind", table: journeyRoadKind },
];

const LOCAL_URL = `file:${path.join(process.cwd(), "db", "dev.db")}`;
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const SYNC_DIR = path.join(process.cwd(), "db", ".sync");

// Recomputed on every write, never meaningfully "edited" by a person — comparing it as a normal
// field would flag a conflict every time both sides happened to touch a row since the last sync.
const VOLATILE_FIELD = "updatedAt";
// Set once at insert and never changed again in practice; if it ever somehow differs, prefer
// whichever side has it, falling back to base.
const IMMUTABLE_FIELD = "createdAt";
const ROW_CONFLICT_FIELD = "__row__";

// ─── Connections ────────────────────────────────────────────────────────────

async function connectLocal(): Promise<Db> {
  const client = createClient({ url: LOCAL_URL });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

async function connectRemote(): Promise<Db> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set — db-sync needs both sides to diff against. Check .env.local (ADR-0037).",
    );
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  await client.execute("PRAGMA foreign_keys = ON");
  return drizzle(client, { schema });
}

// ─── Loading rows ───────────────────────────────────────────────────────────

function byId(rows: Row[]): Collection {
  const out: Collection = {};
  for (const row of rows) out[String(row.id)] = row;
  return out;
}

async function loadCollection(
  db: Db,
  label: TableLabel,
  tripId: string,
): Promise<Collection> {
  switch (label) {
    case "Trip": {
      const rows = await db.select().from(trip).where(eq(trip.id, tripId));
      return byId(rows);
    }
    case "Location":
      return byId(
        await db.select().from(location).where(eq(location.tripId, tripId)),
      );
    case "Placement":
      return byId(
        await db.select().from(placement).where(eq(placement.tripId, tripId)),
      );
    case "JourneyRoadKind":
      return byId(
        await db
          .select()
          .from(journeyRoadKind)
          .where(eq(journeyRoadKind.tripId, tripId)),
      );
  }
}

// ─── Base snapshot (the merge-base / "remote-tracking ref") ────────────────

type Snapshot = Partial<Record<TableLabel, Collection>>;

function baseSnapshotPath(tripId: string): string {
  return path.join(SYNC_DIR, `${tripId}.json`);
}

function loadBaseSnapshot(tripId: string): Snapshot {
  try {
    return JSON.parse(fs.readFileSync(baseSnapshotPath(tripId), "utf8"));
  } catch {
    return {};
  }
}

function saveBaseSnapshot(tripId: string, snapshot: Snapshot): void {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  fs.writeFileSync(baseSnapshotPath(tripId), JSON.stringify(snapshot, null, 2));
}

// ─── Value equality (deep, key-order independent — for JSON columns) ───────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function rowChangedIgnoringTimestamps(a: Row, b: Row): boolean {
  const fields = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const field of fields) {
    if (field === VOLATILE_FIELD || field === IMMUTABLE_FIELD) continue;
    if (!valuesEqual(a[field], b[field])) return true;
  }
  return false;
}

// ─── Conflict resolution flags ──────────────────────────────────────────────

type Resolution = {
  table: TableLabel;
  id: string;
  field: string;
  choice: "ours" | "theirs";
};

function findResolution(
  resolutions: Resolution[],
  table: TableLabel,
  id: string,
  field: string,
) {
  return resolutions.find(
    (r) => r.table === table && r.id === id && r.field === field,
  );
}

// ─── The merge ───────────────────────────────────────────────────────────

type FieldConflict = {
  table: TableLabel;
  id: string;
  field: string;
  base: unknown;
  local: unknown;
  remote: unknown;
};

type RowOutcome = {
  id: string;
  /** Final content, or null if the row should not exist after merging. Undefined when unresolved. */
  merged: Row | null | undefined;
  resolved: boolean;
  localChanges: boolean;
  remoteChanges: boolean;
  conflicts: FieldConflict[];
};

function mergeFields(
  table: TableLabel,
  id: string,
  base: Row,
  local: Row,
  remote: Row,
  resolutions: Resolution[],
): { merged: Row | undefined; conflicts: FieldConflict[] } {
  const fields = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
    ...Object.keys(base),
  ]);
  const merged: Row = { id };
  const conflicts: FieldConflict[] = [];

  for (const field of fields) {
    if (field === "id") continue;
    const b = base[field];
    const l = local[field];
    const r = remote[field];

    if (field === VOLATILE_FIELD) {
      merged[field] =
        new Date(String(l ?? 0)) >= new Date(String(r ?? 0)) ? l : r;
      continue;
    }
    if (field === IMMUTABLE_FIELD) {
      merged[field] = l ?? r ?? b;
      continue;
    }

    const localChanged = !valuesEqual(l, b);
    const remoteChanged = !valuesEqual(r, b);

    if (!localChanged && !remoteChanged) merged[field] = b;
    else if (localChanged && !remoteChanged) merged[field] = l;
    else if (!localChanged && remoteChanged) merged[field] = r;
    else if (valuesEqual(l, r))
      merged[field] = l; // both changed to the same value
    else {
      const resolution = findResolution(resolutions, table, id, field);
      if (resolution) {
        merged[field] = resolution.choice === "ours" ? l : r;
      } else {
        conflicts.push({ table, id, field, base: b, local: l, remote: r });
      }
    }
  }

  return { merged: conflicts.length === 0 ? merged : undefined, conflicts };
}

function mergeRow(
  table: TableLabel,
  id: string,
  base: Row | undefined,
  local: Row | undefined,
  remote: Row | undefined,
  resolutions: Resolution[],
): RowOutcome {
  const outcome = (
    merged: Row | null | undefined,
    conflicts: FieldConflict[] = [],
  ): RowOutcome => ({
    id,
    merged,
    resolved: merged !== undefined,
    localChanges: merged !== undefined && !valuesEqual(merged, local ?? null),
    remoteChanges: merged !== undefined && !valuesEqual(merged, remote ?? null),
    conflicts,
  });

  if (!local && !remote) return outcome(null);

  if (!base) {
    if (local && remote) {
      const { merged, conflicts } = mergeFields(
        table,
        id,
        {},
        local,
        remote,
        resolutions,
      );
      return outcome(merged, conflicts);
    }
    return outcome(local ?? remote ?? null); // plain add on one side
  }

  if (local && remote) {
    const { merged, conflicts } = mergeFields(
      table,
      id,
      base,
      local,
      remote,
      resolutions,
    );
    return outcome(merged, conflicts);
  }

  // Exactly one side has it, and base had a prior value: clean delete, or an edit-vs-delete conflict?
  const survivor = local ?? remote!;
  if (!rowChangedIgnoringTimestamps(survivor, base)) return outcome(null); // the delete wins cleanly

  const resolution = findResolution(resolutions, table, id, ROW_CONFLICT_FIELD);
  if (!resolution) {
    return outcome(undefined, [
      {
        table,
        id,
        field: ROW_CONFLICT_FIELD,
        base,
        local: local ?? null,
        remote: remote ?? null,
      },
    ]);
  }
  return outcome(
    resolution.choice === "ours" ? (local ?? null) : (remote ?? null),
  );
}

function mergeCollection(
  table: TableLabel,
  base: Collection,
  local: Collection,
  remote: Collection,
  resolutions: Resolution[],
): RowOutcome[] {
  const ids = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  return [...ids].map((id) =>
    mergeRow(table, id, base[id], local[id], remote[id], resolutions),
  );
}

// ─── Applying a resolved plan ───────────────────────────────────────────────

type Executor = Pick<Db, "insert" | "delete">;

async function upsertRow(
  db: Executor,
  table: AnyTable,
  row: Row,
): Promise<void> {
  const { id: _id, ...set } = row;
  const idColumn = (table as unknown as { id: never }).id;
  await db
    .insert(table as never)
    .values(row as never)
    .onConflictDoUpdate({ target: idColumn, set: set as never });
}

async function deleteRow(
  db: Executor,
  table: AnyTable,
  id: string,
): Promise<void> {
  const idColumn = (table as unknown as { id: never }).id;
  await db.delete(table as never).where(eq(idColumn, id as never));
}

async function applyPlan(
  db: Db,
  plan: Record<TableLabel, RowOutcome[]>,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const { label, table } of [...TABLES].reverse()) {
      for (const row of plan[label]) {
        if (row.resolved && row.merged === null)
          await deleteRow(tx, table, row.id);
      }
    }
    for (const { label, table } of TABLES) {
      for (const row of plan[label]) {
        if (row.resolved && row.merged !== null && row.merged !== undefined) {
          await upsertRow(tx, table, row.merged);
        }
      }
    }
  });
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function printReport(
  plan: Record<TableLabel, RowOutcome[]>,
  dryRun: boolean,
): boolean {
  let anyChange = false;
  let anyConflict = false;

  for (const { label } of TABLES) {
    const rows = plan[label].filter(
      (r) => r.localChanges || r.remoteChanges || r.conflicts.length > 0,
    );
    if (rows.length === 0) continue;

    console.log(`\n${label}:`);
    for (const row of rows) {
      if (row.conflicts.length > 0) {
        anyConflict = true;
        for (const c of row.conflicts) {
          console.log(
            `  CONFLICT  ${label}/${c.id}/${c.field}` +
              (c.field === ROW_CONFLICT_FIELD
                ? `  (edited on one side, deleted on the other)`
                : `  local=${JSON.stringify(c.local)}  turso=${JSON.stringify(c.remote)}`),
          );
        }
        continue;
      }
      anyChange = true;
      const arrow =
        row.merged === null
          ? "delete"
          : row.localChanges && row.remoteChanges
            ? "merge "
            : row.remoteChanges
              ? "push  "
              : "pull  ";
      console.log(`  ${arrow}  ${label}/${row.id}`);
    }
  }

  if (!anyChange && !anyConflict)
    console.log("\nNothing to sync — local and Turso already agree.");
  else if (dryRun)
    console.log(
      "\n(status only — nothing written; rerun with `sync` to apply)",
    );

  return anyConflict;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const [cmd, tripId, ...rest] = argv;
  if ((cmd !== "status" && cmd !== "sync") || !tripId) {
    console.error(
      "Usage: tsx scripts/db-sync.ts <status|sync> <tripId> [--ours Table/id/field] [--theirs Table/id/field]...",
    );
    process.exit(1);
  }
  const resolutions: Resolution[] = [];
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag !== "--ours" && flag !== "--theirs")
      throw new Error(`Unrecognized argument "${flag}"`);
    const choice = flag === "--ours" ? "ours" : "theirs";
    const spec = rest[++i];
    const [table, id, field] = (spec ?? "").split("/");
    if (
      !table ||
      !id ||
      !field ||
      !TABLE_LABELS.includes(table as TableLabel)
    ) {
      throw new Error(
        `Bad --${choice} spec "${spec}" — expected Table/id/field, e.g. Location/loc_42/note`,
      );
    }
    resolutions.push({ table: table as TableLabel, id, field, choice });
  }
  return { cmd, tripId, resolutions };
}

async function main() {
  const { cmd, tripId, resolutions } = parseArgs(process.argv.slice(2));

  const local = await connectLocal();
  const remote = await connectRemote();
  const base = loadBaseSnapshot(tripId);

  const plan = {} as Record<TableLabel, RowOutcome[]>;
  for (const { label } of TABLES) {
    const [localRows, remoteRows] = await Promise.all([
      loadCollection(local, label, tripId),
      loadCollection(remote, label, tripId),
    ]);
    plan[label] = mergeCollection(
      label,
      base[label] ?? {},
      localRows,
      remoteRows,
      resolutions,
    );
  }

  if (cmd === "status") {
    printReport(plan, true);
    return;
  }

  const hasConflicts = printReport(plan, false);

  const nextBase: Snapshot = structuredClone(base);
  for (const { label } of TABLES) {
    const table = (nextBase[label] ??= {});
    for (const row of plan[label]) {
      if (!row.resolved) continue; // leave unresolved rows' base entry untouched — retried next run
      if (row.merged === null) delete table[row.id];
      else if (row.merged !== undefined) table[row.id] = row.merged;
    }
  }

  await applyPlan(local, plan);
  await applyPlan(remote, plan);
  saveBaseSnapshot(tripId, nextBase);

  if (hasConflicts) {
    console.log(
      `\n${Object.values(plan)
        .flat()
        .reduce(
          (n, r) => n + r.conflicts.length,
          0,
        )} conflict(s) remain — resolve with --ours/--theirs and rerun.`,
    );
    process.exit(1);
  }
  console.log("\nSynced.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
