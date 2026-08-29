# ADR-0037: Hosting goes live — Fly.io (scale-to-zero) for VROOM/OSRM, Turso for the database, a middleware password gate

- **Status:** Accepted
- **Date:** 2026-08-28
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0025 — resolves the three items its "what would have to be true to host this"
  list left open (an auth layer, a durable database, a container host for VROOM/OSRM), and settles
  §1's "container hosting is deliberately undecided" now that hosting is real. ADR-0025 named this
  moment itself: "This ADR is where a reversal starts. When hosting becomes real, the 'what would
  have to be true' list is the agenda."
- **Constrained by:** ADR-0024 (OSRM stays the self-hosted road Facts source — **not reopened by
  this ADR**; see Alternatives), ADR-0025 (the app is a BFF over HTTP services; VROOM and OSRM are
  upstream services reachable by URL, not co-located)
- **Note:** Reached via `docs/research/private-deployment-options.md` (a research pass covering all
  four pieces below with primary-source citations) and a follow-up question — could a persistent
  paid host be avoided entirely? — that revisited ADR-0024's 2026-08-10 amendment and confirmed its
  finding still holds: VROOM has no hosted equivalent, so dropping OSRM alone does not remove the
  need for a persistent host.

## Context

ADR-0025 was written when there were no users, and said so plainly: "today the answer is 'the
developer's machine, because there are no users.'" That has changed — the goal now is a small
number of known people, not the developer alone, able to reach the app from their own machines.
This is a **personal convenience deployment**, not a product launch: 1-2 trusted people, not a
public user base. That scope constrains every choice below, and a future reader scaling past it
should treat this ADR as a starting point, not a ceiling.

ADR-0025 already established the shape that survives this: the app is a BFF over HTTP services;
VROOM and OSRM are two more upstream services like Google, reachable by configured URL; nothing
about them requires co-location with the Next.js app. What it left genuinely open was *where* those
services run, and two things it named as blocking any hosting at all: no auth layer, and SQLite
living on the app's own disk.

The research this ADR is built on considered a fourth question first: could self-hosting be
avoided entirely, removing the need for a persistent host at all? ADR-0024's 2026-08-10 amendment
already ran that experiment for OSRM specifically — hosted OpenRouteService was added as a
provider, then removed — and its reasoning generalizes further than that amendment stated: **"it
removes road self-hosting, not self-hosting"** — VROOM remains a container regardless of what
answers road queries, and VROOM has no hosted equivalent to swap in. Getting off a persistent host
entirely would require both reopening that OSRM decision *and* re-architecting VROOM to run
on-demand outside a container (a Vercel Sandbox invocation of the solver binary, say) — real,
unproven engineering, disproportionate to a two-person convenience tool. That path is not ruled
out permanently; it is deferred as not worth its cost today.

## Decision

**We will host the app on Vercel, run VROOM and OSRM on Fly.io using scale-to-zero Machines, move
the database to Turso, and gate access with a custom password-check middleware.**

1. **VROOM + OSRM run on Fly.io, unchanged in shape.** `docker-compose.yml` carries over via Fly's
   native Compose import rather than being rewritten for a platform-specific format — same
   containers, same `--mmap` OSRM invocation, same graph. The one asterisk: Fly's compose importer
   is unconfirmed against VROOM's remote git-context build
   (`build: https://github.com/VROOM-Project/vroom-docker.git`) specifically. If it doesn't resolve
   that, the fallback is guaranteed to work regardless: clone the pinned `v1.15.0` tag and point
   `fly deploy` at that directory directly.
2. **Fly Machines auto-stop and auto-start**, so the app pays for the ~15GB volume plus actual
   compute time rather than a flat 24/7 VPS bill. This is the entire reason Fly was chosen over a
   plain VPS (Hetzner, researched as the zero-adaptation alternative) — same architecture, a cost
   model that fits "used occasionally by two people" instead of "always on."
