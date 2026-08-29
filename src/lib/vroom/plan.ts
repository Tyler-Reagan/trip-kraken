/**
 * ADR-0023 §8's second pass, and the one place this codebase asks VROOM a *hypothetical* rather
 * than a question. Pure: builds plan-mode requests and reads their violations back into our own
 * vocabulary. `client.ts` owns the network; `solver.ts` owns the loop.
 *
 * ## Why this probes Unplaced Activities rather than replaying the Plan
 *
 * §8 and #155 both describe the pass as "re-send the solved routes as `vehicle.steps`". Taken
 * literally that is dead code, and measurably so: a solved route replayed unchanged reports zero
 * violations, every time. It has to — a Placement exists precisely *because* VROOM confirmed it
 * fits under hard constraints, so re-checking it against those same constraints cannot discover a
 * new conflict. Verified against the running container on real solves before this module was
 * written, not inferred from the docs.
 *
 * What plan mode *can* answer is the question §8 actually says it exists to answer: why the
 * unassigned pile is unassigned. "Stack [hard constraints] and an unbalanced plan becomes a pile
 * of unassigned stops with no explanation." So each Unplaced Activity is appended to a Day's steps
 * and VROOM is asked what that would break. The Day's real Placements ride along as context —
 * arrival times depend on what is already scheduled around the probe — but they are context for
 * computing one number, never a second Plan. Nothing this module returns can become a Placement;
 * `wire.ts`'s plan-mode block explains how the types enforce that.
 *
 * ## One probe per Day per round
 *
 * A Day admits at most one probe per call, which is what makes attribution sound rather than
 * merely tidy. Two findings force it:
 *
 * - A Day running past its budget reports `delay` on the route's **`end`** step, not on any job
 *   step. With one probe on the Day, that overrun is unambiguously the probe's fault, because the
 *   route without it was feasible. With two, it is a joint effect neither can be charged for.
 * - `max_tasks` is reported on whichever step tips the Day over. A second probe would collect a
 *   `day-full` caused by the first probe rather than by the Plan.
 *
 * Rounds therefore cost `ceil(probes / usable Days)` calls, which for a real Trip is one — the
 * "one extra sub-second call" §8 budgets for — and degrade to a bounded few when a Trip drops more
 * Activities than it has Days.
 */

import type { UnplacedDiagnosis } from "@/lib/solver";
import type { VroomJob, VroomPlanRequest, VroomPlanSolution, VroomPlanStepInput, VroomRequest, VroomSolution, VroomVehicle } from "@/lib/vroom/wire";

/** Bounds the diagnostic's cost on a pathological Trip (many more dropped Activities than Days).
 * Past this the remaining Unplaced entries keep their honest reasonless message rather than
 * spending further calls — a diagnosis is a nicety, and the Plan is already home. */
const MAX_PROBE_ROUNDS = 4;

/** One Day's probe: the Activity being asked about, and the Day it is being asked about on. */
export interface PlanProbe {
  jobId: number;
  vehicleId: number;
}

function jobsById(request: VroomRequest): Map<number, VroomJob> {
  return new Map(request.jobs.map((j) => [j.id, j]));
}

/** A Day's committed Placements, as job ids in route order — the context a probe is evaluated
 * against. A Day VROOM returned no route for (an empty Day) simply has none. */
function placementsByVehicle(solution: VroomSolution): Map<number, number[]> {
  const byVehicle = new Map<number, number[]>();
  for (const route of solution.routes) {
    const ids: number[] = [];
    for (const step of route.steps) {
      if (step.type === "job" && step.id != null) ids.push(step.id);
    }
    byVehicle.set(route.vehicle, ids);
  }
  return byVehicle;
}

/**
 * Which Day to ask about, in preference order: a Day that serves this Activity's area *and* has
 * room, then any Day that serves its area, then any Day at all. Ties go to the emptiest Day.
 *
 * The ordering is what keeps the answer informative. Under §6's slack-zero `max_tasks` nearly
 * every Day in a full Trip sits exactly at its cap, so probing carelessly would return `day-full`
 * for everything and bury the hours conflict underneath. Preferring a Day with headroom surfaces
 * the more specific reason where one exists — and when every Day really is at capacity,
 * `day-full` is no longer a probing artifact but the true answer.
 */
