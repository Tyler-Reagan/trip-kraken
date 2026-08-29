/**
 * The only module in `src/lib/vroom/` that touches the network. Matches `osrmProvider.ts`'s
 * `fetchOsrmJson` pattern exactly — bare `fetch`, no timeout, no retry, two error tiers (transport,
 * then application) — so the two upstream HTTP services this codebase depends on fail the same way.
 *
 * Per ADR-0023's Consequences, `solve()` gains an infrastructure dependency: an unconfigured or
 * unreachable VROOM must fail loudly, never silently produce a straight-line plan. Both failure
 * modes here throw a plain `Error` prefixed `vroomClient:`, propagating by design (ADR-0018 §4) —
 * the API route already turns any thrown error into a structured 500 rather than swallowing it.
 */

import type {
  VroomPlanRequest,
  VroomPlanSolution,
  VroomRequest,
  VroomSolution,
} from "@/lib/vroom/wire";

export async function postVroom(request: VroomRequest): Promise<VroomSolution> {
  const url = process.env.VROOM_URL;
  if (!url) throw new Error("vroomClient: VROOM_URL is not set");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`vroomClient: HTTP ${res.status} ${text}`);
  }

  const data = (await res.json()) as VroomSolution;
  if (data.code !== 0) {
    throw new Error(
      `vroomClient: VROOM error ${data.code}${data.error ? ` — ${data.error}` : ""}`,
    );
  }
  return data;
}

/**
 * The plan-mode diagnostic call (ADR-0023 §8). The inverse of `postVroom`'s contract in one
 * respect, and deliberately so: **it never throws.**
 *
 * #155's acceptance criteria requires this pass to be optional and failure-tolerant — a failed
 * diagnostic must never fail an optimize that already succeeded. Returning `VroomPlanSolution |
 * null` makes that a type obligation rather than a convention a future caller could forget to
 * wrap: there is no error path for a caller to mishandle, and the `null` branch is one the
 * compiler insists they handle. `postVroom` above keeps the opposite contract — the Plan itself
 * must fail loudly, never degrade silently.
 */
export async function postVroomPlan(
  request: VroomPlanRequest,
): Promise<VroomPlanSolution | null> {
  const url = process.env.VROOM_URL;
  if (!url) return null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      console.warn(
        `vroomClient: plan-mode diagnostic skipped — HTTP ${res.status}`,
      );
      return null;
    }
    const data = (await res.json()) as VroomPlanSolution;
    if (data.code !== 0) {
      console.warn(
        `vroomClient: plan-mode diagnostic skipped — VROOM error ${data.code}`,
      );
      return null;
    }
    return data;
  } catch (err) {
    // Includes the "VROOM compiled without libglpk" case (ADR-0023's 2026-08-07 amendment) — a
    // build that can't run `-c` costs us the diagnosis, never the Plan.
    console.warn("vroomClient: plan-mode diagnostic skipped —", err);
    return null;
  }
}
