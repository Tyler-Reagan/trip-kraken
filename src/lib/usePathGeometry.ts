"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { DerivedDay, JourneyRoadKind, Location } from "@/types";
import type { Path, RoadProfile } from "@/types/path";
import {
  pairKey,
  resolveJourneyKindToggle,
  uniquePairsOfDays,
  type PathPair,
} from "@/lib/pathPairs";
import { useTripStore } from "@/store/tripStore";

/** What one pair resolved to. `null` records a pair the router refused outright — held so it is
 * asked once, not once per render. A held entry is never re-requested. */
export type PathGeometryMap = ReadonlyMap<string, Path[] | null>;

/** How many times a pair left unresolved by an unreachable provider (Fly's scale-to-zero cold
 * start, ADR-0037, is the expected source in production) gets asked again before giving up and
 * treating it like any other pair that just hasn't been answered yet — a manual reload or Trip
 * change will still pick it back up. Bounded so a genuinely down provider doesn't retry forever. */
const MAX_RETRY_ROUNDS = 5;
const RETRY_DELAY_MS = 4000;

/**
 * The map's held Path geometry (ADR-0029 §5, #182) — keyed by pair, requesting only what it does
 * not already hold.
 *
 * **Why a store rather than a fetch per Trip load.** `reload()` runs from roughly fifteen places in
 * `tripStore`, after every move, removal, optimize, and field edit, and each one replaces the Trip
 * and re-derives every Day. A plain "fetch when the Days change" would therefore re-request every
 * pair in the Trip on every drag of a Placement — and `movePlacement`'s optimistic update makes that
 * happen twice per drag. Holding answers by pair turns a drag into the two or three pairs that
 * became newly adjacent, and a Day switch into nothing at all.
 *
 * The store is session state and dies with the page: nothing is written to the database (§6). A pair
 * is a coordinate fact rather than a Trip fact, so an answer that lands after the Trip changed is
 * still a correct answer to the question that was asked, and is kept.
 */
export function usePathGeometry(
  tripId: string | null,
  days: DerivedDay[],
  roadProfile: RoadProfile,
  journeyRoadKinds: JourneyRoadKind[],
): PathGeometryMap {
  const held = useRef<Map<string, Path[] | null>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());
  const [, bump] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const retryRound = useRef(0);

  // A new Trip starts from nothing rather than carrying the last one's pairs. Done during render
  // (not in an effect) so the first paint after a Trip switch cannot show the old Trip's lines.
  const lastTripId = useRef(tripId);
  if (lastTripId.current !== tripId) {
    lastTripId.current = tripId;
    held.current = new Map();
    inFlight.current = new Set();
    retryRound.current = 0;
  }

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!tripId) return;

    const missing: PathPair[] = [];
    for (const pair of uniquePairsOfDays(days, roadProfile, journeyRoadKinds)) {
      const key = pairKey(roadProfile, pair, journeyRoadKinds);
      if (held.current.has(key) || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      missing.push(pair);
    }
    if (missing.length === 0) return;

    const scheduleRetryWithinBudget = () => {
      if (retryRound.current >= MAX_RETRY_ROUNDS) return;
      retryRound.current += 1;
      setTimeout(() => {
        if (alive.current) setRetryTick((n) => n + 1);
      }, RETRY_DELAY_MS);
    };

    // Deliberately not aborted when this effect re-runs. The Days' identity changes on every
    // `reload()`, so aborting on re-run would cancel a nearly-complete batch and ask for it again.
    // An in-flight answer stays valid regardless of what changed while it was in flight.
    void (async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/path-geometry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairs: missing.map(({ from, to }) => ({ from, to })),
          }),
        });
        if (!res.ok) throw new Error(`path-geometry: HTTP ${res.status}`);
        const { results, retry } = (await res.json()) as {
          results: (Path[] | null)[];
          retry: number[];
        };
        if (!alive.current) return;

        // A fresh Map so the value's identity changes with its contents — consumers hold it in a
        // `useMemo` dependency list, which compares by identity.
        const next = new Map(held.current);
        const retrying = new Set(retry);
        missing.forEach((pair, i) => {
          // `retry` marks a pair the provider couldn't reach rather than genuinely answered "no
          // route" (a cold-started Fly Machine, ADR-0037, being the expected cause in production).
          // Leaving it unheld — not caching `null` — is what lets the scheduled retry below ask
          // again instead of drawing this pair dashed forever.
          if (retrying.has(i)) return;
          next.set(
            pairKey(roadProfile, pair, journeyRoadKinds),
            results[i] ?? null,
          );
        });
        held.current = next;
        bump((n) => n + 1);

        if (retrying.size > 0) scheduleRetryWithinBudget();
      } catch {
        // The canvas already drew every one of these pairs straight (§7), so a failed lookup costs
        // fidelity and never the map. Leaving the keys unheld lets a later render ask again.
        scheduleRetryWithinBudget();
      } finally {
        for (const pair of missing)
          inFlight.current.delete(pairKey(roadProfile, pair, journeyRoadKinds));
      }
    })();
    // `retryTick` isn't read in the body — it exists to force this effect to re-run a bounded
    // number of times after a provider-unreachable failure, since nothing else about `days` or
    // `roadProfile` changes when a Fly Machine finishes booting on its own.
  }, [tripId, days, roadProfile, journeyRoadKinds, retryTick]);

  return held.current;
}

