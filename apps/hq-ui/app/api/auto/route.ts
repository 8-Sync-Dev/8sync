import { AUTO_ACTIONS, autoSet, autoStatus, type AutoAction } from "@/lib/server/auto";
import { runAutoTick } from "@/lib/server/auto-tick";
import { sweepStuckAsks } from "@/lib/server/stuck-asks";
import { bad, json, open, readBody } from "@/lib/server/http";
import { versions } from "@/lib/server/version";

export const runtime = "nodejs";

/** `8sync ccc auto status --json`; 200 with `error` when 8sync has no such command. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const [status, v] = await Promise.all([autoStatus(), versions()]);
  const tick = await runAutoTick(status);
  // Not awaited: closing a dialog takes a few seconds per room; the next poll reports nothing new.
  void sweepStuckAsks(status);
  return json({ ...status, versions: v, tick });
}

/** {action: "on" | "pause"}: only the fixed action word reaches the command line. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const action = body?.action;
  if (typeof action !== "string" || !(AUTO_ACTIONS as readonly string[]).includes(action)) return bad("action must be on or pause", 422);
  return json(await autoSet(action as AutoAction));
}
