# Hosting: local vs. deployed, and what drives the bill

Operational reference, not a decision doc — see [ADR-0037](adr/0037-hosting-goes-live-fly-io-turso-and-a-password-gate.md)
for *why* this shape was chosen and [docs/research/private-deployment-options.md](research/private-deployment-options.md)
for the provider comparison it's built on. This doc exists to answer one question on an ongoing
basis: **what could make the bill move, and where do I go check.**

- **Scope check:** this is a 1-2 person personal deployment, not a product. Every free-tier ceiling
  below is sized against that; if the user count or usage pattern changes, re-read this doc's
  numbers before assuming they still hold.
- **Prices verified:** 2026-08-29, from each provider's own pricing/docs pages (linked inline).
  Every provider listed here changes pricing without notice — re-check the source link before
  budgeting against an old number, don't trust this file's numbers past a few months stale.

---

## 1. Local vs. deployed, side by side

| Piece                                  | Local (dev)                                          | Deployed                                                                                            |
| -------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **App (Next.js)**                      | `next dev`, your machine                             | Vercel, **Hobby plan**                                                                              |
| **Database**                           | `better-sqlite3` file at `db/dev.db`                 | Turso (libSQL), free tier                                                                           |
| **VROOM** (route optimization)         | Docker container, `docker-compose.yml`, your machine | Fly.io Machine, scale-to-zero                                                                       |
| **OSRM car** (road facts)              | Docker container, your machine                       | Fly.io Machine, scale-to-zero                                                                       |
| **OSRM foot** (road facts)             | Docker container, your machine                       | Fly.io Machine, scale-to-zero                                                                       |
| **Basemap tiles**                      | Stadia Maps, keyless                                 | Stadia Maps, same keyless path today                                                                |
| **Places / geocoding / routes matrix** | Google Maps Platform (Places API, Routes API)        | Same Google APIs, same key — usage is identical in shape whether you or a deployed user triggers it |
| **Access control**                     | None (`localhost` is trusted)                        | Custom middleware password gate (`src/proxy.ts`)                                                    |

The only pieces that actually cost money as a *function of deployment* are Vercel, Fly.io, and
Turso — those didn't exist as bills before ADR-0037. Stadia and Google were already usage-based
before deployment; deploying doesn't change their pricing model, only who can generate the traffic
that triggers it (see §5).

---

## 2. Vercel — the app itself