function pickVehicle(
  jobId: number,
  jobs: Map<number, VroomJob>,
  vehicles: VroomVehicle[],
  placements: Map<number, number[]>,
  taken: Set<number>
): number | undefined {
  const jobSkills = jobs.get(jobId)?.skills ?? [];
  const candidates = vehicles.filter((v) => !taken.has(v.id));
  if (candidates.length === 0) return undefined;

  const serves = (v: VroomVehicle) => jobSkills.every((s) => (v.skills ?? []).includes(s));
  const load = (v: VroomVehicle) => placements.get(v.id)?.length ?? 0;
  const hasRoom = (v: VroomVehicle) => v.max_tasks == null || load(v) < v.max_tasks;

  const tiers = [
    candidates.filter((v) => serves(v) && hasRoom(v)),
    candidates.filter((v) => serves(v)),
    candidates,
  ];
  for (const tier of tiers) {
    if (tier.length === 0) continue;
    return tier.reduce((best, v) => (load(v) < load(best) ? v : best)).id;
  }
  return undefined;
}

/**
 * Groups the Activities worth probing into rounds of at most one per Day. `jobIds` is the set
 * VROOM itself dropped without a reason — pre-flight exclusions already know why they were
 * excluded and are never probed.
 */
export function planProbeRounds(request: VroomRequest, solution: VroomSolution, jobIds: number[]): PlanProbe[][] {
  const jobs = jobsById(request);
  const placements = placementsByVehicle(solution);
  const rounds: PlanProbe[][] = [];
  let remaining = jobIds.filter((id) => jobs.has(id));

  while (remaining.length > 0 && rounds.length < MAX_PROBE_ROUNDS) {
    const taken = new Set<number>();
    const round: PlanProbe[] = [];
    for (const jobId of remaining) {
      const vehicleId = pickVehicle(jobId, jobs, request.vehicles, placements, taken);
      if (vehicleId == null) break; // every Day already carries a probe this round
      taken.add(vehicleId);
      round.push({ jobId, vehicleId });
    }
    if (round.length === 0) break; // no Days at all — nothing to probe against
    rounds.push(round);
    const probed = new Set(round.map((p) => p.jobId));
    remaining = remaining.filter((id) => !probed.has(id));
  }

  return rounds;
}

/**
 * One round's request. Only the probed Days are included — a job listed in `jobs` but absent from
 * every vehicle's `steps` is reported unassigned rather than rejected, so the untouched Days cost
 * nothing to leave out and their absence keeps each round's answer about the probes alone.
 */
export function buildVroomPlanRequest(request: VroomRequest, solution: VroomSolution, round: PlanProbe[]): VroomPlanRequest {
  const placements = placementsByVehicle(solution);
  const byVehicle = new Map(request.vehicles.map((v) => [v.id, v]));

  const vehicles = round.flatMap((probe) => {
    const vehicle = byVehicle.get(probe.vehicleId);
    if (!vehicle) return [];
    // The probe goes last: appending keeps the Day's committed order untouched, so any overrun is
    // the cost of adding this Activity to the Day as it stands rather than of resequencing it.
    const jobIds = [...(placements.get(probe.vehicleId) ?? []), probe.jobId];
    const steps: VroomPlanStepInput[] = [
      { type: "start" },
      ...jobIds.map((id) => ({ type: "job" as const, id })),
      { type: "end" },
    ];
    return [{ ...vehicle, steps }];
  });

  return { jobs: request.jobs, vehicles, matrices: request.matrices, options: { c: true } };
}

/**
 * Reads one round's violations back as domain findings, keyed by job id.
 *
 * Three step positions matter and they mean different things:
 *
 * - The probe's **own job step** is about the Activity — "this closes before you could get there".
 * - The **`start`** step's `lead_time` and the **`end`** step's `delay` are both about the Day: the
 *   route has to begin before the Day opens, or finish after it closes, to absorb the probe. A
 *   packed Day reports both at once, so the honest magnitude is their **sum** — the total hours the
 *   Day would need to grow by. Reading only one end silently loses the other, which is exactly what
 *   an end-only reading did on the first real Trip this was run against: the spill landed entirely
 *   on `start` and the Activity came back with no diagnosis at all.
 *
 * The Day-level reading is only attributable because the round put exactly one probe on the Day.
 */