3. **The database moves from local SQLite (`better-sqlite3`, `db/dev.db`) to Turso/libSQL.** This
   is a small swap, not a rewrite: `src/lib/db/schema.ts`'s `sqliteTable` definitions are untouched
   because libSQL is the same dialect family Drizzle already speaks against. Only
   `drizzle.config.ts` (`dialect`, `dbCredentials`) and `src/lib/db/client.ts`'s driver import
   (`drizzle-orm/better-sqlite3` → `drizzle-orm/libsql`) change.
4. **Access is gated by a custom Next.js middleware password check** — a shared password against
   an env var, a signed cookie on success — not Vercel's Password Protection add-on or a
   third-party auth provider. Sized deliberately to "1-2 known people," not a real user base.
5. **The app itself stays on Vercel**, exactly as before. Nothing about this ADR touches that half.

## Alternatives considered

- **Hetzner (plain VPS)**, the zero-adaptation option the research surfaced: `docker-compose.yml`
  runs on it completely unchanged, no compose-import uncertainty at all. Rejected on cost alone,
  not shape — a VPS bills for 24/7 uptime a two-person, occasional-use tool doesn't need. This
  stays the fallback if Fly's compose import or scale-to-zero behavior turns out not to work as
  expected.
- **Dropping OSRM self-hosting for hosted ORS, and re-architecting VROOM to run on-demand outside
  a container.** The only path to genuinely $0 infrastructure. Rejected for now: it reopens
  ADR-0024's already-settled reasoning (ORS's CC-BY-SA license on results, the two-request tiling
  loop `osrm-viability-149.md` deliberately deleted, an availability dependency with no paid
  escalation tier) and requires unproven engineering — running VROOM's solver binary inside
  something like Vercel Sandbox has no precedent in this codebase. Disproportionate effort for the
  cost it saves at this scale.
- **Vercel Password Protection.** Requires Pro plus a **$150/month** add-on with a 30-day minimum
  to cover the production domain — wildly disproportionate to gating access for two known people.
- **Clerk (Vercel Marketplace).** Free at this scale and would have been reasonable, but adds a
  third-party account-creation step for two people who don't need managed identity — the custom
  gate is simpler and sufficient for "does this person know the password," which is the actual
  requirement.
- **Neon or Supabase (Postgres, Vercel Marketplace).** Rejected in favor of Turso: moving to
  Postgres is a real query-layer rewrite (`pgTable` replaces `sqliteTable`, native boolean/`jsonb`
  types replace SQLite's `integer`/text-mode casts, `now()` replaces
  `sql`(datetime('now'))``), where Turso's libSQL dialect keeps the schema file and most of the
  client code as-is.

## Consequences

- **ADR-0025's "what would have to be true" list is now fully settled**: auth exists (the
  middleware gate), the database is durable and reachable from Vercel (Turso), and a container
  host is chosen (Fly.io). §1's "container hosting is deliberately undecided" no longer describes
  this project.
- **ADR-0024 is unchanged.** OSRM stays the self-hosted primary road Facts source; this ADR settles
  only *where* it runs, not *whether* it does.
- **This is scoped hosting, not production hosting.** The password gate has no rate limiting, no
  per-user accounts, and no audit trail; Fly's scale-to-zero means the first request after idle
  pays a cold-start cost. Both are acceptable for two trusted people and would need revisiting
  before this became a real product — a future reader finding those gaps should read them as
  deliberate for this scope, not oversights, but also not permanent.
- **Follow-on work, not yet done:** a `fly.toml` (or confirmed working Compose import) for the
  VROOM/OSRM services, the Turso account and schema migration, `src/proxy.ts` for the password
  gate, and updated environment documentation. README's framing — "nothing here is Vercel-shaped,
  and that is a deliberate, recorded posture" — needs a follow-up edit once this ships, since the
  app itself now *is* Vercel-shaped even though VROOM/OSRM still aren't functions.
- **The graph-transfer story is unchanged in mechanism, only destination.** `scripts/build-osrm-graphs.sh`
  and `scripts/transfer-osrm-graphs.sh` still produce and unpack the same `.tar.zst`; only the
  target (a Fly Volume rather than a second laptop) changes.
