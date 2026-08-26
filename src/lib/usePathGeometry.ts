"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { DerivedDay, LegModePin } from "@/types";
import type { Path, RoadProfile } from "@/types/path";
import { pairKey, uniquePairsOfDays, type PathPair } from "@/lib/pathPairs";

/** What one pair resolved to. `null` records a pair the router refused outright — held so it is
 * asked once, not once per render. A held entry is never re-requested. */
export type PathGeometryMap = ReadonlyMap<string, Path[] | null>;

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
  legModePins: LegModePin[]
): PathGeometryMap {
  const held = useRef<Map<string, Path[] | null>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());
  const [, bump] = useState(0);

  // A new Trip starts from nothing rather than carrying the last one's pairs. Done during render
  // (not in an effect) so the first paint after a Trip switch cannot show the old Trip's lines.
  const lastTripId = useRef(tripId);
  if (lastTripId.current !== tripId) {
    lastTripId.current = tripId;
    held.current = new Map();
    inFlight.current = new Set();
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
    for (const pair of uniquePairsOfDays(days, roadProfile, legModePins)) {
      const key = pairKey(roadProfile, pair, legModePins);
      if (held.current.has(key) || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      missing.push(pair);
    }
    if (missing.length === 0) return;

    // Deliberately not aborted when this effect re-runs. The Days' identity changes on every
    // `reload()`, so aborting on re-run would cancel a nearly-complete batch and ask for it again.
    // An in-flight answer stays valid regardless of what changed while it was in flight.
    void (async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/path-geometry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairs: missing.map(({ from, to }) => ({ from, to })) }),
        });
        if (!res.ok) throw new Error(`path-geometry: HTTP ${res.status}`);
        const { results } = (await res.json()) as { results: (Path[] | null)[] };
        if (!alive.current) return;

        // A fresh Map so the value's identity changes with its contents — consumers hold it in a
        // `useMemo` dependency list, which compares by identity.
        const next = new Map(held.current);
        missing.forEach((pair, i) => next.set(pairKey(roadProfile, pair, legModePins), results[i] ?? null));
        held.current = next;
        bump((n) => n + 1);
      } catch {
        // The canvas already drew every one of these pairs straight (§7), so a failed lookup costs
        // fidelity and never the map. Leaving the keys unheld lets a later render ask again.
      } finally {
        for (const pair of missing) inFlight.current.delete(pairKey(roadProfile, pair, legModePins));
      }
    })();
  }, [tripId, days, roadProfile, legModePins]);

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

const PathGeometryContext = createContext<PathGeometryContextValue | null>(null);

export const PathGeometryProvider = PathGeometryContext.Provider;

/** Throws if rendered outside `TripClient`'s provider — every consumer is deep in that tree, so a
 * silently-empty map would be a bug worth surfacing loudly rather than degrading quietly. */
export function usePathGeometryContext(): PathGeometryContextValue {
  const ctx = useContext(PathGeometryContext);
  if (!ctx) throw new Error("usePathGeometryContext: no PathGeometryProvider above this component");
  return ctx;
}