export function parseVroomViolations(solution: VroomPlanSolution, round: PlanProbe[]): Map<number, UnplacedDiagnosis> {
  const found = new Map<number, UnplacedDiagnosis>();
  const probeByVehicle = new Map(round.map((p) => [p.vehicleId, p]));

  for (const route of solution.routes) {
    const probe = probeByVehicle.get(route.vehicle);
    if (!probe) continue;

    const ownStep = route.steps.find((s) => s.type === "job" && s.id === probe.jobId);

    // The Activity's own conflicts outrank the Day's: "this closes before you'd arrive" is a fact
    // about the place and survives rearranging the Day, where a shortfall may not.
    const own = (ownStep?.violations ?? []).flatMap((v) => {
      const cause = ownCause(v.cause);
      return cause ? [{ cause, dayNumber: route.vehicle, ...(v.duration != null ? { seconds: v.duration } : {}) }] : [];
    })[0];
    if (own) {
      found.set(probe.jobId, own);
      continue;
    }

    // A `load` violation (#153's capacity axis) is a fact about the whole Day, not the probe's own
    // step — verified live against the running container, and why it's read off `route.violations`
    // rather than `ownStep`, unlike `skills`/`max_tasks` above.
    if (route.violations?.some((v) => v.cause === "load")) {
      found.set(probe.jobId, { cause: "category-full", dayNumber: route.vehicle });
      continue;
    }

    const spillAt = (type: "start" | "end", cause: string) =>
      route.steps.find((s) => s.type === type)?.violations?.find((v) => v.cause === cause)?.duration ?? 0;
    const shortfall = spillAt("start", "lead_time") + spillAt("end", "delay");
    if (shortfall > 0) found.set(probe.jobId, { cause: "day-too-short", dayNumber: route.vehicle, seconds: shortfall });
  }

  return found;
}

/** VROOM's job-step-level causes, narrowed to the ones our own request can actually provoke. We
 * set `skills`, `max_tasks` and `time_windows` on jobs/vehicles; we set no precedence, no breaks
 * and no travel caps, so their causes are unreachable and deliberately unmapped rather than
 * guessed at. `load` (#153's capacity axis) is real but never appears here — see the
 * `route.violations` check above, not this function. */
function ownCause(cause: string): UnplacedDiagnosis["cause"] | null {
  switch (cause) {
    case "delay":
      return "after-closing";
    case "lead_time":
      return "before-opening";
    case "skills":
      return "out-of-reach";
    case "max_tasks":
      return "day-full";
    default:
      return null;
  }
}

/** The sentence shown in the Unassigned tray, replacing the reasonless "Couldn't fit this into any
 * day." Magnitude is rendered in minutes because that is the unit a traveller acts on, and rounded
 * up — "arrives 1 minute late" understates a 90-second miss less honestly than "2 minutes" does. */
export function diagnosisReason(d: UnplacedDiagnosis): string {
  const mins = d.seconds != null ? Math.max(1, Math.ceil(d.seconds / 60)) : null;
  switch (d.cause) {
    case "day-full":
      return `Every day that reaches this is already full — day ${d.dayNumber} has no room left.`;
    case "category-full":
      return `Day ${d.dayNumber} already has as many activities like this as it can take.`;
    case "out-of-reach":
      return "No day of the trip is based near enough to reach this.";
    case "after-closing":
      return mins != null
        ? `Wouldn't get there until ${mins} min after it closes on day ${d.dayNumber}.`
        : `Wouldn't get there before it closes on day ${d.dayNumber}.`;
    case "before-opening":
      return mins != null
        ? `Would have to be visited ${mins} min before it opens on day ${d.dayNumber}.`
        : `Would have to be visited before it opens on day ${d.dayNumber}.`;
    // Deliberately about the Day's length rather than "runs late": the shortfall can fall before
    // the Day starts as easily as after it ends, and a traveller's fix is the same either way —
    // a longer day, or another day.
    case "day-too-short":
      return mins != null
        ? `Day ${d.dayNumber} would need ${mins} more min to fit this in.`
        : `Day ${d.dayNumber} isn't long enough to fit this in.`;
  }
}
