/**
 * The one place our language becomes VROOM's (see `wire.ts`'s docblock for the full translation
 * table). Everything up to the final object literals below is expressed in `TripDay`/our own
 * nouns; only `vehicleForDay`/`jobForActivity` cross into wire keys, and they do it with the
 * domain noun sitting right next to the key it becomes — that adjacency is what keeps the mapping
 * readable off the page instead of requiring a lookup.
 */

import type { IsoDate } from "@/types";
import type { TravelCost } from "@/types/path";
import { dayWindowsFor } from "@/lib/vroom/timeWindows";
import type { LocationInput, StayPlan } from "@/lib/solver";
import type { VroomJob, VroomRequest, VroomVehicle } from "@/lib/vroom/wire";

/** VROOM accepts any profile name once a matrix is supplied — `"trip"`, not `"car"`, because our
 * matrix is one blended cost over `["rail", "bus", trip.roadProfile]` (ADR-0024 §3). Calling it
 * the car profile would be a false claim, and false claims are exactly what this module's
 * quarantine exists to prevent. */
const TRIP_PROFILE = "trip";

export interface BuildVroomRequestInput {
  /** Every Activity surviving `preflight` — jobs are built 1:1 from this. */
  placeable: LocationInput[];
  stays: StayPlan[];
  /** `[...placeable, ...geocoded lodgings]` — the authoritative index order `matrix` is built
   * over, and the bijection `location_index`/`start_index`/`end_index`/`job.id` all reuse. */
  matrixPoints: LocationInput[];
  matrix: TravelCost[][];
  tripDates: IsoDate[];
  numDays: number;
  dayStartMins: number;
  dayBudgetMinutes: number;
  metroOf: Map<string, number>;
  lodgingMetros: Map<string, number[]>;
}

/** A Day, entirely in our vocabulary — derived once, then read by `vehicleForDay`. */
interface TripDay {
  dayNumber: number;
  /** Matrix index of the Anchor you woke at, or undefined if absent/ungeocoded. */
  wakeAt: number | undefined;
  /** Matrix index of the Anchor you sleep at — only set when it differs from `wakeAt` (a travel
   * day); on a round-trip day only the start anchors the route, matching the pre-VROOM optimizer's
   * "no forced return" behaviour. */
  sleepAt: number | undefined;
  opensAt: number;
  closesAt: number;
  reachableMetros: number[];
}

function dayStartSeconds(tripDates: IsoDate[], dayIndex: number): number {
  const date = tripDates[dayIndex];
  // No real Trip dates resolved (a caller without a start date) — a self-consistent synthetic
  // epoch is fine, since nothing here needs to agree with a calendar, only with itself.
  return date ? Date.parse(date + "T00:00:00Z") / 1000 : dayIndex * 86400;
}

/** The lodging covering night `night`, per its `StayPlan` — the one part of the old optimizer's
 * anchor derivation that survives (ADR-0023 §1/§9), lifted near-verbatim. */
function lodgingIdOnNight(stays: StayPlan[], night: number): string | null {
  return stays.find((s) => night >= s.startNight && night <= s.endNight)?.lodgingId ?? null;
}

function deriveTripDays(input: BuildVroomRequestInput, indexOf: Map<string, number>, allMetroOrdinals: number[]): TripDay[] {
  const { stays, tripDates, numDays, dayStartMins, dayBudgetMinutes, lodgingMetros } = input;
  const metroActive = lodgingMetros.size > 0;

  return Array.from({ length: numDays }, (_, i) => {
    const dayNumber = i + 1;
    const wakeLodgingId = lodgingIdOnNight(stays, dayNumber - 1);
    const sleepLodgingId = lodgingIdOnNight(stays, dayNumber);

    const wakeAt = wakeLodgingId != null ? indexOf.get(wakeLodgingId) : undefined;
    const sleepAt = sleepLodgingId != null && sleepLodgingId !== wakeLodgingId ? indexOf.get(sleepLodgingId) : undefined;

    const opensAt = dayStartSeconds(tripDates, i) + dayStartMins * 60;
    const closesAt = opensAt + dayBudgetMinutes * 60;

    let reachableMetros: number[] = [];
    if (metroActive) {
      const wakeMetros = wakeLodgingId != null ? (lodgingMetros.get(wakeLodgingId) ?? []) : [];
      const sleepMetros = sleepLodgingId != null ? (lodgingMetros.get(sleepLodgingId) ?? []) : [];
      const union = new Set([...wakeMetros, ...sleepMetros]);
      // Neither Anchor resolved to a known metro (e.g. both ungeocoded) — don't leave the Day
      // artificially unable to serve anyone; fall back to every known metro rather than none.
      reachableMetros = union.size > 0 ? [...union] : allMetroOrdinals;
    }

    return { dayNumber, wakeAt, sleepAt, opensAt, closesAt, reachableMetros };
  });
}

function vehicleForDay(day: TripDay, placementsPerDayCap: number): VroomVehicle {
  return {
    id: day.dayNumber,
    ...(day.wakeAt != null ? { start_index: day.wakeAt } : {}), // Anchor you woke at
    ...(day.sleepAt != null ? { end_index: day.sleepAt } : {}), // Anchor you sleep at
    time_window: [day.opensAt, day.closesAt], // the Day's usable hours
    max_tasks: placementsPerDayCap,
    ...(day.reachableMetros.length > 0 ? { skills: day.reachableMetros } : {}),
    profile: TRIP_PROFILE,
  };
}

function jobForActivity(
  activity: LocationInput,
  index: number,
  tripDates: IsoDate[],
  metroOf: Map<string, number>
): VroomJob {
  // service = visitDuration ?? 0 replaces the deleted DEFAULT_VISIT_MINS = 60 (ADR-0023 §9) — the
  // constant was invented, and under a hard Day window it would consume real time we have no
  // evidence is needed.
  const service = Math.round((activity.visitDuration ?? 0) * 60);
  const windows = dayWindowsFor(activity, tripDates);
  const metro = metroOf.get(activity.id);
  return {
    id: index,
    location_index: index,
    service,
    ...(windows && windows.length > 0 ? { time_windows: windows } : {}),
    ...(metro != null ? { skills: [metro] } : {}),
  };
}

export function buildVroomRequest(input: BuildVroomRequestInput): VroomRequest {
  const { placeable, matrixPoints, matrix, tripDates, numDays, metroOf, lodgingMetros } = input;

  const indexOf = new Map(matrixPoints.map((p, i) => [p.id, i]));
  const allMetroOrdinals = [...new Set([...metroOf.values(), ...[...lodgingMetros.values()].flat()])];

  const placementsPerDayCap = Math.ceil(placeable.length / numDays); // §6 rung 1, slack 0 — the
  // 2026-08-07 amendment corrects §6's own guidance: slack IS the balance knob, and zero
  // measurably beats any nonzero value tested (CoV 0.11–0.16 at slack 0 vs 0.52 at slack 1). Do
  // not cushion it. No costs.fixed anywhere in this module — §6 forbids it by name, since it
  // biases toward *fewer* used vehicles, the wrong direction for a holiday.

  const tripDaysArr = deriveTripDays(input, indexOf, allMetroOrdinals);

  const jobs: VroomJob[] = placeable.map((a) => jobForActivity(a, indexOf.get(a.id)!, tripDates, metroOf));
  const vehicles: VroomVehicle[] = tripDaysArr.map((day) => vehicleForDay(day, placementsPerDayCap));

  const durations = matrix.map((row) => row.map((cell) => Math.round(cell.durationSeconds)));

  return { jobs, vehicles, matrices: { [TRIP_PROFILE]: { durations } } };
}
