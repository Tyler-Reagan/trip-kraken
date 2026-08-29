# Private deployment options: password gate, container hosting, graph transfer, and a durable database

- **Answers:** ADR-0025's "What would have to be true to host this" list — an auth layer, a durable
  database, and a container host for VROOM/OSRM. This doc researches options for all three, plus how
  the existing graph-transfer scripts map onto each container host.
- **Date:** 2026-08-28
- **Status:** Research findings. Not an ADR, and not a recommendation — trade-offs only. The choice
  among these options is a human decision this doc feeds, not one it makes.
- **Scope:** Four questions, independently researchable: (1) password-gating a Vercel deployment for
  a small trusted group, (2) a persistent container host for VROOM + OSRM, (3) getting the existing
  ~6.4GB `osrm-graphs-*.tar.zst` artifact onto that host, (4) replacing SQLite with something Vercel's
  serverless functions can reach.
- **Sources read at:** 2026-08-28. Vercel docs pages carry a `last_updated: 2026-08-21` stamp;
  Clerk, Turso, Neon, Supabase, Railway, Render, Fly.io, and Hetzner pricing pages were fetched live
  on the date above and reflect whatever they showed then — all of these change without notice, and
  this doc is not a substitute for re-checking before committing spend.

---

## 1. Password-gating a Vercel deployment for a small private group

Three shapes, compared on what they actually gate and what they cost.

| | Applies to production domain? | Free tier? | Who can unlock |
| --- | --- | --- | --- |
| **(a) Vercel Password Protection** | Only with "All Deployments" scope | No — Enterprise, or Pro + $150/mo add-on | Anyone with the password |
| **(a) Vercel Authentication (SSO)** | Only with "All Deployments" scope, which needs Pro/Enterprise | Yes, but only protects preview/generated URLs on Hobby | Only people with Vercel accounts and access to the team |
| **(b) Custom middleware password gate** | Yes, by construction | Yes ($0, uses whatever plan the app already needs) | Anyone with the password |
| **(c) Clerk via Vercel Marketplace** | Yes, by construction | Yes, 50,000 MRUs free | Anyone with a Clerk account you invite |

### (a) Vercel's built-in Deployment Protection

