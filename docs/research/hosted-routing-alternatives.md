# Hosted road-routing providers as a replacement for self-hosted OSRM

- **Answers:** the ADR-0024 re-examination raised on 2026-08-08. No issue filed; this doc is the
  artifact.
- **Date:** 2026-08-08
- **Status:** Research findings. Not an ADR. Nothing below requires amending ADR-0024, but §7 names
  one thing worth adding to it.
- **Scope:** ADR-0024 §1 chose three self-hosted `osrm-routed` containers over "a metered provider,"
  having priced only Google. This asks whether any *other* hosted matrix/routing API can take that
  job, and disqualifies the ones that cannot with the specific fact that does it.
- **Sources read at:** 2026-08-08. Mapbox Product Terms dated 2026-07; GraphHopper ToS "version 9,
  Aug 9, 2021"; VROOM/vroom-express `master`.
- **Workload sized against:** one N×N duration matrix per optimize run, N up to 60 (**3,600
  elements**), walking dominant, primary region Japan, one user, plus a much lighter per-journey
  `describeJourney` call needing steps and geometry.

## Recommendation

**No hosted provider can replace self-hosted OSRM here, and the reason is not price — it is that
four of the five forbid the thing ADR-0024 §2 decided to do.** ADR-0024 §2 makes the Facts layer
*materialize the full N² matrix itself*, server-side, before the solver knows which pairs it will
use. Mapbox forbids that in terms ("shall not export, download, cache or store results from any
request to a Navigation API"), Stadia forbids that in terms ("server-side caching is prohibited"),
Google forbids it twice over ("pre-fetch, index, store … distance matrix results", plus a No Caching
clause whose only Routes API exception is latitude and longitude), and GraphHopper grants permission
only for temporary client-side caching. Applying ADR-0019's NAVITIME test literally — *a ban on
caching is disqualifying* — removes every commercial hosted option before pricing is even reached.

**The one provider that passes the ToS test is OpenRouteService, and its own answer to production
use is a self-hosted install.** HeiGIT's terms contain no caching or storage prohibition of any
kind. Its hosted API is genuinely free, covers Japan, and offers `foot-walking` and `foot-hiking`.
But the plan page lists exactly three tiers — Standard (free), Collaborative (free, restricted to
humanitarian/academic/governmental/not-for-profit applicants), and **On-Premise** — and there is
**no purchasable tier at all**. You cannot buy quota, an SLA, or a support path. Its matrix cap is
3,500 elements, so a 60×60 needs two requests, reintroducing exactly the tiling loop that
`--max-table-size 1000` deleted. And its results carry CC-BY-SA 4.0, a share-alike term the ODbL
produced-work carve-out we rely on today does not impose. Substituting ORS for OSRM would trade a
container we control for a free research service that can withdraw access, and would not remove
self-hosting from the picture — it would remove *road* self-hosting while VROOM and the Japan rail
graph stay.

So the "wrap economical third-party providers" principle is satisfied rather than violated here, but
for a sharper reason than ADR-0024 recorded. The correct statement is not "hosted routing is too
expensive"; it is **"hosted routing at this scale is licensed for display, not for computation, and
we are doing computation."** Cost is a second-order confirmation: Google is $18.00 per 60-point
optimize run and Mapbox $7.80, against a fixed $0 for a container on a machine that already exists
(ADR-0025).

Two things do change:

1. **Hosted ORS is a legitimate *composition entry*, not a replacement.** ADR-0024 §4's
   decline-and-compose registry is exactly the shape that lets a free, quota-limited, ToS-clean
   provider sit between `osrm` and `haversine` — filling the cells a region-scoped road graph
   declines, at zero cost, instead of dropping straight to `straightLine`. That directly answers the
   ADR-0024 amendment's own worry that a trip outside the extract "silently routes entirely by
   haversine." Worth an ADR-0024 addendum; see §7.
2. **GraphHopper's `hike` profile is the named escape hatch for Prototype B's risk, priced.**
   ADR-0024's Consequences already reserve "a metered provider ahead of OSRM for `walking` in that
   region" if OSM walking data proves biased in hilly terrain. GraphHopper is the only provider
   whose documentation says elevation affects walking duration. The price of exercising that hatch
   is **€199/month** (Standard — the cheapest tier that fits 60 locations in one matrix call), and
   its ToS permits only client-side caching. Now it is a known number rather than an open option.

---

## The comparison, sized against 3,600 elements

Not a feature grid. Every column is our workload.

| | Requests for one 60×60 | Max per request | Walking profile | Cost per 60×60 run | Cheapest tier that fits | ToS on server-side storage |
| --- | --- | --- | --- | --- | --- | --- |
| **OSRM (self-hosted)** — incumbent | **1** | `--max-table-size 1000` locations, our flag | `foot` | **$0** | n/a — the dev machine (ADR-0025) | n/a (BSD + ODbL) |
| **OpenRouteService** (hosted) | 2 | **3,500 elements** | `foot-walking`, `foot-hiking` | **$0** (500 matrix req/day) | Standard, free — *no paid tier exists* | **No clause. Passes.** Results CC-BY-SA 4.0 |
| **Stadia Maps** | 6 (Standard) / 1 (Professional) | 625 elements (Standard), 10,000 (Professional) | `pedestrian` | 36,000 credits (10/element) | **$250/mo Professional** for one call; $80/mo Standard with tiling | **Fails.** "server-side caching is prohibited" |
| **GraphHopper** | 1 (Standard) / 4 (Basic) | 80 locations (Standard), 30 (Basic) | `foot`, `hike` | 600 credits | **€199/mo Standard**; €69/mo Basic with tiling | **Fails for our shape.** Only "temporarily cached on the client side" is permitted |
| **Mapbox Matrix** | **25** | **25 coordinates** / 625 elements | `mapbox/walking` | 3,900 billed elements → **$7.80** after free tier | Free 100k elements/mo ≈ 25 runs, then $2.00/1,000 | **Fails.** "shall not export, download, cache or store results from any request to a Navigation API" |
| **Google Routes** (baseline) | 9 | 625 elements | `WALK` | **$18.00** | 10,000 free events/mo = **2 runs** | **Fails.** No Scraping + No Caching; Routes exception covers lat/lng only |

Notes on how each number was derived:

- **Mapbox is the worst fit and it is not close.** The cap is 25 *coordinates* per request, and
  sources and destinations are drawn from that same list — so 60 points cannot appear in one
  request at all. The densest legal tile is 12 sources × 13 destinations = 156 elements, needing
  **25 requests** and overshooting to 3,900 billed elements. At 60 requests/minute the run also
  spends most of a minute in rate-limit budget.
- **Google needs 9 requests** (3×3 tiles of 25×25 at the 625-element cap) — the tiling loop
  `computeFullMatrix` exists for, and which `osrm-viability-149.md` §3 identified as the largest
  code simplification OSRM buys.
- **ORS needs 2** — 60×60 = 3,600 misses the 3,500-element cap by 100. Split sources 30/30 and each
  half is 1,800.
- **GraphHopper fits in one call on Standard** and is the cheapest *per element* of the metered
  options: its formula takes the better of `(origins × destinations) ÷ 2` and
  `max(origins, destinations) × 10`, so a 60×60 costs 600 credits, not 1,800. 15,000 credits/day is
  25 runs/day. The Free package caps at **5 locations**, which makes it unusable for a matrix, and
  is non-commercial anyway.
- **Stadia's per-element credit cost is the highest** (10 credits/element = 36,000 per run), but its
  credit pools are large: Standard's 7.5M/month is ~208 runs. The binding constraint is the
  **625-element ceiling below the Professional plan**, which forces six tiles at $80/mo or $250/mo
  to avoid them.

---

## The ToS section — this is what decides it

ADR-0019 rejected NAVITIME on one clause. Held to that same standard, here is every relevant clause,
quoted from the terms themselves.

### Mapbox — disqualified, unambiguously

[Mapbox Product Terms (July 21, 2026)](https://www.mapbox.com/legal/product-terms), §2.10.1:

> **Navigation APIs.** Customer shall not export, download, cache or store results from any request
> to a Navigation API.

§3.51 defines "Navigation APIs" as "Mapbox's navigation service APIs as described in Mapbox
documentation," and the Matrix API is documented at
[docs.mapbox.com/api/**navigation**/matrix/](https://docs.mapbox.com/api/navigation/matrix/). §3.48
defines a "Matrix Element" as "each origin-destination pair included in a Matrix API request," so
there is no reading under which a matrix result escapes §2.10.1.

The default restrictions in §1.9 are independently disqualifying. Customer shall:

> (i) only query the Services in response to human user queries and human application interactions,
> (ii) not perform bulk or automated queries, (iii) not scrape or systematically download Licensed
> Map Content, (iv) only access Licensed Map Content (other than Data Products) directly from Mapbox
> APIs, and (v) not export, download, cache or store Licensed Map Content or other results from the
> Service Offerings.

A 25-request N² sweep issued by a solver is a bulk automated query by any reading of (ii).

### Google Routes — disqualified, and the incumbent already is

[Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms/), §3.2.3:

> **(a) No Scraping.** Customer will not export, extract, or otherwise scrape Google Maps Content
> for use outside the Services. For example, Customer will not: (i) pre-fetch, index, store,
> reshare, or rehost Google Maps Content outside the services; (ii) bulk download Google Maps tiles,
> Street View images, geocodes, directions, **distance matrix results**, roads information, places
> information, elevation values, and time zone details […]
>
> **(b) No Caching.** Customer will not cache Google Maps Content except as expressly permitted under
> the Maps Service Specific Terms.

The only Routes API exception, from the
[Maps Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) §19.3:

> **Caching.** Customer may temporarily cache latitude (lat) and longitude (lng) values from the
> Routes API for up to 30 consecutive calendar days, after which Customer must delete the cached
> latitude and longitude values.

Coordinates only. Durations and distances are not covered, and "pre-fetch … distance matrix results"
is named explicitly in (a)(i)–(ii). **This is a finding about today's code, not only about the
alternatives**: ADR-0024 §7 keeps Google for `bus` at both altitudes, and ADR-0018's
representative-time matrix is a pre-fetch by construction. It is defensible in-memory within one
request and indefensible the moment a `TravelCost` or a `PathGeometry` lands in SQLite. Nothing is
persisted today (`src/lib/db/schema.ts` has no travel-cost column), so this is a constraint to
respect going forward rather than a violation to fix.

### Stadia Maps — disqualified

[Stadia Maps Terms of Service](https://stadiamaps.com/terms-of-service/), §8 "Conduct and Acceptable
Use," prohibited activities, item 5:

> proxying or caching access to our Services in any way, except for the above exception of limited
> downloads for offline use in a mobile application, use of the cacheable static maps endpoint as
> defined in the section Cacheable Static Maps, or standard client-side caching (**server-side
> caching is prohibited**) for performance reasons provided that the cache is local to the client
> device and the data is not retained for longer than the HTTP caching headers, or 7 days in the case
> that a header is not returned

Item 7 adds a permanent-storage ban, but scopes it to geocoding:

> permanently storing results for future use (e.g., as a database column), in part or in whole, from
> the Stadia Maps Geocoding APIs without an active Standard, Professional, or Enterprise subscription
> with appropriate permissions

Item 7's silence on routing does not rescue it: item 5's parenthetical is unqualified, and every
cache trip-kraken would keep is server-side by construction — the Facts layer runs in a Next.js
route handler, not in the browser.

### GraphHopper — disqualified for our shape, by omission rather than prohibition

[GraphHopper Terms of Service](https://www.graphhopper.com/terms/) (version 9, Aug 9, 2021), §5,
"Proxying and Caching":

> To redistribute the Directions API you need a custom package and agreement with GraphHopper. **The
> results may be temporarily cached on the client side (e.g. browser or mobile app).** Scraping or
> any mass download is prohibited, if not otherwise stated in your package.

This is the weakest of the four disqualifications and the one most worth re-reading before acting on
it. It does not say "server-side caching is prohibited"; it grants an affirmative permission for
temporary client-side caching and says nothing else. Read narrowly, that permission is the only one
granted, and a server-side matrix held for a solver run falls outside it. Read charitably, a matrix
consumed within one request and discarded is not a "cache" at all. The prudent reading for a
provider we would rely on for the hot path is the narrow one — but if GraphHopper is ever brought in
under the ADR-0024 walking-quality escape hatch, this clause is worth a direct written question to
GraphHopper rather than a guess. The free package is separately barred: "The commercial use of the
Free-package is allowed in the development phase and for the production phase on inquiry."

### OpenRouteService — passes, with a different obligation attached

[HeiGIT Terms of Service](https://account.heigit.org/info/tos) contains **no clause about caching,
storing, or persisting results.** The "Prohibited Conduct" list covers unlawful content, false
identity, export control, unauthorized network access, malicious code, and transmitting personal
data. The "Usage Limits" section governs request rate only:

> If you exceed the usage limits of any given HeiGIT API, the API will return an error message. If
> you repeatedly exceed the limits, your access to the API will be temporarily blocked and we reserve
> the right to disable and/or remove your account without prior notice.

What attaches instead is a license on the output:

> Results obtained from openrouteservice in any context are licensed under CC-BY-SA 4.0.

and an attribution string:

> © openrouteservice by HeiGIT | Data from OpenStreetMap

CC-BY-SA 4.0 on *results* is a stronger claim than the ODbL position `osrm-viability-149.md` §6
established for the self-hosted graph, where §4.5(b) explicitly says a Produced Work "does not create
a Derivative Database" and share-alike therefore does not reach the application. A share-alike
license asserted directly over query results has no equivalent carve-out. For a single-user,
undeployed app this is inert. It is not inert if itineraries are ever published, and it is a
genuine reason ORS is a supplement rather than the foundation.

Also note the account rule: "Any person is permitted one single account for all HeiGIT APIs and
services."

### Summary against the NAVITIME test

| Provider | Caching/storage clause | ADR-0019 test |
| --- | --- | --- |
| Mapbox | "shall not export, download, cache or store results from any request to a Navigation API" | **Disqualified** |
| Google | "No Caching"; Routes exception is lat/lng for 30 days only; "pre-fetch … distance matrix results" named under No Scraping | **Disqualified** |
| Stadia | "server-side caching is prohibited" | **Disqualified** |
| GraphHopper | Only "temporarily cached on the client side" is permitted | **Disqualified (narrow reading); worth a written question** |
| OpenRouteService | No such clause. Results CC-BY-SA 4.0; attribution required | **Passes** |

---

## Evidence

### 1. Matrix endpoints and per-request caps

**OpenRouteService.** [API Restrictions](https://openrouteservice.org/restrictions/), Matrix row:
"Locations (origin x destination): **3.500 (e.g. 50 x 50) per request**"; with dynamic arguments,
"25 (e.g. 5 x 5) per request". Request shape is a `locations` array with optional `sources` and
`destinations` index arrays, `metrics` selecting duration and/or distance, durations in seconds
([matrix endpoint docs](https://github.com/GIScience/openrouteservice/blob/main/docs/api-reference/endpoints/matrix/index.md)).
That is the same shape as OSRM's `table` and maps onto `TravelCost` identically.

**Stadia Maps.** [Time/Distance Matrix](https://docs.stadiamaps.com/routing/time-distance-matrix/):
max elements **625 (Standard)** / **10,000 (Professional)**, for both the vehicle costing models and
"all others." A second constraint has no counterpart elsewhere and does not bind us: "Max b-line
distance between all locations" is 400 km for vehicles and **200 km for other modes** — a
Tokyo–Kyoto walking matrix (~370 km beeline) would be rejected outright, though no plausible trip
asks for one.

**GraphHopper.** [Plans and Credits](https://docs.graphhopper.com/openapi/map-data-and-routing-profiles):
"Max routing locations" is **5 (Free) / 30 (Basic) / 80 (Standard) / 200 (Premium) / up to 10,000
(Custom)**. Credit formula for Matrix: "(origins × destinations) ÷ 2, or max(origins, destinations)
× 10 — whichever is cheaper (min 1)". A synchronous request that "take[s] longer than 10 seconds"
returns a bad-request error; there is an async `/matrix/calculate` + `/matrix/solution/{jobId}` pair
for larger problems.

**Mapbox.** [Matrix API](https://docs.mapbox.com/api/navigation/matrix/): "Maximum **25 input
coordinates** per request" and "Maximum 60 requests per minute" for `mapbox/driving`,
`mapbox/walking`, `mapbox/cycling`; 10 coordinates and 30 requests/minute for
`mapbox/driving-traffic`. "The maximum number of elements per request is 625 (25 sources × 25
destinations)."

**Google Routes.** 625 elements for non-`TRANSIT`, 100 for `TRANSIT` — unchanged from
`osrm-viability-149.md` §4, where the constant `MAX_ELEMENTS` in `googleRoutesProvider.ts` was
verified against
[compute_route_matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix).

### 2. Quotas and price, at our volume

**OpenRouteService** — [plans](https://account.heigit.org/info/plans). Three tiers, all €0:

| Plan | Matrix V2 (daily / per minute) | Directions V2 | Eligibility |
| --- | --- | --- | --- |
| Standard | **500 / 40** | 2000 / 40 | anyone |
| Collaborative | 2500 / 60 | 10000 / 60 | "humanitarian, academic, governmental, or not-for-profit organisation"; apply with an organisation email |
| On-Premise | ∞ / ∞ | ∞ / ∞ | you run it yourself |

There is **no paid plan on that page.** At two matrix requests per optimize run, Standard's 500/day
is 250 runs per day, which is far past anything one user does — the risk is not quota, it is that
quota cannot be escalated, purchased, or guaranteed. Note also that the On-Premise tier lists
`vroom` among the services HeiGIT ships, and that HeiGIT hosts a VROOM-backed Optimization endpoint
(500/day on Standard) attributed as "Developed by vroom | Hosted by HeiGIT | Routing by
openrouteservice". That is a hosted version of ADR-0023's Decision layer, out of scope here but worth
knowing exists.

**Stadia Maps** — [pricing](https://stadiamaps.com/pricing/). Free $0 / 200,000 credits/month, "No
additional usage", "**Commercial use not allowed**"; Starter $20 / 1,000,000 (+3¢ per 1,000 extra);
Standard $80 / 7,500,000 (+2¢); Professional $250 / 25,000,000 (+1.5¢). Credit schedule: "Standard
Routing 20/req", "**Time/Distance Matrix 10/element**". So 3,600 elements = 36,000 credits: the free
pool is ~5 runs/month and forbids commercial use; Standard's pool is ~208 runs/month but caps
requests at 625 elements; Professional is the only tier that takes the matrix in one call.

**GraphHopper** — [pricing](https://www.graphhopper.com/pricing/). Free €0 / 500 credits per day,
"for non-commercial use only", 5 locations; Basic €69/mo / 5,000 per day; Standard €199/mo / 15,000
per day; Premium €479/mo / 50,000 per day. At 600 credits per 60×60, Standard is 25 runs/day.

**Mapbox** — [pricing](https://www.mapbox.com/pricing). Matrix API: "Up to 100,000" elements/month
free, then $2.00 per 1,000 (100,001–500,000), $1.60 (500,001–1,000,000), $1.20 (1,000,001+). Our
tiling bills 3,900 elements per run, so ~25 free runs/month, then $7.80/run.

**Google Routes** — [pricing](https://developers.google.com/maps/billing-and-pricing/pricing).
"Routes: Compute Route Matrix Essentials" (SKU 9392-1087-2045): 10,000 free events/month, then $5.00
per 1,000 to 100,000. Pro (SKU 2E25-887A-DAD4) is now **$10.00 per 1,000** with 5,000 free events —
note this is higher than the $8.00 recorded in `osrm-viability-149.md` §4, so the traffic-aware
option got more expensive since that doc, not less. Billing is "per ELEMENT returned from the
request. The number of elements is the number of origins multiplied by the number of destinations"
([usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing)).
3,600 elements = **$18.00 per optimize run**; the free allowance covers two.

### 3. Profile coverage

| Provider | Walking | Cycling | Driving |
| --- | --- | --- | --- |
| OSRM (self-hosted) | `foot` | `bicycle` | `car` |
| OpenRouteService | `foot-walking`, `foot-hiking` | `cycling-regular`, `cycling-road`, `cycling-mountain`, `cycling-electric` | `driving-car`, `driving-hgv` |
| Stadia Maps | `pedestrian` | `bicycle` | `auto` (+ `auto_traffic`, `auto_traffic_premium`), `bus`, `taxi`, `truck` |
| GraphHopper | `foot`, `hike` | `bike`, `mtb`, `racingbike`, `ecargobike` | `car` (+ `car_avoid_motorway` / `_ferry` / `_toll`), `small_truck`, `truck`, `scooter` |
| Mapbox | `mapbox/walking` | `mapbox/cycling` | `mapbox/driving`, `mapbox/driving-traffic` |
| Google Routes | `WALK` | `BICYCLE` | `DRIVE`, `TWO_WHEELER` |

Every candidate covers all three declared capabilities. Profile coverage is therefore **not a
differentiator** and does not narrow the field.

One profile detail does matter, because it speaks to the residual risk ADR-0024 assigned to
Prototype B. OSRM's stock `foot.lua` is a flat 5 km/h with no elevation model
(`osrm-viability-149.md` §1). GraphHopper's docs are the only ones among these that claim otherwise,
for `hike`:

> Pedestrian routes prioritizing scenic beauty and longer distances than with the foot profile,
> designed for hiking experiences rather than casual walks. **Walking duration is influenced by
> elevation differences.**

That is a documented capability OSRM's stock profile lacks, in precisely the Kyoto-Higashiyama /
Hakone case the manual eval targets. `hike` also "[m]ay include challenging or potentially dangerous
trail sections," so it is not a drop-in for urban walking; the useful reading is that GraphHopper is
a credible instrument for *calibrating* whether OSRM's flat 5 km/h is biased, not a replacement for
it.

### 4. VROOM's `ors` and `valhalla` routers cannot reach a hosted endpoint

Read from source, and confirmed against a live request.

**HTTPS does work.** `HttpWrapper::run_query` selects TLS purely on port number
([`src/routing/http_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/http_wrapper.cpp)):

```cpp
const std::string HttpWrapper::HTTPS_PORT = "443";
...
std::string HttpWrapper::run_query(const std::string& query) const {
  return (_server.port == HTTPS_PORT) ? ssl_send_then_receive(query)
                                      : send_then_receive(query);
}
```

**A URL path prefix also works.** `update_host` in
[`src/structures/cl_args.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/cl_args.cpp)
splits anything after the first `/` in the `-a` value into `Server::path`, which is why the stock
config writes `host: '0.0.0.0/ors/v2'`.

**An API key does not.** `Server` is exactly three strings — `host`, `port`, `path`
([`src/structures/typedefs.h`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/typedefs.h))
— with no field for credentials. `OrsWrapper::build_query`
([`src/routing/ors_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/ors_wrapper.cpp))
emits four headers and no more:

```cpp
std::string query = "POST /" + _server.path + service + "/" + profile;
query += " HTTP/1.0\r\n";
query += "Accept: */*\r\n";
query += "Content-Type: application/json\r\n";
query += std::format("Content-Length: {}\r\n", body.size());
query += "Host: " + _server.host + ":" + _server.port + "\r\n";
query += "Connection: close\r\n";
```

No `Authorization`. `ValhallaWrapper` is the same story with a different verb — it builds
`GET /{path}sources_to_targets?json={…}` with `Host`, `Accept`, `Connection` and nothing else, and
because the query string is opened by `?json=`, there is no position from which a config value could
smuggle in an `&api_key=` parameter either.

And vroom-express never passes anything but a host and a port —
[`src/index.js`](https://github.com/VROOM-Project/vroom-express/blob/master/src/index.js):

```js
for (const profileName in routingServers[args.router]) {
  const profile = routingServers[args.router][profileName];
  if ('host' in profile && 'port' in profile) {
    defaultOptions.push('-a', profileName + ':' + profile.host);
    defaultOptions.push('-p', profileName + ':' + profile.port);
  }
```

The hosted ORS API rejects exactly that. An unauthenticated `POST` to
`https://api.openrouteservice.org/v2/matrix/foot-walking` returns:

```json
{ "error": "Authorization field missing" }
```

**Conclusion:** vroom-express's `router: 'ors' | 'valhalla'` support targets a **self-hosted**
instance only. ADR-0024's Alternatives note that "the compose ports are nonetheless kept aligned
with `vroom-express`'s stock `routingServers` map, so the door stays open at no cost" remains true
— but the door opens onto self-hosted routers, not onto a hosted ORS or a hosted Valhalla (Stadia).
That is worth writing down, because it removes an imagined escape hatch: there is no configuration
of the current VROOM that reaches a keyed hosted endpoint. Since ADR-0024 §2 already says we never
use this path, nothing breaks; the claim just needs to be stated accurately.

### 5. Japan road and pedestrian data — no differentiator except Google

| Provider | Underlying road data |
| --- | --- |
| OSRM (self-hosted) | OpenStreetMap (pinned Geofabrik extract) |
| OpenRouteService | OpenStreetMap — "Data from OpenStreetMap"; ToS Safety Disclaimer: "HeiGIT uses OpenStreetMap as a free editable geographic dataset" |
| Stadia Maps | OpenStreetMap — "frequent (approximately weekly) data updates from OpenStreetMap and other data sources"; attribution "© Stadia Maps © OpenMapTiles © OpenStreetMap" |
| GraphHopper | "The default data source is OpenStreetMap. As an alternative, we also offer TomTom MultiNet." |
| Mapbox | OpenStreetMap among others; required attribution includes "© OpenStreetMap" |
| Google Routes | Proprietary |

**The road-quality risk ADR-0024 named is identical across every OSM-backed provider, so it cannot
be used to argue for any of them.** Only two options change the underlying data at all:

- **Google**, which is proprietary end to end — and is disqualified on ToS.
- **GraphHopper's TomTom MultiNet**, "a global map covering more than 150 countries and 30
  territories," updated quarterly, with "link speeds that vary over the time of day." This looked
  like the one genuine data-quality alternative until the profile list is read: TomTom MultiNet
  supports **`car` and `small_truck` only.** There is no pedestrian profile on the non-OSM map. For
  a workload where "walking is dominant," the alternative data source is unavailable exactly where
  it would matter.

So: switching to any hosted OSM provider buys nothing on data quality, and the one non-OSM road map
on offer does not cover walking.

### 6. Hosted OSRM specifically — nobody serves Japan on foot

There *are* commercial hosted-OSRM operators. None fits.

- **[Geofabrik](https://www.geofabrik.de/data/routing.html)** — the most credible, being the same
  organisation that publishes the extract ADR-0024 pins. They run OSRM and GraphHopper servers, the
  OSRM one offers the table/matrix service, and pricing is a flat subscription: Small 100,000
  requests/month €40, Medium 1,000,000 €80, Large 10,000,000 €160, XXL unlimited from €550, with
  "fees … charged for one year in advance." **Disqualifying:** the OSRM instance is **car profile
  only**, and the servers "compute routes across **Europe**." Wrong profile and wrong continent.
- **The OSRM demo server** (`routing.openstreetmap.de`, run by FOSSGIS) — governed by the project's
  own [API usage policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy):
  "Excessive use is not allowed. If your requests are impacting the service stability, we will block
  you"; access "shall be withdrawn at any time and without giving a reason"; and, decisively for a
  personal trip planner, "Access to the demo server shall not be behind a paywall: If the Demo
  Server is used in a commercial product, it needs to be publicly accessible." Not infrastructure.
- **OSRMRoute** (`osrmroute.com`) — a hosted full OSRM service with car/bike/foot, but coverage is
  "26 countries (Caucasus, Central Asia, Türkiye, Iran and the Middle East)." Japan is not among
  them. (Low-trust vendor besides; noted for completeness.)
- **Simple Routing** (`simplerouting.io`) — advertises hosted OSRM. Its pages returned HTTP 403 to
  every fetch, so nothing about it is verified. Recorded as unverified, not as an option.

**Answer to the question as asked: hosted OSRM exists, but not with a foot profile over Japan.** The
thing ADR-0024 needs is precisely the thing no one sells.

### 7. What running the incumbent actually costs

`osrm-viability-149.md` §4 derived per-profile serving RAM for a nationwide Japan extract by linear
extrapolation from OSRM's own planet figures — the wiki states "[t]he sizes scale roughly linear with
input data size," planet at "11/2021, 61GiB .pbf" needs "around 123 GiB of RAM" to serve car, and
"[t]he foot profile includes a lot more ways/roads/paths than the car profile, so it needs more
resources. The cycling profile sits somewhere in between"
([Disk and Memory Requirements](https://github.com/Project-OSRM/osrm-backend/wiki/Disk-and-Memory-Requirements)).
That gave ~4.3 GiB per profile nationwide, ~14 GiB for three.

**ADR-0024's own amendment already shrank that**, and the shrink is the operative number: the road
pipeline uses a **sub-region** extract, because `osrm-extract` on the 2,370 MB nationwide file
exceeds available memory. Kantō is 460 MB against Japan's 2,370 MB — under a fifth — so the same
linear extrapolation puts serving at roughly **1 GiB per profile, ~3 GiB for all three**, plus VROOM,
which is a solver process rather than a graph holder.

So the honest comparison is:

| Option | Fixed monthly | Per 60×60 run |
| --- | --- | --- |
| **The actual deployment (ADR-0025): the developer's own machine** | **$0** | $0 |
| Cheapest cloud host that comfortably fits three regional `osrm-routed` + VROOM: DigitalOcean Basic 8 GiB / 4 vCPU / 160 GiB SSD | **$48.00** | $0 |
| Same at 16 GiB / 8 vCPU / 320 GiB (headroom for a nationwide extract, and for running the *build* on the same box) | $96.00 | $0 |
| Google Routes, no fixed cost | $0 | **$18.00** |
| Mapbox Matrix, no fixed cost | $0 | $7.80 (after 100k free elements ≈ 25 runs) |
| Stadia Professional | $250.00 | included to ~694 runs |
| GraphHopper Standard | €199.00 | included to 25 runs/day |
| OpenRouteService Standard | $0 | $0 (250 runs/day) |

DigitalOcean's Basic droplet prices are read verbatim from
[their pricing page](https://www.digitalocean.com/pricing/droplets): "8 GiB / 4 vCPUs / 5,000 GiB /
160 GiB / $48.00" and "16 GiB / 8 vCPUs / 6,000 GiB / 320 GiB / $96.00". A $48/month box pays for
itself against **three** 60-point optimize runs on Google. But the row that actually governs is the
first one: ADR-0025 already decided the deployment is one machine that exists, so the incumbent
design's marginal infrastructure cost today is zero, and the comparison against $18/run is not close.

### 8. The one thing worth adding to ADR-0024

Everything above confirms §1. One finding argues for an addendum rather than an amendment.

ADR-0024's 2026-08-07 amendment flagged a residual diagnostic risk it could not close: a trip wholly
outside the region-scoped road extract "silently routes entirely by haversine while OSRM appears
healthy." §4's composition answers it correctly per cell but leaves the whole-trip case degraded to
straight lines.

**Hosted ORS is the natural fifth registry row**, between `osrm` and `haversine`:

| # | id | kinds | gate |
| --- | --- | --- | --- |
| 1 | `osm-japan` | `rail` | in Japan; graph file present |
| 2 | `osrm` | `walking`, `driving`, `bicycle` | OSRM URLs configured |
| 3 | `google` | `bus` | API key configured |
| 3.5 | **`ors`** | `walking`, `driving`, `bicycle` | **ORS API key configured** |
| 4 | `haversine` | terminal | always |

It earns the slot on four independent grounds, all established above: it is the only candidate whose
ToS permits what we do; it is free; it is global, so it covers exactly the outside-the-extract case;
and its `foot-walking` / `foot-hiking` split gives a second opinion on the flat-5 km/h question
Prototype B exists to settle. It costs the design nothing, because §4 already built the machinery —
a provider that declines cells, in preference order, with `haversine` terminal.

Three things it must carry: the CC-BY-SA 4.0 term on results and the "© openrouteservice by HeiGIT"
attribution string (folding into the [#150](https://github.com/Tyler-Reagan/trip-kraken/issues/150)
attribution work rather than adding a new obligation), a 3,500-element cap that means two requests
per 60-point matrix, and the standing possibility that a free research service withdraws access —
which is precisely why it goes *below* `osrm` and not in place of it.

---

## What I could not verify

Stated plainly rather than filled in.

- **Whether Stadia's Free and Starter plans can use the matrix endpoint at all, and at what element
  cap.** The endpoint page lists the plans it is available on as Free, Starter, Standard and
  Professional, but the limits table has columns only for Standard and Professional. I have assumed
  the 625 figure is the best case below Professional; it may be lower or the endpoint may be barred.
  This does not change the verdict — Stadia is disqualified on ToS regardless — but the $80-vs-$250
  arithmetic in the comparison table rests on it.
- **Hetzner Cloud pricing.** Their pricing tables are rendered client-side behind a cookie banner,
  and the news page returned HTTP 429 and then a hold page. I could not read a single verbatim
  price from a Hetzner-owned page, so no Hetzner figure appears above. Hetzner is materially cheaper
  than DigitalOcean and would only strengthen §7's conclusion; I have used the DigitalOcean numbers
  I could actually read rather than a remembered Hetzner one.
- **Which engine Stadia's routing runs on.** Their docs pages I could reach name OpenStreetMap as
  the data source but never name the engine, and `docs.stadiamaps.com/routing/route/` returned HTTP
  403. The costing-model vocabulary (`auto`, `pedestrian`, `bicycle`, `bus`, `taxi`, `truck`,
  `auto_traffic`) is Valhalla's, and Stadia is a well-known Valhalla sponsor — but that is inference
  from naming, not a primary-source statement, and nothing above depends on it.
- **Simple Routing's offering entirely.** Every page returned HTTP 403. Whether it covers Japan or a
  foot profile is unknown. If hosted OSRM is ever revisited, this is the one stone left unturned.
- **Whether ORS's `foot-walking` duration model accounts for elevation.** ORS exposes steepness and
  elevation as *extra info* on directions, which proves it has an elevation model available, but I
  found no primary statement that walking *duration* is adjusted by grade — unlike GraphHopper's
  `hike`, which says so explicitly. If ORS is added as a second opinion on the hilly-terrain
  question, confirm this first, or the second opinion is the same opinion.
- **GraphHopper's position on server-side caching, as opposed to its silence.** The ToS grants
  client-side temporary caching and says nothing about server-side. I have read the silence
  narrowly. That reading is a judgement, not a quotation, and it is the only disqualification in this
  document that rests on one. A written question to GraphHopper would settle it; nothing here needs
  it settled unless the walking escape hatch is exercised.
- **Whether Google's `TRANSIT` matrix requests bill Essentials or Pro** — carried forward unresolved
  from `osrm-viability-149.md`. Pro's rate has since risen from $8.00 to $10.00 per 1,000, so if the
  answer is Pro the gap widens further.
