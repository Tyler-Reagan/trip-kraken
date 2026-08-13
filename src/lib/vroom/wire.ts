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
}

export interface VroomVehicle {
  id: number;
  start_index?: number;
  end_index?: number;
  time_window?: VroomTimeWindow;
  max_tasks?: number;
  skills?: number[];
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