Vercel's own docs are explicit that the free tier does not cover what this project needs. The
[Deployment Protection overview](https://vercel.com/docs/deployment-protection) states plainly:
"On the Hobby plan, Vercel Authentication with Standard Protection is available. This protects your
preview deployments and deployment URLs, but your production domain remains publicly accessible. To
protect production domains, you need a Pro or Enterprise plan." Password Protection is listed
separately as "**Available on the Enterprise plan, or as a paid add-on for Pro plans**," and the
**scope** that reaches the production domain — "All Deployments" — is itself gated to "Pro and
Enterprise plans."

The paid path, from the same page:

> Advanced Deployment Protection features are available to Enterprise customers by default. Pro plan
> customers can access these features for an additional **$150 per month**: Password Protection,
> Private Production Deployments, Deployment Protection Exceptions.
>
> When you enable Advanced Deployment Protection, you pay $150 per month for the add-on and gain
> access to *all* Advanced Deployment Protection features. … You must have used the feature for a
> minimum of 30 days before you can disable it.

So the actual cost of "password on the production domain, official feature" is **Pro ($20/mo) +
$150/mo add-on = $170/mo**, with a 30-day minimum commitment once enabled. Vercel Authentication
(SSO), by contrast, is "**Available on all plans**" but only ever restricts access to people who are
themselves logged into Vercel with access to the team — it isn't a shareable password, it's an
allowlist of Vercel accounts, which doesn't fit "a small trusted group" unless every member of that
group already has (or is willing to create) a Vercel account and gets added to the team.

**UX, for the parts that are eligible:** password protection's own page
([password-protection docs](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection))
describes the unlock flow: a visitor hits a password screen, enters the password once, and "a cookie
is set in your browser for that deployment URL so you don't need to enter the password again." The
cookie is scoped per deployment URL (a JWT valid only for the URL it was issued for) and persists
until the password is changed, at which point "Users must re-enter a new password if you change the
existing one." There is no configurable expiry — it is "once per deployment, or when the password
changes," not a rolling session length.

### (b) Custom Next.js middleware gate

Not Vercel-specific — a `middleware.ts` that checks a submitted password against `process.env.SITE_PASSWORD`
and, on match, sets a signed cookie the middleware then trusts on subsequent requests, redirecting to
a login page otherwise. This is the mechanism Vercel's own docs point Hobby-plan users toward:
[Password Protection's related links](https://vercel.com/kb/guide/how-do-i-add-password-protection-to-my-vercel-deployment)
lists a "Next.js Basic Auth middleware template for a password gate without a Vercel account" as the
free alternative when Vercel's official feature isn't affordable. Cost is $0 beyond whatever Vercel
plan the app already needs (Hobby is fine for a private, low-traffic deployment). The trade-off is
that it's homegrown: no built-in shareable-link mechanism, no automation-bypass header for CI, and
the security properties (cookie signing, timing-safe password comparison, rate limiting) are the
project's responsibility rather than a platform guarantee.

### (c) Clerk via the Vercel Marketplace

[Clerk's pricing page](https://clerk.com/pricing) puts the free tier at **$0/month for up to 50,000
MRUs** (Monthly *Retained* Users — a user counts only if they return after 24 hours, so a handful of
known trip-planning users is nowhere near the ceiling), including "unlimited applications" and basic
sign-up/sign-in/user-profile features. Installing it through Vercel
([vercel.com/marketplace/clerk](https://vercel.com/marketplace/clerk)) offers two paths — "Create New
Clerk Account," which provisions one automatically and bills through Vercel, or "Link Existing Clerk
Account" for billing managed separately through Clerk directly — plus a CLI one-liner (`vc i clerk`)
and a ready-made Next.js App Router starter template. Setup cost is low (an afternoon: install,
middleware, sign-in page, invite the known users) and ongoing friction is close to zero at this scale
— free tier, no seat limits mentioned for end users (only "3 dashboard seats" for the team managing
it). The trade-off against (b) is a third-party dependency and an account-creation step for each
trusted user, in exchange for a maintained auth UI, session handling, and no homegrown crypto.

---

## 2. Persistent container hosting for VROOM + OSRM

The compose file has an asymmetry worth naming up front: **only `vroom` builds from source** (the git
context pinned to `v1.15.0`); both `osrm-car` and `osrm-foot` run the same pre-published
`ghcr.io/project-osrm/osrm-backend:26.4.1-debian` image, unmodified, with a mounted volume and a
`--mmap` command override. That halves the real requirement — most hosts handle "pull a public image
and mount a volume" without any friction; the git-context build is the one thing to check per host.

| | Builds from remote git context? | Persistent volume for the graphs? | Compose-shaped multi-service? | Rough monthly cost, low traffic |
| --- | --- | --- | --- | --- |
| **Fly.io** | Compose spec supports it (`build: https://…git#tag`); Fly's own compose importer says existing files deploy "without rewriting," but this project did not test the git-context path specifically | Yes — Fly Volumes, up to 500GB, $0.15/GB/mo | Yes, native Compose import (`[build.compose]`, flyctl ≥0.3.152) — and it fits Fly's "exactly one service may `build`" rule already | ~$20–25/mo (3 machines + ~15GB volume) |
| **Railway** | No native remote-git-context support found; needs a fork or a local clone + `railway up` | Yes, but capped **5GB on Hobby** — the ~15GB serving set needs the Pro tier's 50GB cap | Partial — Compose files can be dragged onto the project canvas, but "we don't support every possible Compose config just yet" | Hobby minimum $5/mo, but the volume cap forces Pro (~$20/mo/seat) before usage; usage itself (~$20/vCPU + $10/GB RAM per month) likely adds $15–30/mo on top |
| **Render** | Yes — "Public Git Repository" deploy accepts a bare repo URL with no fork and no GitHub App install, at the cost of losing auto-deploy-on-push (fine for a pinned release) | Yes — persistent Disks, attachable to Docker/private services; size limit and price not published on the pages read | No native Compose import — `render.yaml` Blueprints are the declarative equivalent, but each service is hand-translated | 3 services at Starter ($7/mo, 512MB/0.5vCPU) ≈ $21/mo, plus unverified disk cost |
| **Hetzner (plain VPS)** | Trivially yes — it's a Linux box; `docker compose up -d` runs the existing `docker-compose.yml` verbatim | Yes, two ways: Hetzner Cloud Volumes (10GB–10TB, ~€0.057/GB/mo per a secondary source — Hetzner's own pricing pages are client-rendered and would not return text to a fetch) or just the boot disk, since a CX33/CPX31-class box already ships 80–160GB NVMe | Yes — it's the same compose file, no translation | CPX31 (4 vCPU/8GB/160GB NVMe) ~€16.49–18.59/mo; CPX41 (8 vCPU/16GB/240GB) ~€30.49–34.09/mo |

Detail behind each row:

**Fly.io.** [`fly.toml` reference](https://fly.io/docs/reference/configuration/) documents
`[build.args]` for build-time arguments (covers `VROOM_RELEASE`) and a `dockerfile` field that
"accepts a relative path to a Dockerfile, or a URL," but that URL is for the Dockerfile itself, not
a full git build context. The separate, newer path is Compose support: the
[multi-container Machines guide](https://fly.io/docs/machines/guides-examples/multi-container-machines/)
states "If you already have a Docker Compose setup, you can deploy it to Fly Machines without
rewriting your configuration," via a `[build.compose]` block that auto-detects the standard compose
filename, requires flyctl ≥0.3.152, and explicitly permits "exactly one service … to specify `build`"
— which matches this project's shape (`vroom` builds, the two OSRM services don't) rather than
fighting it. What is *not* confirmed from Fly's own docs is whether that compose importer resolves a
`build.context` that is itself a remote git URL (the Compose spec allows this —
[Docker's compose-file build reference](https://docs.docker.com/reference/compose-file/build/) shows
`build: https://github.com/mycompany/example.git#branch_or_tag:subdirectory` as valid syntax) or
whether it only handles local Dockerfile paths within the repo Fly builds from. The safe fallback
that sidesteps the question entirely: `git clone` the pinned `vroom-docker` tag in CI or locally and
point `fly deploy` at that directory directly, which is guaranteed to work regardless. Fly Volumes
are local NVMe tied 1:1 to one Machine (["a volume can be attached to only one Machine"](https://fly.io/docs/volumes/overview/)),
sized 1GB default up to 500GB, at "$0.15/GB per month of provisioned capacity"
([pricing](https://fly.io/docs/about/pricing/)). Compute is metered per-second; a
`shared-cpu-1x`/1GB machine runs roughly $5.92/mo, a `shared-cpu-2x`/2GB roughly $11.83/mo (both
figures region-dependent, quoted for Amsterdam).

**Railway.** [Dockerfile build docs](https://docs.railway.com/guides/dockerfiles) confirm `ARG`-based
build args work; nothing in the docs read describes deploying directly from a git URL you don't own.
Search of Railway's own community/help content confirms the practical answer: the repo picker only
shows repos the Railway GitHub App has access to, so a repo you don't own needs either forking or
`railway up` from a local clone. [Volumes docs](https://docs.railway.com/reference/volumes) give the
size ceiling by plan — 0.5GB (Free), **5GB (Hobby)**, 50GB (Pro) — which matters here because the
built OSRM serving set is ~15GB (README: "~15 GB of disk once built"); Hobby's cap does not fit, so
this option is really "Pro or nothing." [Compose import](https://docs.railway.com/guides/build-configuration)
and community docs describe drag-and-drop `.yml` import onto the project canvas with the caveat that
not every compose construct is supported — untested here whether the `x-osrm` YAML anchor and a
git-context `build.context` both survive that importer.

**Render.** [Docker build docs](https://render.com/docs/docker) confirm Dockerfile path and build-arg
support. The load-bearing finding is the **Public Git Repository** deploy path — Render's own
docs and community answers describe pasting a repository URL directly (no fork, no GitHub App
install) to create a service from any public repo, including one you don't own, at the cost of
losing auto-deploy-on-push (acceptable, since the compose file already pins `VROOM_RELEASE` rather
than tracking a moving branch). [Disks docs](https://render.com/docs/disks) confirm disks attach to
Docker services at a mount path and describe two seeding paths — SSH + `scp`, or the `magic-wormhole`
CLI tool preinstalled on native runtimes — but neither a size ceiling nor a per-GB price was present
on the pages read; that gap is called out in *What I could not verify* below. There is no native
docker-compose importer analogous to Railway's — Render's own multi-service primitive is a
declarative `render.yaml` Blueprint, which would need the three services hand-authored rather than
translated automatically.

**Hetzner (plain VPS).** The only option that needs no adaptation of any kind: `docker-compose.yml`
already builds VROOM from its git context and runs both OSRM containers with `--mmap` against a
mounted host path, and a Hetzner Cloud server is just a Linux box running Docker — the exact command
in the README (`docker compose up -d`) applies unchanged.
[Cloud Volumes docs](https://docs.hetzner.com/cloud/volumes/faq/) confirm 10GB–10TB sizing, up to 16
volumes per server, and both automatic and manual mount/format flows, but carry no price; a search
result citing Hetzner's own block-storage page put the current rate at "€0.0572/GB/month" (raised
from €0.044 "from April 1") — this project could not independently re-fetch that number because
Hetzner's pricing pages render client-side and returned no usable text to a direct fetch, so treat it
as a secondary citation, not a primary one. Server pricing for CPX31/CPX41 (both AMD, shared vCPU)
came from the same indirect path for the same reason. Given the graph's ~15GB fits inside a
CPX31/CX33-class box's own boot disk (80–160GB NVMe, per Hetzner's cost-optimized lineup), a separate
Volume may not even be necessary — the boot disk alone likely suffices, which removes one moving part
entirely relative to every other option in this table.

---

## 3. Seeding the OSRM graph artifact onto each host's volume

`scripts/transfer-osrm-graphs.sh` already does the packing (`tar | zstd` down to ~6.4GB) and unpacking
(`zstd -dc | tar -x`) halves of this problem; what's host-specific is only the transport step between
"artifact on a laptop" and "artifact on the host's disk." Ranked by how little new tooling each needs:

1. **Hetzner — no new tooling.** `scp` (or `rsync`) the existing `.tar.zst` straight to the box, run
   the existing `scripts/transfer-osrm-graphs.sh unpack` command on it exactly as documented today for
   moving between two machines. This is the literal workflow the script's own header already
   describes ("Copy $OUT to the target machine, then run… — this script doesn't care how"), just
   pointed at a cloud box instead of a second laptop.
2. **Render — close second.** [Disks docs](https://render.com/docs/disks) document SSH + `scp` access
   directly, plus `magic-wormhole` as a no-SSH-setup alternative — either lands the `.tar.zst` on the
   box, after which the same unpack script runs over SSH. New tooling needed: enabling SSH access on
   the service (documented, one-time).
3. **Fly.io — some new tooling.** No documented direct laptop→volume `scp`; the standard pattern is
   `fly ssh console` for an interactive shell on a Machine with the volume mounted, which can pull the
   artifact from a URL (an S3/R2/Blob bucket the pack step would need to upload to first) or accept a
   file over `fly ssh sftp` if the running image has an SFTP-capable shell. Either way this adds a
   step the current script doesn't have — an object-storage hop, or scripting an SFTP put — rather
   than reusing `scp` verbatim.
4. **Railway — the most new tooling.** [Volumes docs](https://docs.railway.com/reference/volumes)
   state plainly there is "no built-in S/FTP support"; the documented access path is
   `railway volume browse` / `railway volume files` from the CLI, whose transfer semantics for a
   single ~15GB unpacked payload are unconfirmed from the docs read. The likely-safe pattern here is
   the one enterprise convention Railway's own docs gesture toward generally: stage the `.tar.zst` in
   object storage (e.g., an R2/S3 bucket) and have a one-shot init step on first boot `curl` it down
   and unpack — which is exactly the "object-storage bootstrap" shape the research brief asked about,
   and the one genuinely new piece of infrastructure among these four options.

None of the four requires rewriting `build-osrm-graphs.sh` or the pack half of
`transfer-osrm-graphs.sh` — the packed artifact is identical regardless of destination. What differs
is only the last mile, and only Railway plausibly needs a bootstrap script that doesn't exist today.

---

## 4. Replacing SQLite with something reachable from Vercel's serverless functions

**The README is stale.** It states the tech stack as "SQLite via `node:sqlite` (built-in, no
Prisma)," but `package.json` lists both `better-sqlite3` (`^13.0.3`) and `drizzle-orm` (`^0.45.2`) —
plus `drizzle-kit` as a dev dependency — as real, non-optional dependencies, and
`src/lib/db/client.ts` confirms Drizzle is fully wired up, not merely installed:

```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
...
const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: MIGRATIONS_DIR });
```

`getDrizzle()` is documented in that same file as "the only data-access surface: all persistence goes
through the typed Drizzle layer." `src/lib/db/schema.ts` uses `drizzle-orm/sqlite-core`'s
`sqliteTable`/`text`/`integer`/`real` throughout, and `drizzle.config.ts` targets
`dialect: "sqlite"` against `./db/dev.db`. So the actual stack is drizzle-orm-over-better-sqlite3, not
raw `node:sqlite` — worth a README fix independent of any deployment decision, since anyone reading
the Tech Stack table today would look for the wrong client entirely.

That existing shape is what makes the two replacement options asymmetric:

| | Query-layer rewrite | Free-tier ceiling | Primary source |
| --- | --- | --- | --- |
| **Turso / libSQL** | Small — same `sqlite-core` schema, same dialect family | 5GB storage, 500M rows read/mo, 10M rows written/mo, 100 databases | [Turso pricing](https://turso.tech/pricing) |
| **Neon (Vercel Marketplace Postgres)** | Larger — `pgTable` replaces `sqliteTable`, column types and boolean/JSON handling change, driver swaps to `node-postgres`/`postgres.js` | 0.5GB storage/project, 100 CU-hours/project, 10 branches, 100 projects | [Neon pricing](https://neon.com/pricing) |
| **Supabase (Vercel Marketplace Postgres)** | Same Postgres rewrite as Neon | 500MB storage, 2 active projects, auto-pauses after 1 week idle | [Supabase pricing](https://supabase.com/pricing) |

**Turso/libSQL keeps the schema file untouched.** Drizzle's own
[Turso getting-started guide](https://orm.drizzle.team/docs/get-started/turso-new) shows the
`drizzle.config.ts` delta plainly:

```ts
export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
```

— only `dialect` and `dbCredentials` change (`"sqlite"` → `"turso"`, a file path → a URL + auth
token); `schema.ts`'s `sqliteTable` definitions are untouched because libSQL *is* the SQLite dialect
family. The runtime side changes similarly little: `drizzle-orm/better-sqlite3` and its migrator
become `drizzle-orm/libsql`, the `new Database(DB_PATH)` construction becomes a `{ connection: { url,
authToken } }` object, and the `better-sqlite3` package is removed in favor of `@libsql/client`. No
change to any query in `src/lib/db/index.ts` is implied by this swap on its face, though every query
would still need to be re-verified against libSQL's actual behavior (e.g., WAL-mode pragmas set in
`client.ts` today are SQLite-file-specific and would need re-examination for a remote libSQL target).

**Postgres is a real query-layer rewrite, not a driver swap.** Moving to Neon or Supabase means
`drizzle-orm/pg-core`'s `pgTable` replaces `sqlite-core`'s `sqliteTable` across `schema.ts`, and
Postgres's type system diverges from SQLite's in ways the current schema leans on: SQLite has no
native boolean (the schema uses `integer(..., { mode: "boolean" })` for `transitCaveatDismissed` and
`hasJrPass` — Postgres has a real `boolean` type instead), SQLite's JSON columns are stored as text
with a `mode: "json"` cast (`dayLabels`) where Postgres has a native `jsonb` type, and the
`sql\`(datetime('now'))\`` default used for `createdAt`/`updatedAt` is SQLite syntax that becomes
Postgres's `now()`. Drizzle's own docs structure reflects this as a real split rather than a
compatibility shim: [PostgreSQL data types](https://orm.drizzle.team/docs/column-types) and
SQLite's are documented as separate systems, and connection setup ([Postgres getting-started](https://orm.drizzle.team/docs/get-started-postgresql))
requires picking between `node-postgres` and `postgres.js` drivers, each with its own caveats (e.g.
"postgres.js uses prepared statements by default, which you may need to opt out of" in some
serverless environments) that the current single-driver `better-sqlite3` setup has no equivalent of.

Both Neon and Supabase provision through `vercel install neon` / `vercel install supabase` per
Vercel's own [getting-started docs](https://vercel.com/docs/getting-started-with-vercel), which list
storage integrations as a one-command install with billing that flows through Vercel when a new
account is created via the integration
([marketplace/neon](https://vercel.com/marketplace/neon)). Neon's free tier —
[Neon pricing](https://neon.com/pricing) — is 0.5GB storage and 100 CU-hours per project, not
paused, versus Supabase's 500MB storage but with projects "paused after 1 week of inactivity" on the
free tier ([Supabase pricing](https://supabase.com/pricing)), which is a meaningfully worse fit for a
low-traffic personal deployment that might sit unused for stretches — a paused Supabase project needs
a manual or first-request unpause, where Neon's free tier has no such gate at these limits.

---

## What I could not verify

- **Whether Fly's `[build.compose]` importer resolves a remote git-URL `build.context`
  specifically**, as opposed to only local Dockerfile paths within the repo it's given. The Compose
  spec permits it and Fly's own docs say an existing compose file deploys "without rewriting," which
  reads as though it should work, but no primary-source example shows a git-context service
  specifically, and this was not tested against a live Fly project. The always-works fallback (clone
  the pinned tag, deploy from that directory) does not depend on the answer.
- **Render's Disk size ceiling and per-GB price.** The Disks docs describe attachment and seeding
  mechanisms in detail but neither page read stated a maximum size or a dollar figure; Render's
  pricing page returned an HTTP 404 at the URL guessed (`/docs/pricing`), so this number is simply
  missing rather than found-and-cited.
- **Hetzner's exact current per-GB Volume price and CX-series prices.** Hetzner's own pricing pages
  render their tables client-side (JavaScript), so a direct fetch returned only "price not displayed"
  placeholders. The €0.0572/GB/month volume figure and the CPX31/CPX41 monthly prices came from a
  search-engine-summarized reading of Hetzner's own indexed page text, which is a secondary path to a
  primary source, not a primary source read directly. Confirm via Hetzner's console price calculator
  before budgeting against these numbers.
- **Railway's exact mechanism for landing a ~15GB file onto a Volume when no S/FTP exists.** The docs
  confirm the absence ("no built-in S/FTP support") and describe `railway volume browse`/`files` from
  the CLI, but not their behavior at this file size, nor whether Railway offers any first-boot
  bootstrap primitive (an init container, a startup command with volume access) that would make an
  object-storage-bootstrap pattern natural versus something bolted on.
- **Whether Railway's Compose importer would accept `docker-compose.yml` as written**, given the
  `x-osrm` YAML anchor and the VROOM service's git-context `build.context` together — the docs' own
  caveat ("we don't support every possible Compose config just yet") was not resolved against this
  specific file.
- **Whether every existing Drizzle query in `src/lib/db/index.ts` is dialect-neutral enough to survive
  a libSQL swap unmodified.** The schema-level and connection-level deltas are well documented and
  small; whether any query relies on SQLite-file-specific behavior (e.g., the `WAL` pragma set in
  `client.ts`, which has no meaning against a remote libSQL server) was not audited query-by-query
  here.
