/**
 * VROOM's wire format (v1.15.0), quarantined. VROOM speaks fleet logistics — vehicles, jobs,
 * skills, tasks — because it is a vehicle-routing solver we did not write and cannot ask to speak
 * our language. We can still keep that vocabulary from spreading: no `Vroom*` type and no wire key
 * declared below (`start_index`, `max_tasks`, `time_windows`, …) is imported or referenced by name
 * anywhere outside `src/lib/vroom/`. Everything upstream of this module (`solver.ts` outward)
 * speaks only `LocationInput` / `DayPlan` / `Unplaced` (CONTEXT.md's "Solver wire vocabulary"
 * entry names this boundary).
 *
 * Field shapes are cross-checked against `scripts/fixtures/vroom-planmode.json`, a request the
 * running container (docker-compose.yml, v1.15.0) already accepts. Only the fields this codebase
 * actually sends or reads are declared — this is not a full VROOM API binding.
 *
 * ## The translation table
 *
 * The left column is CONTEXT.md's vocabulary; the right is the wire key it becomes. This table is
 * the one place a reader needs to hold both languages at once — everywhere else, exactly one of
 * them is in scope.
 *
 * | Ours (CONTEXT.md)                          | VROOM wire                        | Note |
 * |---------------------------------------------|------------------------------------|------|
 * | **Day**                                      | `vehicle`, `id` = 1-based day number | A Day is a date, not an entity — here it's the thing that carries Placements |
 * | An Activity we ask VROOM to place             | `job`                              | Not "Placement" — a Placement is the *commitment*, which exists only once VROOM answers |
 * | **Anchor** you wake at / sleep at            | `vehicle.start_index` / `end_index` | The lodging bookending the Day; differs on a travel day |
 * | A Day's usable hours                         | `vehicle.time_window`              | |
 * | Per-Day Placement cap                        | `vehicle.max_tasks`                | |
 * | Metro reachable from a Day's Anchor          | `vehicle.skills` ⊇ `job.skills`    | Integer ordinals; "skill" means nothing here beyond set membership |
 * | Per-Day category cap (ADR-0023 §4, #153)     | `vehicle.capacity` / `job.delivery` | One axis today (food); `delivery[i] ≤` what `capacity[i]` allows across the Day's jobs |
 * | Opening hours across the Trip's dates        | `job.time_windows`                 | |
 * | Visit duration                               | `job.service`                      | |
 * | Travel cost matrix                           | `matrices.<profile>.durations`     | Keyed `"trip"`, not `"car"` — see request.ts |
 * | A Location's index in the matrix             | `location_index`, and `job.id`     | One bijection, reused as the job id |
 * | **Unplaced**, with no reason given            | `unassigned[]`                     | Carries `{id, type}` only |
 *
 * Two words are load-bearing traps, both because CONTEXT.md has already spent them:
 * - **"Excluded" is taken** — it means a Location the user kept in the Trip but told the optimizer
 *   to ignore (`Location.excluded`). What this module's callers compute before ever building a
 *   request is `Unplaced`, never "excluded".
 * - **"Stop" is on Placement's `_Avoid_` list.** Use Placement for a commitment, Activity for a
 *   candidate — never "stop", "visit", or "waypoint".
 */

/** A job's admissible windows, in absolute Unix seconds — `timeWindows.ts`'s output shape. */
export type VroomTimeWindow = [number, number];

export interface VroomJob {
  id: number;
  location_index: number;
  /** Visit duration in seconds. Absent (rather than 0) is legal but we always send it explicitly —
   * see request.ts's `service = (visitDuration ?? 0) * 60`. */
  service?: number;
  time_windows?: VroomTimeWindow[];
  skills?: number[];
  /** One integer per active capacity axis (ADR-0023 §4, #153) — how much of each this job draws
   * from its Day's `vehicle.capacity`. Every job in a request built by this codebase carries the
   * same arity as every vehicle's `capacity` (VROOM requires it — an arity mismatch is a request
   * error, not a solve outcome). */
  delivery?: number[];
}

export interface VroomVehicle {
  id: number;
  start_index?: number;
  end_index?: number;
  time_window?: VroomTimeWindow;
  max_tasks?: number;
  skills?: number[];
  /** One integer per active capacity axis (ADR-0023 §4, #153) — a hard per-Day cap; VROOM never
   * assigns jobs whose summed `delivery` on this axis would exceed it. */
  capacity?: number[];
  /** Must match a key in `VroomRequest.matrices` when a matrix is supplied. Every vehicle in a
   * request built by this codebase carries the same value (`TRIP_PROFILE` in request.ts). */
  profile?: string;
}

