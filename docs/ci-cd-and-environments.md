# CI/CD and environments

How code and configuration actually move from your machine to production, and how the three
environments (local, Preview, Production) differ. Operational reference, not a decision doc — the
underlying hosting choices are [ADR-0037](adr/0037-hosting-goes-live-fly-io-turso-and-a-password-gate.md);
this doc is the "how do I actually work with it day to day" companion.

---

## 1. The pipeline, as it actually exists today

There is **no custom deploy workflow** — you don't need to build one. Vercel's native GitHub
integration is already connected to this repo (confirmed via `vercel env ls` and the `Vercel`
commit status on `main`) and does the deploy side entirely on its own:

```markdown
you push a branch / open a PR
        │
        ├──▶ GitHub Actions: .github/workflows/test.yml
        │     pnpm test && pnpm build && pnpm knip
        │     (no secrets needed — Docker/VROOM/OSRM-free by design, see the file's header)
        │
        └──▶ Vercel Git integration (automatic, no YAML)
              builds + deploys a Preview URL for the PR
              posts the deployment as a commit status ("Vercel")

you merge the PR to main
        │
        └──▶ Vercel Git integration (automatic, no YAML)
              builds + deploys straight to Production
```

**These two paths run independently and neither blocks the other today.** The GitHub Actions
`test` check can fail on a PR and Vercel will still happily deploy a Preview for it; merging to
`main` triggers a Production deploy regardless of whether `test` passed on that commit, because
**`main` has no branch protection rule** (checked via `gh api repos/.../branches/main/protection`
→ 404, unprotected). For a solo-maintainer repo this is a deliberate trade-off, not an oversight —
but it means the `test` workflow is a courtesy signal today, not a gate. See §5 if you want to
change that.

**What this means practically:** you almost never touch GitHub Actions YAML to "do a deployment."
`test.yml` exists purely to catch regressions before you look at a PR; the actual ship happens the
instant you merge, with no additional step.

---

## 2. The three environments, side by side

|                        | Local (`pnpm dev`)                                       | Preview (every PR)                    | Production (`main`)                  |
| ---------------------- | -------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| **Where**              | Your machine                                             | Vercel, per-PR URL                    | Vercel, the production domain        |
| **Env vars come from** | `.env.local` (hand-maintained, gitignored)               | Vercel dashboard, "Preview" scope     | Vercel dashboard, "Production" scope |
| **VROOM/OSRM**         | `docker compose up -d`, localhost                        | **Same Fly.io apps as Production**    | Fly.io (`deploy/fly/*.toml`)         |
| **Database**           | `db/dev.db` (local SQLite file, no Turso account needed) | **Same Turso database as Production** | Turso                                |
| **Password gate**      | Skipped — `src/proxy.ts` checks `process.env.VERCEL`     | Same secret as Production             | `SITE_PASSWORD`                      |

The two **bolded** rows are the one deliberate risk accepted in this setup, spelled out in §3 —
everything else is exactly the isolation you'd expect (separate app builds, separate URLs).

---

## 3. Preview and Production share real infrastructure — accepted, not a bug

