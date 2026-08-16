/**
 * ADR-0023 §8's second pass, orchestrated: `plan.ts` decides what to ask and reads the answer,
 * `client.ts` does the asking, and this module runs the loop between them.
 *
 * It exists as its own file for the quarantine's sake. Turning an Unplaced Activity into something
 * plan mode can be asked about means handling job ids and `unassigned[]` — wire vocabulary, which
 * `wire.ts`'s docblock forbids outside this directory. `solver.ts` calls one function and gets
 * back the same `Unplaced[]` it passed in, with better sentences on it.
 *
 * The whole pass is best-effort by construction: `postVroomPlan` returns `null` rather than
 * throwing, and every failure path here returns the input untouched. A diagnosis that doesn't
 * arrive costs a traveller a better sentence, never their Plan.
 */

import type { LocationInput, Unplaced, UnplacedDiagnosis } from "@/lib/solver";
import { postVroomPlan } from "@/lib/vroom/client";
import { buildVroomPlanRequest, diagnosisReason, parseVroomViolations, planProbeRounds } from "@/lib/vroom/plan";
import type { VroomRequest, VroomSolution } from "@/lib/vroom/wire";

/**
 * Enriches the `code: "solver"` entries — the ones VROOM dropped without saying why — with a real
 * cause and magnitude. The pre-flight codes are left alone: they already know why they were
 * excluded, and were never in the request to be probed.
 */
export async function diagnoseUnplaced(
  request: VroomRequest,
  solution: VroomSolution,
  unplaced: Unplaced[],
  matrixPoints: LocationInput[]
): Promise<Unplaced[]> {
  // job.id is the Location's index in matrixPoints — the single bijection request.ts built the
  // whole request over, read back the other way.
  const jobIdOf = new Map(matrixPoints.map((p, i) => [p.id, i]));
  const probeable = unplaced.filter((u) => u.code === "solver" && jobIdOf.has(u.locationId));
  if (probeable.length === 0) return unplaced;

  const rounds = planProbeRounds(request, solution, probeable.map((u) => jobIdOf.get(u.locationId)!));
  const findings = new Map<number, UnplacedDiagnosis>();

  // Sequential, not parallel: rounds are one call for a real Trip, and a diagnostic has no claim
  // on concurrency against the service that just did the actual work.
  for (const round of rounds) {
    const planSolution = await postVroomPlan(buildVroomPlanRequest(request, solution, round));
    if (!planSolution) break; // the pass is unavailable, not just unlucky — later rounds would fail too
    for (const [jobId, diagnosis] of parseVroomViolations(planSolution, round)) findings.set(jobId, diagnosis);
  }
  if (findings.size === 0) return unplaced;

  return unplaced.map((u) => {
    const diagnosis = u.code === "solver" ? findings.get(jobIdOf.get(u.locationId) ?? -1) : undefined;
    return diagnosis ? { ...u, diagnosis, reason: diagnosisReason(diagnosis) } : u;
  });
}
