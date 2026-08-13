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

import type { VroomRequest, VroomSolution } from "@/lib/vroom/wire";

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
    throw new Error(`vroomClient: VROOM error ${data.code}${data.error ? ` — ${data.error}` : ""}`);
  }
  return data;
}