`vercel env ls` shows `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `VROOM_URL`, `OSRM_CAR_URL`, and
`OSRM_FOOT_URL` are each set once and scoped to **both** Preview and Production. That means:

- **Opening a PR that touches the database creates a live deployment that reads and writes your
  real production data.** There is no separate "preview" database.
- **A PR's Preview deployment can wake and bill the same Fly.io Machines Production uses** — not a
  meaningful cost risk given ADR-0037's scale-to-zero billing (§7 of
  [docs/hosting-and-costs.md](hosting-and-costs.md)), but worth knowing if a Fly Machine seems to
  be running when you didn't expect it.

This was a deliberate call, not a gap that slipped through: at 1-2 users and solo-maintainer PR
volume, a second Turso database and a second set of Fly apps is real ongoing infrastructure to
provision and keep in sync for a risk that's mostly theoretical at this scale. **The concrete
practical consequence:** before merging a PR whose Preview deployment exercised a destructive or
bulk database operation, know that it ran against production data, not a sandbox. If this project's
usage ever grows past "personal, low-stakes," the documented upgrade path is **Turso database
branching** — a free-tier-friendly feature that would give Preview its own disposable database
without touching the Fly/VROOM/OSRM side at all.

---

## 4. Changing an environment variable — the runbook

This is the thing that actually causes friction if you don't know it going in:

> **Vercel never injects a changed env var into an already-built deployment.** Editing a value in
> the dashboard (or via `vercel env add`) only affects the *next* deployment — the currently-live
> one keeps running with whatever value was baked in when it was built.
> ([Vercel docs](https://vercel.com/docs/environment-variables))

So the full sequence for a real change is:

1. **Update the value.**

   ```bash
   # Interactive (prompts for environment + value):
   vercel env add GOOGLE_MAPS_API_KEY production

   # Non-interactive:
   echo "new-value" | vercel env add GOOGLE_MAPS_API_KEY production

   # Or remove first if replacing rather than adding:
   vercel env rm GOOGLE_MAPS_API_KEY production
   ```

   Scope it to `production`, `preview`, `development`, or several at once — see
   [.env.example](../.env.example) for the full list of vars this app reads and
   [README.md](../README.md#4-set-a-site-password) for what each one is.

2. **Trigger a redeploy so the new value actually takes effect.** Any of:
   - Push a commit (the normal case — you're usually changing a var *because* of a code change).
   - `vercel redeploy` on the latest deployment (no code change, just forces a rebuild against
     current env vars).
   - The Vercel dashboard's "Redeploy" button on the deployment you want refreshed.

3. **Re-pull locally if the change affects your own dev environment:**

   ```bash
   vercel env pull .env.local --yes
   ```

   Note this only pulls vars scoped to **Development** on Vercel — today, none of this app's vars
   are (every secret is scoped Preview+Production only, since local dev intentionally points at
   `localhost` Docker services and a local SQLite file, not hosted infrastructure — see README's
   Setup section). In practice this means: **local `.env.local` is hand-maintained, not synced from
   Vercel**, and `vercel env pull` won't do anything useful here unless that changes.

**One unused variable worth knowing about:** `.env.local` currently defines
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, but nothing in `src/` reads it (only the non-public
`GOOGLE_MAPS_API_KEY` is used, server-side, in `src/lib/places.ts` and
`src/lib/googleRoutesProvider.ts`) — it's not set on Vercel at all. Safe to delete from your local
file; it's not doing anything.

---

## 5. Rolling back a bad Production deploy

```bash
vercel rollback              # back to the previous Production deployment
vercel rollback <url>        # back to a specific earlier deployment
```

`rollback` re-points the production alias instantly — no rebuild, same mechanism as `promote`.
This is the fast path if a merge to `main` turns out to be broken; it's faster than reverting the
commit and waiting for a new build.

---

## 6. Optional: making `test` an actual gate, not a courtesy signal

Right now (§1) a merge to `main` deploys to Production whether or not `test.yml` passed on that
commit — nothing in GitHub or Vercel enforces the check. If you want a real gate before this bites
you, the standard fix is a GitHub branch protection rule:

```bash
gh api repos/Tyler-Reagan/trip-kraken/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["test"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews=null \
  --field restrictions=null
```

This blocks merging a PR into `main` until the `test` check is green — it does **not** touch
Vercel at all; Vercel would still deploy the merge commit automatically once it lands, same as
today, just now that commit is guaranteed to have passed `pnpm test && pnpm build && pnpm knip`
first. Left undone deliberately here since it's a workflow-friction trade-off only you can weigh
(a flaky or slow check would now block your own solo merges) — not applied unless you ask for it.

---

## 7. What to re-verify before trusting this doc

- `vercel env ls` output changes over time — re-run it before assuming which vars are scoped where.
- Branch protection status (§6) is a snapshot from 2026-08-29; check
  `gh api repos/Tyler-Reagan/trip-kraken/branches/main/protection` if you're unsure it's still
  (un)set.
- Vercel's "env var changes need a redeploy" behavior (§4) is current platform behavior per their
  own docs as of 2026-08-29 — worth a spot-check against
  [vercel.com/docs/environment-variables](https://vercel.com/docs/environment-variables) if this
  doc is more than a few months old when you read it.