/**
 * `usePathGeometry`'s hoist point (ADR-0036, #139). `TripClient` calls the hook once and provides
 * the result here so `DayCard`'s sidebar shift rows and `MapView`'s `StopPanel` read the same held
 * pairs instead of each maintaining (and re-fetching into) their own copy — a second independent
 * fetcher would risk the two surfaces disagreeing about the same pair's staleness. `roadProfile`
 * travels alongside the map since a pair's key is meaningless without it.
 */
export interface PathGeometryContextValue {
  pathGeometry: PathGeometryMap;
  roadProfile: RoadProfile;
}

const PathGeometryContext = createContext<PathGeometryContextValue | null>(
  null,
);

export const PathGeometryProvider = PathGeometryContext.Provider;

/** Throws if rendered outside `TripClient`'s provider — every consumer is deep in that tree, so a
 * silently-empty map would be a bug worth surfacing loudly rather than degrading quietly. */
export function usePathGeometryContext(): PathGeometryContextValue {
  const ctx = useContext(PathGeometryContext);
  if (!ctx)
    throw new Error(
      "usePathGeometryContext: no PathGeometryProvider above this component",
    );
  return ctx;
}

export interface JourneyGap {
  key: string;
  chain: Path[] | null | undefined;
  kindToggle: ReturnType<typeof resolveJourneyKindToggle>;
}

/**
 * One Location-to-Location gap's resolved geometry and kind toggle — `DayCard`'s `RouteConnector`
 * and `MapView`'s `StopPanel` both render a gap from the same three facts (this pair's held
 * `Path[]`, and the Journey's effective walk/drive kind), so the lookup lives here once rather
 * than in both. `null` when the gap can't be resolved at all (either end ungeocoded, or no Trip
 * loaded yet) — the caller renders nothing rather than working from partial data.
 */
export function useJourneyGap(from: Location, to: Location): JourneyGap | null {
  const trip = useTripStore((s) => s.trip);
  const setJourneyRoadKind = useTripStore((s) => s.setJourneyRoadKind);
  const { pathGeometry, roadProfile } = usePathGeometryContext();

  if (from.lat === null || to.lat === null || !trip) return null;

  const key = pairKey(
    roadProfile,
    {
      from: { lat: from.lat, lng: from.lng!, locationId: from.id },
      to: { lat: to.lat, lng: to.lng!, locationId: to.id },
    },
    trip.journeyRoadKinds,
  );

  return {
    key,
    chain: pathGeometry.get(key),
    kindToggle: resolveJourneyKindToggle(
      trip.journeyRoadKinds,
      roadProfile,
      from.id,
      to.id,
      (kind) => setJourneyRoadKind(from.id, to.id, kind),
    ),
  };
}