**Plan: Hobby ($0/mo).** Per [Vercel's Functions limits](https://vercel.com/docs/functions/limitations)
and current Hobby-tier documentation (verified 2026-08-29):

| Limit                                                        | Hobby allowance                                                                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fast Data Transfer (bandwidth)                               | 100 GB/mo                                                                                                                                                                               |
| Function invocations                                         | 1,000,000/mo                                                                                                                                                                            |
| Active CPU (compute time actually executing, not wall-clock) | 4 CPU-hours/mo                                                                                                                                                                          |
| Provisioned function memory                                  | 360 GB-hours/mo                                                                                                                                                                         |
| Function timeout                                             | 10s (this app's server actions/API routes proxy to Fly — see §3 — so a slow Fly cold-start could theoretically bump into this; worth knowing if a request to VROOM/OSRM ever times out) |
| Build minutes                                                | 6,000/mo                                                                                                                                                                                |

**What drives usage:** every page load, server action, and API route the app serves — this scales
with how often you (and whoever else has the password) open the app, not with anything about trip
size or optimize-run complexity. At 1-2 people using it occasionally, none of these ceilings are
realistically reachable; this is the one piece of the stack where "check the bill" is genuinely
unnecessary at current scale.

**One real constraint of Hobby, not a cost one:** it's licensed for **personal, non-commercial
use only**. That's a terms constraint, not a spend risk — but it's the thing that would force a
plan change (to Pro, $20/mo/seat) before a cost overage would.

**Where to check usage:** Vercel dashboard → project → Usage tab. No billing alerts are configured
by default on Hobby (there's nothing to bill), but the Usage tab still shows how close you are to
the invocation/bandwidth/CPU ceilings above.

---

## 3. Fly.io — VROOM + OSRM (car) + OSRM (foot)

This is the piece most likely to actually cost something and the piece least likely to be near a
free ceiling — Fly removed its free tier in 2024, so **every second these Machines run is billed**,
with no monthly allowance underneath it. There are three separate Fly apps (per
[deploy/fly/vroom.toml](../deploy/fly/vroom.toml), [deploy/fly/osrm-car.toml](../deploy/fly/osrm-car.toml),
[deploy/fly/osrm-foot.toml](../deploy/fly/osrm-foot.toml)), each billed independently.

### 3a. Compute — billed per second, only while running

All three are configured `auto_stop_machines = "stop"`, `min_machines_running = 0` — they scale to
zero between requests. **The bill is a function of how much *time* a request is in flight across
the fleet, not how many requests happen.** Per [Fly's pricing page](https://fly.io/docs/about/pricing/)
(Amsterdam-region reference rates; `sjc`, this project's actual region, may differ slightly):

| Machine   | Size (from the `.toml`) | Per-second rate | If it ran 24/7 (upper bound, not expected) |
| --------- | ----------------------- | --------------- | ------------------------------------------ |
| VROOM     | `shared-cpu-1x`, 1GB    | $0.00000228/s   | ~$5.92/mo                                  |
| OSRM car  | `shared-cpu-2x`, 2GB    | $0.00000456/s   | ~$11.83/mo                                 |
| OSRM foot | `shared-cpu-2x`, 2GB    | $0.00000456/s   | ~$11.83/mo                                 |

Those "24/7" figures are ceilings that won't be hit — scale-to-zero means actual compute cost
is proportional to **minutes the app was actually being used**, not calendar time. A session of
active trip-planning that keeps these Machines warm for, say, 30 minutes costs a small fraction of
a cent in compute. **The real cost driver here is cold-start frequency, not request volume**: every
time all three Machines have been idle and stopped, the next request pays a cold-start latency (not
a cost) to spin back up — annoying for the first click of a session, invisible on the bill.

### 3b. Storage — billed continuously, whether the Machine is running or not

This is the part that **does not scale to zero**. Fly Volumes bill "$0.15/GB per month of
provisioned capacity" regardless of Machine state — a stopped Machine's attached volume still
bills at full rate ([Fly billing docs](https://fly.io/docs/about/billing/)). The two OSRM graphs
together are the ~15GB serving set referenced in
[scripts/transfer-osrm-graphs.sh](../scripts/transfer-osrm-graphs.sh):

| Volume           | Provisioned size                          | Monthly cost at $0.15/GB |
| ---------------- | ----------------------------------------- | ------------------------ |
| `osrm_car_data`  | ~7-8GB (car graph share of the ~15GB set) | ~$1.10-1.20              |
| `osrm_foot_data` | ~7-8GB (foot graph share)                 | ~$1.10-1.20              |

**This is the one line item on the whole bill that runs 24/7 no matter what** — it's a fixed
~$2.25-2.50/mo floor independent of usage. VROOM has no volume (it's stateless, just the
solver binary), so it contributes nothing here.

### 3c. Network egress

[Fly's pricing page](https://fly.io/docs/about/pricing/) bills public-internet egress at
$0.02/GB (North America/Europe). Vercel → Fly traffic is small (JSON requests/responses for
route-matrix and optimize calls, not the OSRM graph itself), so this is realistically cents/mo at
current scale — worth knowing exists, not worth budgeting a line item for yet.

### Rough Fly.io total at "occasional 2-person use"

**~$3-6/mo**, dominated by the always-on volume storage rather than compute. This is well under
ADR-0037's own "~$20-25/mo" estimate, which assumed more continuous usage than "two people planning
trips occasionally" actually produces — that number is a ceiling, not the expected steady state.

**Where to check usage:** Fly dashboard (`fly.io/dashboard`) → Billing, or `fly billing` CLI —
shows per-app compute-seconds and volume-GB for the current billing period. Check this
periodically rather than waiting for the invoice; there's no built-in spend alert on Fly the way
Vercel has usage-ceiling notifications.

---

## 4. Turso — the database

**Plan: Free tier.** Per [Turso's pricing page](https://turso.tech/pricing) (verified 2026-08-29):

| Limit        | Free allowance |
| ------------ | -------------- |
| Storage      | 5 GB           |
| Rows read    | 500,000,000/mo |
| Rows written | 10,000,000/mo  |
| Databases    | 100            |

**What drives usage:** every query the app makes through `getDrizzle()` — trip/day/location/
placement reads and writes. At 1-2 people's trip-planning volume, both the row-read and
row-written ceilings are effectively unreachable (500M reads/mo is ~193 reads/second sustained for
a month); storage is the only dimension worth a glance, and a schema of trips/days/locations for a
couple of people is measured in megabytes, not gigabytes, for a very long time.

**Practical read: this is a $0/mo line item indefinitely at current scale.** The only way it stops
being free is either genuinely heavy usage (unlikely for this project's scope) or Turso changing
its free-tier terms — worth a periodic pricing-page re-check, not a monitoring dashboard.

**Where to check usage:** Turso dashboard (`app.turso.tech`) → database → Usage tab.

---

## 5. Google Maps Platform — Places API + Routes API

**This is the highest-variance, least-capped piece of the whole stack** — unlike Vercel/Fly/Turso,
Google has no hard free-tier ceiling that stops billing; it has per-SKU *free monthly allowances*,
past which every additional call is billed with no ceiling. This is the one provider where a burst
of usage (e.g., planning several large trips in a short window) could produce a real, uncapped
charge.

As of Google's 2025-03-01 pricing restructure, the flat $200/mo pooled credit no longer exists —
each SKU gets its own free-call allowance instead ([current pricing](https://developers.google.com/maps/billing-and-pricing/pricing)):

| API / SKU                                                          | What it's for in this app                                                                                       | Free calls/mo                                                                                                                | Price past free tier                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Routes: Compute Route Matrix — Essentials** (SKU 9392-1087-2045) | `googleRoutesProvider.ts`'s `computeRouteMatrix` — walking/driving/transit distance matrix during optimize runs | 10,000 **elements**                                                                                                          | $5.00/1,000 (to 100K), $4.00/1,000 (to 500K), $3.00/1,000 (to 1M) |
| **Routes: Compute Routes — Essentials**                            | `computeRoutes` (single A→B) calls in `googleRoutesProvider.ts`                                                 | 10,000/mo                                                                                                                    | Essentials-tier rate, similar order of magnitude                  |
| **Places: Place Details — Essentials**                             | `places.ts`'s place-detail lookups (enrichment)                                                                 | 10,000/mo                                                                                                                    | $5.00/1,000                                                       |
| **Places: Text Search — Pro tier** (field-mask dependent)          | `places.ts`'s `places:searchText` (discovery)                                                                   | 5,000/mo (Pro-tier allowance — Text Search bills at Pro rates whenever the request's field mask includes any Pro-tier field) | ~$32.00/1,000 (Pro floor)                                         |

**The quadratic cost driver worth actually watching:** the route-matrix call bills **origins ×
destinations**, not per trip. `docs/research/osrm-viability-149.md` (the doc that originally
sized this) found:

| Trip size (points) | Elements billed | Cost past free tier |
| ------------------ | --------------- | ------------------- |
| 20                 | 400             | $2.00               |
| 40                 | 1,600           | $8.00               |
| 60                 | 3,600           | $18.00              |
| 100                | 10,000          | $50.00              |

At 1-2 people planning modest trips occasionally, the 10,000-free-elements/mo allowance likely
absorbs most usage — but a single ambitious 60-100-point trip can burn through the entire monthly
free allowance in **one optimize run**, and the next one that month bills in full. This is
structurally different from Fly/Turso/Vercel: there's no "it'll never realistically get expensive"
guarantee here, because the cost scales with *how large a single trip you plan*, not with how
often you use the app.

**Text Search field-mask trap:** per Google's own billing rule, requesting *any* Pro-tier field in
`places:searchText`'s field mask bills the entire call at the Pro rate (~$32/1,000), even if most
of the requested fields are Essentials-tier. Worth checking `places.ts`'s actual field mask if this
line item ever looks larger than expected — it's a common way this bill surprises people.

**Where to check usage:** [Google Cloud Console](https://console.cloud.google.com/) → APIs &
Services → Dashboard, filtered to the Maps Platform project. **Set a budget alert here** — this is
the one piece of the stack with no natural ceiling, so it's the one most worth a Cloud Billing
budget/alert (Console → Billing → Budgets & alerts) rather than periodic manual checking.

---

## 6. Stadia Maps — basemap tiles

Per [ADR-0027](adr/0027-stadia-basemap-over-carto.md): keyless path, no account, no key — **not
currently billed at all**, and structurally can't be, since there's no account behind the keyless
localhost/low-volume path it's using. Free tier (if a key is ever added) is 200,000 credits/mo at
1 credit/tile; ADR-0027's own estimate put realistic usage in the "1,000+ sessions/mo of headroom"
range even under conservative assumptions. **Not worth monitoring at this scale** — flagged here
only because it's part of the stack, not because it's a cost risk.

One thing worth knowing: the keyless path carries an *unpublished* rate limit (not a cost, an
availability one) — if tiles start silently failing to load in the deployed app (not locally),
that's the first thing to suspect, and the fix (`NEXT_PUBLIC_STADIA_API_KEY`) is already wired,
just unused today.

---

## 7. Monthly total, roughly, at current scale

| Provider              | Expected monthly cost                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vercel (Hobby)        | $0                                                                                                                    |
| Turso (free tier)     | $0                                                                                                                    |
| Stadia Maps (keyless) | $0                                                                                                                    |
| Fly.io                | ~$3-6, mostly the always-on volume storage                                                                            |
| Google Maps Platform  | $0 in a typical month; **uncapped and trip-size-dependent** if a large trip burns past the 10K-element free allowance |

**The one number worth actually watching month to month is Google's bill**, precisely because it's
the only piece without a hard ceiling. Everything else on this list is either a small, predictable
fixed cost (Fly's volume floor) or comfortably inside a free tier this project's scale won't
outgrow for a long time.

## 8. What to re-verify before trusting this doc

Every price above is a snapshot from 2026-08-29. Before making a real budgeting decision off this
file:

- Re-check each linked pricing page directly — Fly, Turso, Vercel, and Google all change pricing
  without notice (this doc's own research source, `private-deployment-options.md`, says as much).
- If the user count or usage pattern changes (more people, more frequent trips, larger trips),
  re-read §5 in particular — it's the only section whose numbers scale with behavior rather than
  being a fixed ceiling.
- Set the one alert this doc recommends (§5, Google Cloud Billing budget) if it isn't set already
  — it's the one provider here that can actually surprise you.