export interface VroomMatrix {
  durations: number[][];
}

export interface VroomRequest {
  jobs: VroomJob[];
  vehicles: VroomVehicle[];
  matrices: Record<string, VroomMatrix>;
}

export interface VroomStep {
  type: "start" | "job" | "end";
  id?: number;
  location_index?: number;
  /** Seconds since VROOM's epoch-zero (the same absolute-seconds axis every `time_window` is
   * expressed in). */
  arrival?: number;
  waiting_time?: number;
}

export interface VroomRoute {
  vehicle: number;
  steps: VroomStep[];
}

export interface VroomUnassignedJob {
  id: number;
  type: string;
}

export interface VroomSolution {
  /** VROOM's own status code: `0` on success. Non-zero bodies carry `error`. */
  code: number;
  error?: string;
  routes: VroomRoute[];
  unassigned: VroomUnassignedJob[];
}

/* ────────────────────────────── Plan mode (ADR-0023 §8) ──────────────────────────────
 *
 * The second, diagnostic call — `options: { c: true }`, VROOM's "plan mode". It takes a route we
 * hand it and *evaluates* it instead of searching for one, softening every constraint and
 * reporting what each step breaks.
 *
 * These types are deliberately separate from the ones above rather than optional fields on them,
 * because the two calls answer different questions and only one of them produces truth:
 *
 * - **Call 1** (`VroomRequest` → `VroomSolution`) decides the Plan. Its routes *are* the
 *   Placements.
 * - **Call 2** (`VroomPlanRequest` → `VroomPlanSolution`) asks a hypothetical: "if this Activity
 *   went here, what would break?" Its route is a question we posed, not a plan we adopted. The
 *   only thing we may read from it is `violations`.
 *
 * So `VroomPlanStep` carries **no `location_index`, no `arrival`, no `waiting_time`**, and
 * `VroomPlanSolution` carries **no `unassigned`** — not because VROOM omits them (it sends all of
 * them) but because declaring them would let a plan-mode response be read as a Plan.
 * `parseVroomSolution` cannot accept a `VroomPlanSolution`: it needs `location_index` to map a
 * step back to a Location and `unassigned` to build `Unplaced`, and neither exists here. That is
 * the boundary, enforced by the compiler rather than by a comment.
 *
 * Plan mode needs a glpk-linked VROOM build (ADR-0023's 2026-08-07 amendment); ours is, because
 * docker-compose.yml builds `vroom-docker` from source rather than using the Homebrew formula.
 */

/** A step we ask plan mode to evaluate. Array order is the route; `id` is set only for a job. */
export interface VroomPlanStepInput {
  type: "start" | "job" | "end";
  id?: number;
}

export interface VroomPlanVehicle extends VroomVehicle {
  steps: VroomPlanStepInput[];
}

export interface VroomPlanRequest {
  jobs: VroomJob[];
  vehicles: VroomPlanVehicle[];
  matrices: Record<string, VroomMatrix>;
  /** `c` for "check" — evaluate the given routes rather than searching for new ones. A job listed
   * in `jobs` but absent from every vehicle's `steps` is simply reported unassigned, not an error,
   * which is what lets a request carry only the Days being probed. */
  options: { c: true };
}

/** `duration` is in seconds and is **not** always present: verified against the running container,
 * `delay` carries one, while `skills` and `max_tasks` arrive with a bare `cause`. */
export interface VroomViolation {
  cause: string;
  duration?: number;
}

export interface VroomPlanStep {
  type: "start" | "job" | "end";
  id?: number;
  violations?: VroomViolation[];
}

export interface VroomPlanRoute {
  vehicle: number;
  steps: VroomPlanStep[];
  /** A `load` violation (capacity exceeded, #153) reports here and on the `start` step, never on
   * the job step that tipped it over — verified live against the running container: `load` is a
   * fact about the whole route's carried delivery, not a moment in it, unlike `skills`/`max_tasks`
   * which land on the specific job/step responsible. Route-level is read here rather than picking
   * through `start`'s violations, since it's the more direct fact for what is fundamentally a
   * Day-level, not a step-level, constraint. */
  violations?: VroomViolation[];
}

export interface VroomPlanSolution {
  code: number;
  error?: string;
  routes: VroomPlanRoute[];
}
