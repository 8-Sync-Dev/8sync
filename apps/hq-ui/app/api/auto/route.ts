import { AUTO_ACTIONS, autoSet, autoStatus, type AutoAction } from "@/lib/server/auto";
import { runAutoTick } from "@/lib/server/auto-tick";
import { readPublic } from "@/lib/server/auth";
import { sweepStuckAsks } from "@/lib/server/stuck-asks";
import { bad, json, open, readBody } from "@/lib/server/http";
import { versions } from "@/lib/server/version";

export const runtime = "nodejs";

/**
 * `8sync ccc auto status --json`; 200 with `error` when 8sync has no such command. `remote.host`:
 * the public tunnel host while `8sync hq ui --public` runs (never the login key).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const [status, v] = await Promise.all([autoStatus(), versions()]);
  const tick = await runAutoTick(status);
  // Not awaited: closing a dialog takes a few seconds per room; the next poll reports nothing new.
  void sweepStuckAsks(status);
  return json({ ...status, versions: v, tick, remote: { host: readPublic()?.host ?? null } });
}

/** {action: "on" | "pause" | "omp-on" | "omp-off"}: only the fixed action word reaches the command line. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const action = body?.action;
  if (typeof action !== "string" || !(AUTO_ACTIONS as readonly string[]).includes(action)) return bad(`action must be one of ${AUTO_ACTIONS.join(", ")}`, 422);
  return json(await autoSet(action as AutoAction));
}
